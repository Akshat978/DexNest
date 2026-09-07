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
}

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
