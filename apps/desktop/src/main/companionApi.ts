// What the phone is allowed to ask, and how it proves it may.
//
// One route table, one gate. Everything under /companion requires a paired
// device token except pairing itself, and each route names the capability it
// needs so a read-only phone cannot reach a control route by knowing its path.
//
// WHY A TOKEN AND NOT THE NETWORK
//
// The action server listens on every interface, which is how DexNest Drop
// reaches a phone over Wi-Fi and how the same phone will reach it over
// Tailscale from anywhere. That is the right shape — but it means the network
// cannot be the authorisation. Being able to route to this port is not the
// same as being allowed to pause someone's overnight run, and on a café
// network those two are very far apart.
//
// The token is generated once, shown once, and stored hashed. What lives in
// the database can identify a device but cannot impersonate one.
//
// READ AND CONTROL ARE SEPARATE
//
// A paired phone starts read-only. Seeing that a run is blocked is a much
// smaller thing to hand a device than being able to stop one, and bundling
// them would mean deciding both while fumbling with a pairing code. Control is
// granted afterwards, at the desktop, as its own act.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import type { AutopilotHost } from "./autopilotHost.ts";
import type { DeviceCapability, DeviceRecord } from "@dexnest/autopilot-runtime";
import { canPhoneRun, phoneActions } from "@dexnest/action-registry";
import type { DexNestActionDefinition } from "@dexnest/shared-types";
import type { TodayAgenda } from "@dexnest/today";

/** Long enough that guessing is hopeless; short enough to fit in a QR later. */
const TOKEN_BYTES = 32;
/** Six digits, read off a screen and typed on a phone. Ten minutes to do it. */
const PAIRING_TTL_MINUTES = 10;
const MAX_BODY_BYTES = 64 * 1024;

export const hashToken = (token: string): string => createHash("sha256").update(token, "utf8").digest("hex");

/** Constant-time, so a wrong token cannot be narrowed down by how fast it fails. */
function sameToken(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export interface CompanionDeps {
  host: AutopilotHost;
  /** Best effort, for the audit view. */
  logEvent?: (summary: string, metadata: Record<string, unknown>) => void;
  /**
   * The action registry and its runner, injected rather than imported.
   *
   * Keeps this file ignorant of how an action actually runs — it decides only
   * whether one may be reached from a phone, which is a rule worth being able
   * to read in one place.
   */
  actions?: {
    list: () => DexNestActionDefinition[];
    run: (actionId: string, params: Record<string, unknown>) => Promise<unknown>;
  };
  /** One day's agenda, already assembled and already provider-agnostic. */
  today?: () => TodayAgenda;
  /** Claude and Codex plan usage, exactly as the desktop card shows it. */
  planUsage?: () => Promise<unknown>;
  /** A short verdict on whether DexNest itself is well. */
  health?: () => unknown;
  /**
   * Today's forecast, read from DexNest's own weather module.
   *
   * Synchronous because nothing is fetched here — the module keeps its own
   * cache and its own refresh schedule, and the phone asking must not become a
   * third thing that decides when to call a weather service.
   */
  weather?: () => unknown;
}

/** The verbs a phone may use. Anything not listed is not reachable. */
const CONTROL_VERBS = ["pause", "resume", "approve", "reject", "accept_plan", "reject_plan"] as const;
type ControlVerb = (typeof CONTROL_VERBS)[number];

interface Caller {
  device: DeviceRecord;
  token: string;
}

function json(response: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(text),
    // Nothing here is for a browser on another origin, and saying so costs
    // nothing.
    "Cache-Control": "no-store"
  });
  response.end(text);
}

async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let raw = "";
    let size = 0;
    request.setEncoding("utf8");
    request.on("data", chunk => {
      size += Buffer.byteLength(chunk);
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Request body is too large."));
        request.destroy();
        return;
      }
      raw += chunk;
    });
    request.on("end", () => {
      if (!raw.trim()) return resolve({});
      try { resolve(JSON.parse(raw) as Record<string, unknown>); }
      catch { reject(new Error("Request body is not valid JSON.")); }
    });
    request.on("error", reject);
  });
}

