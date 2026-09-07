// Sending a notification to a phone.
//
// WHY THIS LIVES IN THE HOST
//
// packages/autopilot-runtime reaches the outside world only through injected
// ports, and there is no HTTP port — deliberately, because every effect the
// runtime performs goes Intent -> Policy -> Dispatcher and an unmediated
// network call would be a way around that. Sending a push is not a run's
// effect on a workspace; it is the app telling its owner something. So it
// belongs here, where Electron already owns the network, and the runtime keeps
// deciding WHAT to say without gaining the ability to say it.
//
// WHY NOT A LIBRARY
//
// firebase-admin would do this in three lines and pull in a hundred packages,
// several of which would sit in the path of every notification. What is
// actually required is a signed JWT, a token exchange, and one POST — all of
// which node:crypto and node:https already do. No dependency, and nothing
// between DexNest and Google that we did not write.
//
// WHY NOT EXPO'S PUSH SERVICE
//
// It is simpler to call, and it would mean uploading this service account to
// Expo's servers and putting their infrastructure in the delivery path. The
// credential stays on the machine instead. The trade is this file.

import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { request } from "node:https";

const TOKEN_HOST = "oauth2.googleapis.com";
const FCM_HOST = "fcm.googleapis.com";
const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

/** How long before expiry an access token is considered spent. */
const REFRESH_MARGIN_MS = 60_000;

export interface PushConfig {
  /** Absolute path to the Firebase service account JSON. Never copied. */
  serviceAccountPath: string;
  /** e.g. "dexnest-f1036". Appears in the FCM URL. */
  projectId: string;
}

export interface PushMessage {
  token: string;
  title: string;
  body: string;
  /** Read by the app; never shown. Values must be strings — FCM requires it. */
  data?: Record<string, string>;
  /** HIGH wakes a dozing phone. Routine news does not deserve it. */
  highPriority?: boolean;
  /** Which notification channel/category the app should render it as. */
  channelId?: string;
}

export interface PushResult {
  ok: boolean;
  /** FCM's own message name on success. */
  name?: string;
  /** The status FCM gave, e.g. "UNREGISTERED". Drives whether to disable. */
  status?: string;
  detail?: string;
}

interface ServiceAccount {
  client_email: string;
  private_key: string;
  project_id?: string;
}

const base64url = (value: Buffer | string): string =>
  Buffer.from(value).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** One POST, promised, with the body parsed as JSON when it is JSON. */
function post(
  host: string,
  path: string,
  body: string,
  headers: Record<string, string>
): Promise<{ status: number; json: Record<string, unknown>; raw: string }> {
  return new Promise((resolve, reject) => {
    const call = request(
      {
        host, path, method: "POST",
        headers: { ...headers, "Content-Length": Buffer.byteLength(body) },
        timeout: 15_000
      },
      response => {
        let raw = "";
        response.setEncoding("utf8");
        response.on("data", chunk => { raw += chunk; });
        response.on("end", () => {
          let json: Record<string, unknown> = {};
          try { json = JSON.parse(raw) as Record<string, unknown>; } catch { /* not JSON; raw carries it */ }
          resolve({ status: response.statusCode ?? 0, json, raw });
        });
      }
    );
    call.on("timeout", () => { call.destroy(new Error("timed out")); });
    call.on("error", reject);
    call.end(body);
  });
}

/**
 * Sends notifications to devices, using a service account it never copies.
 *
 * The credential is read from disk at the moment it is needed and kept only as
 * long as the process lives. Nothing here logs it, stores it, or puts any part
 * of it in an error message — a stack trace containing a private key would
 * outlive every other precaution.
 */
export class PushSender {
  private readonly config: PushConfig;
  private cached: { token: string; expiresAt: number } | null = null;

  constructor(config: PushConfig) {
    this.config = config;
  }

  private account(): ServiceAccount {
    let raw: string;
    try {
      raw = readFileSync(this.config.serviceAccountPath, "utf8");
    } catch {
      // Deliberately not the underlying error: an ENOENT message is useful, a
      // permissions error that quotes file contents would not be.
      throw new Error(`Could not read the service account at ${this.config.serviceAccountPath}.`);
    }
    let parsed: ServiceAccount;
    try {
      parsed = JSON.parse(raw) as ServiceAccount;
    } catch {
      throw new Error("The service account file is not valid JSON. Download it again from Firebase.");
    }
    if (!parsed.client_email || !parsed.private_key) {
      throw new Error("That file is not a service account key: it has no client_email and private_key.");
    }
    return parsed;
  }

