// OAuth for a desktop app, done the way desktop apps are supposed to do it.
//
// THE LOOPBACK FLOW
//
// DexNest opens a browser, listens on 127.0.0.1 for the redirect, and takes
// the code from the query string. No embedded webview — a webview would mean
// the operator typing a Google password into a window DexNest controls, which
// is indistinguishable from what a credential thief does and which Google
// blocks anyway.
//
// PKCE IS NOT OPTIONAL HERE
//
// A desktop client's secret is inside a file on disk, so it is not a secret.
// PKCE is what actually proves the code is being redeemed by the same process
// that asked for it: a verifier is generated per attempt, only its hash goes
// out with the request, and the verifier itself only ever travels to the token
// endpoint over TLS.
//
// WHAT THIS FILE NEVER DOES
//
// It never writes a token anywhere. It returns them and forgets. Storage is
// the caller's problem precisely because the caller has a keychain and this
// has a socket.

import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { shell } from "electron";

/** Long enough to sign in and pick an account; short enough to not sit open. */
const AUTH_TIMEOUT_MS = 5 * 60 * 1000;

export interface OAuthTokens {
  accessToken: string;
  /** Absent when the provider declined to issue one — treated as a failure. */
  refreshToken: string | null;
  expiresAt: string;
  scope: string | null;
}

export interface OAuthConfig {
  authUrl: string;
  tokenUrl: string;
  clientId: string;
  /** Google's installed-app flow still wants one; Microsoft's public client does not. */
  clientSecret?: string | null;
  scopes: string[];
  /** Provider-specific extras, e.g. Google's access_type=offline. */
  extraAuthParams?: Record<string, string>;
}

const base64url = (input: Buffer): string => input.toString("base64url");

/** A page the browser can land on, so the operator is not left on a blank tab. */
function landing(title: string, message: string): string {
  return `<!doctype html><meta charset="utf-8"><title>${title}</title>
<style>
  :root { color-scheme: dark light }
  body { font: 15px/1.5 system-ui, sans-serif; margin: 0; display: grid; place-items: center;
         min-height: 100vh; background: #0b0b0d; color: #f4f4f5 }
  .card { max-width: 26rem; padding: 2rem; text-align: center }
  h1 { font-size: 1.15rem; margin: 0 0 .5rem }
  p { color: #a1a1aa; margin: 0 }
</style>
<div class="card"><h1>${title}</h1><p>${message}</p></div>`;
}

/**
 * Runs one sign-in and returns the tokens.
 *
 * Binds to port 0 so the OS picks a free one — a fixed port would collide with
 * whatever else is running and would also let any other local process guess
 * where to send a forged redirect.
 */
export async function authorise(config: OAuthConfig): Promise<OAuthTokens> {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  // Binds the redirect to this attempt. A response carrying a different state
  // is someone else's, or a forgery, and is refused rather than redeemed.
  const state = base64url(randomBytes(16));

  // Typed through a holder because TypeScript narrows a plain `let` to never
  // here: it cannot see that the executor's assignment happens before finally.
  const held: { server: Server | null } = { server: null };
  try {
    const { port, code } = await new Promise<{ port: number; code: string }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Sign-in timed out. Try connecting the account again.")), AUTH_TIMEOUT_MS);

      const server = createServer((request, response) => {
        const url = new URL(request.url ?? "/", "http://127.0.0.1");
        if (url.pathname !== "/callback") {
          response.writeHead(404).end();
          return;
        }

        const error = url.searchParams.get("error");
        const returned = url.searchParams.get("state");
        const value = url.searchParams.get("code");

        const fail = (why: string) => {
          response.writeHead(400, { "Content-Type": "text/html; charset=utf-8" })
            .end(landing("Could not connect", why));
          clearTimeout(timer);
          reject(new Error(why));
        };

        if (error) return fail(`The provider refused: ${error}.`);
        if (returned !== state) return fail("That sign-in did not match the one DexNest started.");
        if (!value) return fail("No authorisation code came back.");

        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
          .end(landing("Connected", "You can close this tab and return to DexNest."));
        clearTimeout(timer);
        const address = server.address();
        resolve({ port: typeof address === "object" && address ? address.port : 0, code: value });
      });

      held.server = server;
      server.on("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        const listening = typeof address === "object" && address ? address.port : 0;
        const params = new URLSearchParams({
          client_id: config.clientId,
          redirect_uri: `http://127.0.0.1:${listening}/callback`,
          response_type: "code",
          scope: config.scopes.join(" "),
          state,
          code_challenge: challenge,
          code_challenge_method: "S256",
          ...config.extraAuthParams
        });
        void shell.openExternal(`${config.authUrl}?${params.toString()}`);
      });
    });

    // The redirect_uri is sent again at exchange and must match exactly, which
    // is why the port is carried out of the promise rather than recomputed.
    const body = new URLSearchParams({
      client_id: config.clientId,
      code,
      code_verifier: verifier,
      grant_type: "authorization_code",
      redirect_uri: `http://127.0.0.1:${port}/callback`,
      ...(config.clientSecret ? { client_secret: config.clientSecret } : {})
    });

    return await exchange(config.tokenUrl, body);
  } finally {
    // Closed on every path. A listener left open after a failed sign-in is a
    // local port waiting to accept somebody else's redirect.
    held.server?.close();
  }
}

/** Trades a refresh token for a new access token. */
export async function refresh(config: OAuthConfig, refreshToken: string): Promise<OAuthTokens> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
    ...(config.clientSecret ? { client_secret: config.clientSecret } : {})
  });
  const tokens = await exchange(config.tokenUrl, body);
  // Google returns no refresh token on a refresh; the existing one stays valid
  // and must be carried forward, or the account silently disconnects itself
  // the first time its access token expires.
  return { ...tokens, refreshToken: tokens.refreshToken ?? refreshToken };
}

async function exchange(tokenUrl: string, body: URLSearchParams): Promise<OAuthTokens> {
  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: body.toString()
  });

  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    // The provider's own words, which are usually specific ("redirect_uri
    // mismatch") in a way a generic message could not be. No token is ever in
    // an error body, so this is safe to surface.
    const detail = String(payload.error_description ?? payload.error ?? response.status);
    throw new Error(`The provider rejected the sign-in: ${detail}`);
  }

  const expiresIn = Number(payload.expires_in ?? 3600);
  return {
    accessToken: String(payload.access_token ?? ""),
    refreshToken: payload.refresh_token ? String(payload.refresh_token) : null,
    // Sixty seconds early, so a token cannot expire between the check and the
    // request it was checked for.
    expiresAt: new Date(Date.now() + (expiresIn - 60) * 1000).toISOString(),
    scope: payload.scope ? String(payload.scope) : null
  };
}