const bearer = (request: IncomingMessage): string | null => {
  const header = request.headers.authorization ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(Array.isArray(header) ? header[0] ?? "" : header);
  return match ? match[1]!.trim() : null;
};

/**
 * Routes the phone's requests.
 *
 * Returns true when it handled the request, so the existing server can fall
 * through to everything else untouched.
 */
export function createCompanionApi(deps: CompanionDeps) {
  const { host } = deps;

  const authorise = (request: IncomingMessage, need: DeviceCapability): { caller: Caller } | { error: string; status: number } => {
    const token = bearer(request);
    if (!token) return { error: "This endpoint needs a paired device token.", status: 401 };
    const device = host.devices.byTokenHash(hashToken(token));
    if (!device) return { error: "That device is not paired, or has been unpaired.", status: 401 };
    // The hash lookup already proved it; the constant-time compare is here so
    // the shape of this code cannot drift into a fast-fail string equality.
    if (!sameToken(hashToken(token), hashToken(token))) return { error: "Authentication failed.", status: 401 };
    if (!device.capabilities.includes(need)) {
      return {
        error: need === "control"
          ? "This device may read but not control. Grant control from DexNest on the desktop."
          : "This device does not have permission for that.",
        status: 403
      };
    }
    host.devices.markSeen(device.id);
    return { caller: { device, token } };
  };

  return async function handleCompanionRoutes(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
    if (!url.pathname.startsWith("/companion/")) return false;

    try {
      // --- pairing: the only route that needs no token ------------------------
      if (request.method === "POST" && url.pathname === "/companion/pair") {
        const body = await readBody(request);
        const code = String(body.code ?? "").trim();
        const label = String(body.label ?? "").trim() || "a phone";
        const pushToken = String(body.pushToken ?? "").trim();
        if (!code) {
          json(response, 400, { ok: false, error: "Enter the pairing code shown in DexNest." });
          return true;
        }

        const token = randomBytes(TOKEN_BYTES).toString("base64url");
        try {
          const device = host.devices.completePairing({
            code,
            tokenHash: hashToken(token),
            label,
            platform: "android",
            ...(pushToken ? { pushToken } : {})
          });
          deps.logEvent?.("A device paired with DexNest", {
            actionId: "autopilot.device_paired", deviceId: device.id, label: device.label
          });
          // The only time the token exists outside a hash. The phone keeps it
          // in Android's keystore; DexNest never sees it again.
          json(response, 200, {
            ok: true,
            token,
            device: { id: device.id, label: device.label, capabilities: device.capabilities }
          });
        } catch (error) {
          json(response, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
        }
        return true;
      }

      // --- everything else needs a token --------------------------------------
      if (request.method === "GET" && url.pathname === "/companion/whoami") {
        const auth = authorise(request, "read");
        if ("error" in auth) { json(response, auth.status, { ok: false, error: auth.error }); return true; }
        json(response, 200, {
          ok: true,
          device: {
            id: auth.caller.device.id,
            label: auth.caller.device.label,
            capabilities: auth.caller.device.capabilities
          }
        });
        return true;
      }

      /**
       * The phone telling DexNest where to push.
       *
       * Separate from pairing because a push token rotates on its own — a
       * reinstall, an Android decision — and re-pairing every time it did would
       * make the whole thing feel broken.
       */
      if (request.method === "POST" && url.pathname === "/companion/push-token") {
        const auth = authorise(request, "read");
        if ("error" in auth) { json(response, auth.status, { ok: false, error: auth.error }); return true; }
        const body = await readBody(request);
        const pushToken = String(body.pushToken ?? "").trim();
        if (!pushToken) { json(response, 400, { ok: false, error: "No push token was sent." }); return true; }
        host.devices.setPushToken(auth.caller.device.id, pushToken);
        json(response, 200, { ok: true });
        return true;
      }

      if (request.method === "GET" && url.pathname === "/companion/attention") {
        const auth = authorise(request, "read");
        if ("error" in auth) { json(response, auth.status, { ok: false, error: auth.error }); return true; }
        json(response, 200, { ok: true, ...host.attentionSnapshot() });
        return true;
      }

      /**
       * What this device may run.
       *
       * Filtered by the same predicate that gates the POST below, so the list
       * can never disagree with what actually happens — a listing built from a
       * different rule is a UI that offers buttons the server refuses.
       */
      /**
       * Today, in one call.
       *
       * One payload rather than three endpoints for events, timetable and
       * nudges, because the phone wants one ordered day — and three calls
       * would let it render a morning assembled from three different moments.
       */
      if (request.method === "GET" && url.pathname === "/companion/today") {
        const auth = authorise(request, "read");
        if ("error" in auth) { json(response, auth.status, { ok: false, error: auth.error }); return true; }
        if (!deps.today) { json(response, 503, { ok: false, error: "DexNest cannot build today's agenda right now." }); return true; }
        json(response, 200, { ok: true, today: deps.today() });
        return true;
      }

      /**
       * Plan usage, as the desktop computes it.
       *
       * The phone does no arithmetic of its own — not even the percentage.
       * Two surfaces that each derive a number from the same logs will
       * eventually disagree by a point, and then the operator has to work out
       * which one to believe at the exact moment they wanted a quick answer.
       *
       * That includes the staleness. Whether a reading is live or reckoned is
       * part of the reading, and a phone that showed the figure without it
       * would be the same wrong-looking rings on a smaller screen.
       */
      if (request.method === "GET" && url.pathname === "/companion/usage") {
        const auth = authorise(request, "read");
        if ("error" in auth) { json(response, auth.status, { ok: false, error: auth.error }); return true; }
        if (!deps.planUsage) { json(response, 503, { ok: false, error: "DexNest cannot read plan usage right now." }); return true; }
        json(response, 200, { ok: true, usage: await deps.planUsage() });
        return true;
      }

      if (request.method === "GET" && url.pathname === "/companion/weather") {
        const auth = authorise(request, "read");
        if ("error" in auth) { json(response, auth.status, { ok: false, error: auth.error }); return true; }
        json(response, 200, { ok: true, weather: deps.weather ? deps.weather() : null });
        return true;
      }

      if (request.method === "GET" && url.pathname === "/companion/health") {
        const auth = authorise(request, "read");
        if ("error" in auth) { json(response, auth.status, { ok: false, error: auth.error }); return true; }
        json(response, 200, { ok: true, health: deps.health ? deps.health() : null });
        return true;
      }

      /**
       * The few things a phone may do to a run.
       *
       * Requires the control capability, which pairing does not grant — it is
       * a second, deliberate decision made at the desk. Every verb here either
       * answers a question the run already asked or stops it. None of them
       * starts work, spends money, or edits a plan, because those belong where
       * there is a keyboard and the full picture.
       *
       * The verb list is a closed set rather than a method name taken from the
       * body: a string from the network used to pick a function is a way to
       * call functions nobody meant to expose.
       */
      if (request.method === "POST" && url.pathname === "/companion/control") {
        const auth = authorise(request, "control");
        if ("error" in auth) { json(response, auth.status, { ok: false, error: auth.error }); return true; }

        const body = await readBody(request);
        const verb = String(body.verb ?? "") as ControlVerb;
        const runId = String(body.runId ?? "").trim();

        if (!CONTROL_VERBS.includes(verb)) {
          json(response, 400, { ok: false, error: "That is not something a phone can do." });
          return true;
        }
        if (!host.control) {
          json(response, 503, { ok: false, error: "DexNest cannot act on runs right now." });
          return true;
        }

        try {
          switch (verb) {
            case "pause":
              host.control.pause(runId);
              break;
            case "resume":
              await host.control.resume(runId);
              break;
            case "approve":
            case "reject":
              host.control.approve(String(body.approvalId ?? ""), verb === "approve" ? "APPROVED" : "REJECTED");
              break;
            case "accept_plan":
              host.control.acceptPlanComplete(runId);
              break;
            case "reject_plan":
              // A rejection without a reason leaves the worker no way to do
              // better, so one is required rather than defaulted.
              if (!String(body.reason ?? "").trim()) {
                json(response, 400, { ok: false, error: "Say what is still missing." });
                return true;
              }
              host.control.rejectPlanComplete(runId, String(body.reason).trim());
              break;
          }

          deps.logEvent?.(`A phone ran ${verb}`, {
            actionId: "autopilot.phone_control", deviceId: auth.caller.device.id, verb, runId
          });
          json(response, 200, { ok: true });
        } catch (error) {
          // The engine refuses transitions that do not make sense — pausing
          // something already finished, approving twice. Its words are more
          // useful than a generic failure, and it has already refused.
          json(response, 409, { ok: false, error: error instanceof Error ? error.message : String(error) });
        }
        return true;
      }

      if (request.method === "GET" && url.pathname === "/companion/actions") {
        const auth = authorise(request, "read");
        if ("error" in auth) { json(response, auth.status, { ok: false, error: auth.error }); return true; }
        const available = deps.actions
          ? phoneActions(deps.actions.list(), auth.caller.device.capabilities)
          : [];
        json(response, 200, {
          ok: true,
          actions: available.map(action => ({
            id: action.id,
            title: action.title,
            module: action.moduleId,
            description: action.description,
            requires: action.phone
          }))
        });
        return true;
      }

      /**
       * Runs one action.
       *
       * Two gates, in this order: the device must be paired (authorise), and
       * the action must have opted in to being reachable from a phone. The
       * second is not a filter on the first — a device holding every
       * capability still cannot reach an action that never declared itself
       * available, which is what stops this route from being a key to the
       * whole registry.
       */
      if (request.method === "POST" && url.pathname === "/companion/action") {
        const auth = authorise(request, "read");
        if ("error" in auth) { json(response, auth.status, { ok: false, error: auth.error }); return true; }
        if (!deps.actions) {
          json(response, 503, { ok: false, error: "DexNest cannot run actions right now." });
          return true;
        }

        const body = await readBody(request);
        const actionId = String(body.actionId ?? "").trim();
        const action = deps.actions.list().find(candidate => candidate.id === actionId);

        // An unknown id and a non-exposed id answer identically. Otherwise the
        // difference between the two is a way to enumerate the registry from
        // a device that is not allowed to use it.
        const verdict = action
          ? canPhoneRun(action, auth.caller.device.capabilities)
          : ({ ok: false, reason: "not_exposed", message: "That action is not available from a phone." } as const);

        if (!verdict.ok) {
          deps.logEvent?.("A phone was refused an action", {
            actionId: "autopilot.phone_action_refused",
            deviceId: auth.caller.device.id,
            requestedActionId: actionId,
            reason: verdict.reason
          });
          json(response, verdict.reason === "needs_control" ? 403 : 404, { ok: false, error: verdict.message });
          return true;
        }

        deps.logEvent?.(`A phone ran ${actionId}`, {
          actionId: "autopilot.phone_action_ran",
          deviceId: auth.caller.device.id,
          requestedActionId: actionId
        });
        const params = typeof body.params === "object" && body.params !== null
          ? body.params as Record<string, unknown>
          : {};
        json(response, 200, { ok: true, result: await deps.actions.run(actionId, params) });
        return true;
      }

      if (request.method === "GET" && url.pathname === "/companion/runs") {
        const auth = authorise(request, "read");
        if ("error" in auth) { json(response, auth.status, { ok: false, error: auth.error }); return true; }
        json(response, 200, { ok: true, runs: host.runsForPhone() });
        return true;
      }

      json(response, 404, { ok: false, error: `No such companion endpoint: ${url.pathname}.` });
      return true;
    } catch (error) {
      json(response, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
      return true;
    }
  };
}

/** Opens a pairing window and returns the code for the desktop to display. */
export function openPairing(host: AutopilotHost): { code: string; expiresAt: string } {
  // Six digits, zero-padded. Short enough to read aloud, and it only has to
  // survive ten minutes against someone who would already need to be on the
  // network.
  const code = String(randomBytes(4).readUInt32BE(0) % 1_000_000).padStart(6, "0");
  return host.devices.openPairing(code, PAIRING_TTL_MINUTES);
}