  /**
   * A short-lived access token, minted from the service account.
   *
   * Google's flow: sign a JWT asserting who you are and what you want, then
   * exchange it. Cached until shortly before it expires, because a notification
   * should not cost two round trips.
   */
  private async accessToken(): Promise<string> {
    if (this.cached && this.cached.expiresAt - REFRESH_MARGIN_MS > Date.now()) return this.cached.token;

    const account = this.account();
    const issued = Math.floor(Date.now() / 1000);
    const claims = {
      iss: account.client_email,
      scope: SCOPE,
      aud: `https://${TOKEN_HOST}/token`,
      iat: issued,
      exp: issued + 3600
    };
    const unsigned = `${base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64url(JSON.stringify(claims))}`;
    const signer = createSign("RSA-SHA256");
    signer.update(unsigned);
    const assertion = `${unsigned}.${base64url(signer.sign(account.private_key))}`;

    const response = await post(
      TOKEN_HOST,
      "/token",
      new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
      { "Content-Type": "application/x-www-form-urlencoded" }
    );
    const token = typeof response.json.access_token === "string" ? response.json.access_token : null;
    if (!token) {
      const detail = typeof response.json.error_description === "string" ? response.json.error_description : response.raw.slice(0, 200);
      throw new Error(`Google refused the service account: ${detail || `HTTP ${response.status}`}.`);
    }
    const lifetime = typeof response.json.expires_in === "number" ? response.json.expires_in : 3600;
    this.cached = { token, expiresAt: Date.now() + lifetime * 1000 };
    return token;
  }

  /**
   * Proves the credentials work without needing a device.
   *
   * Minting an access token exercises everything that can be wrong before a
   * phone exists: the file, the key, the clock, and whether Google will vouch
   * for this account at all. It does NOT prove the FCM API is enabled — that
   * only shows up on a real send — so the check says as much rather than
   * implying more than it tested.
   */
  async verify(): Promise<{ ok: boolean; detail: string }> {
    try {
      await this.accessToken();
      return {
        ok: true,
        detail: `Google accepted the service account for project ${this.config.projectId}. Whether the FCM API is enabled shows up on the first real send.`
      };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
  }

  /** Sends one message to one device. Never throws; the result says what happened. */
  async send(message: PushMessage): Promise<PushResult> {
    let token: string;
    try {
      token = await this.accessToken();
    } catch (error) {
      return { ok: false, status: "AUTH", detail: error instanceof Error ? error.message : String(error) };
    }

    const payload = {
      message: {
        token: message.token,
        notification: { title: message.title, body: message.body },
        android: {
          priority: message.highPriority ? "HIGH" : "NORMAL",
          notification: {
            ...(message.channelId ? { channel_id: message.channelId } : {}),
            // So a second notification about the same thing replaces the first
            // rather than stacking. The engine already decided one is enough.
            ...(message.data?.groupKey ? { tag: message.data.groupKey } : {})
          }
        },
        ...(message.data ? { data: message.data } : {})
      }
    };

    try {
      const response = await post(
        FCM_HOST,
        `/v1/projects/${encodeURIComponent(this.config.projectId)}/messages:send`,
        JSON.stringify(payload),
        { "Content-Type": "application/json", Authorization: `Bearer ${token}` }
      );
      if (response.status >= 200 && response.status < 300) {
        return { ok: true, name: typeof response.json.name === "string" ? response.json.name : undefined };
      }
      // FCM nests the useful part: error.status names the class, and
      // error.details carries the specific FCM reason when there is one.
      const error = (response.json.error ?? {}) as Record<string, unknown>;
      const details = Array.isArray(error.details) ? (error.details as Array<Record<string, unknown>>) : [];
      const fcm = details.find(entry => typeof entry.errorCode === "string");
      return {
        ok: false,
        status: String(fcm?.errorCode ?? error.status ?? `HTTP_${response.status}`),
        detail: String(error.message ?? response.raw.slice(0, 300))
      };
    } catch (error) {
      return { ok: false, status: "NETWORK", detail: error instanceof Error ? error.message : String(error) };
    }
  }
}
