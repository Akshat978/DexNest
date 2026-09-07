// The phones DexNest may speak to.
//
// A push token is what FCM needs to reach one installation of one app on one
// device. It is issued by the device, changes when the app is reinstalled or
// the token is rotated, and is useless to anyone without the sending
// credentials — but it still names a device the operator owns, so it is
// durable state with a history rather than a value kept in memory.
//
// WHAT THIS IS NOT
//
// Not a pairing token, and not authority. Registering a device says "send
// notifications here". It grants nothing: reading a run or answering a
// question happens over the control path, with its own token and its own
// capabilities, and that is deliberately a separate decision made later.
//
// A device that stops accepting messages is disabled rather than deleted. The
// record of what was sent where is worth keeping, and a token that FCM has
// rejected is evidence, not noise.

import type { RuntimePorts, SqlDatabase } from "./ports.ts";
import { AutopilotStore } from "./store.ts";

/**
 * What a paired device may do.
 *
 * Read and control are separate on purpose. Seeing that a run is blocked is a
 * far smaller thing to hand a phone than being able to stop one, and bundling
 * them would mean deciding both at the moment someone is fumbling with a
 * pairing code. A device starts with read; control is granted afterwards, at
 * the desktop, deliberately.
 */
export type DeviceCapability = "read" | "control";

export interface DeviceRecord {
  id: string;
  /** What the operator calls it, e.g. "Akshat's S24 Ultra". */
  label: string;
  platform: "android" | "ios" | "unknown";
  /** The FCM registration token. Rotates; matched on id, not on this. */
  pushToken: string;
  status: "ACTIVE" | "DISABLED";
  registeredAt: string;
  lastSentAt: string | null;
  /** Why FCM last refused it, when it did. */
  lastFailure: string | null;
  /** What this device may do. Empty until it pairs. */
  capabilities: DeviceCapability[];
  pairedAt: string | null;
  lastSeenAt: string | null;
  /** Whether it holds a token at all. The token itself is never returned. */
  paired: boolean;
}

interface DeviceRow {
  id: string;
  label: string;
  platform: string;
  push_token: string;
  status: string;
  registered_at: string;
  last_sent_at: string | null;
  last_failure: string | null;
  token_hash: string | null;
  capabilities: string | null;
  paired_at: string | null;
  last_seen_at: string | null;
}

const toDevice = (row: DeviceRow): DeviceRecord => ({
  id: row.id,
  label: row.label,
  platform: row.platform as DeviceRecord["platform"],
  pushToken: row.push_token,
  status: row.status as DeviceRecord["status"],
  registeredAt: row.registered_at,
  lastSentAt: row.last_sent_at,
  lastFailure: row.last_failure,
  capabilities: String(row.capabilities ?? "")
    .split(",")
    .map(value => value.trim())
    .filter((value): value is DeviceCapability => value === "read" || value === "control"),
  pairedAt: row.paired_at,
  lastSeenAt: row.last_seen_at,
  // Never the hash itself: this record reaches the renderer, and a value that
  // authenticates has no business being rendered.
  paired: Boolean(row.token_hash)
});

export class DeviceStore {
  private readonly ports: RuntimePorts;
  private readonly db: SqlDatabase;
  private readonly store: AutopilotStore;

  constructor(ports: RuntimePorts) {
    this.ports = ports;
    this.db = ports.db;
    this.store = new AutopilotStore(ports);
  }

  available(): boolean {
    return Boolean(
      this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='autopilot_devices'").get()
    );
  }

  list(): DeviceRecord[] {
    if (!this.available()) return [];
    return this.db
      .prepare("SELECT * FROM autopilot_devices ORDER BY registered_at")
      .all<DeviceRow>({})
      .map(toDevice);
  }

  /** The devices a notification should actually go to. */
  active(): DeviceRecord[] {
    return this.list().filter(device => device.status === "ACTIVE");
  }

  /**
   * Registers a device, or updates the one that already holds this token.
   *
   * Matched on the token because that is what the device knows about itself. A
   * reinstall issues a new token and registers as a new device; the old record
   * stays until FCM rejects it, which is when we learn it is gone.
   */
  register(input: { label: string; platform?: DeviceRecord["platform"]; pushToken: string }): DeviceRecord {
    if (!this.available()) throw new Error("This database is too old to hold devices.");
    const token = String(input.pushToken ?? "").trim();
    if (!token) throw new Error("A device needs a push token: none was given. Register from the app, which issues one.");
    const label = String(input.label ?? "").trim() || "a phone";

    return this.store.transaction(() => {
      const existing = this.db.prepare("SELECT * FROM autopilot_devices WHERE push_token=:token").get<DeviceRow>({ token });
      const now = this.ports.clock.now();
      if (existing) {
        // Re-registering is how a device says it is still here, so it also
        // clears a failure that may since have been fixed.
        this.db
          .prepare("UPDATE autopilot_devices SET label=:label, status='ACTIVE', last_failure=NULL WHERE id=:id")
          .run({ id: existing.id, label });
        return this.get(existing.id)!;
      }
      const id = this.ports.ids.next("device");
      this.db
        .prepare(
          `INSERT INTO autopilot_devices (id, label, platform, push_token, status, registered_at)
           VALUES (:id, :label, :platform, :token, 'ACTIVE', :now)`
        )
        .run({ id, label, platform: input.platform ?? "android", token, now });
      return this.get(id)!;
    });
  }

  get(id: string): DeviceRecord | null {
    if (!this.available()) return null;
    const row = this.db.prepare("SELECT * FROM autopilot_devices WHERE id=:id").get<DeviceRow>({ id });
    return row ? toDevice(row) : null;
  }

  /** Records that something reached this device. */
  markSent(id: string): void {
    if (!this.available()) return;
    this.db
      .prepare("UPDATE autopilot_devices SET last_sent_at=:now, last_failure=NULL WHERE id=:id")
      .run({ id, now: this.ports.clock.now() });
  }

  /**
   * Records that FCM refused it.
   *
   * A token FCM calls UNREGISTERED or INVALID_ARGUMENT is gone for good — the
   * app was uninstalled, or the token rotated — so the device is disabled
   * rather than retried forever. Anything else is a transient failure worth
   * keeping the device for.
   */
  markFailed(id: string, failure: string): void {
    if (!this.available()) return;
    const permanent = /UNREGISTERED|INVALID_ARGUMENT|NOT_FOUND/i.test(failure);
    this.db
      .prepare(`UPDATE autopilot_devices SET last_failure=:failure${permanent ? ", status='DISABLED'" : ""} WHERE id=:id`)
      .run({ id, failure: failure.slice(0, 500) });
  }

  /** Forgets a device entirely. The operator's own decision, never automatic. */
  remove(id: string): void {
    if (!this.available()) return;
    this.db.prepare("DELETE FROM autopilot_devices WHERE id=:id").run({ id });
  }

  // --- pairing ---------------------------------------------------------------
  //
  // The token itself never enters this file. The host hashes it and passes the
  // hash; the device is shown the real thing once, at pairing, and keeps it in
  // Android's keystore. A database anyone can read should not also be a
  // database anyone can authenticate with.

  /** Opens a pairing window. The code is short so a person can read it aloud. */
  openPairing(code: string, ttlMinutes = 10): { code: string; expiresAt: string } {
    if (!this.pairingAvailable()) throw new Error("This database is too old to pair devices.");
    const now = this.ports.clock.now();
    const expiresAt = new Date(Date.parse(now) + ttlMinutes * 60_000).toISOString();
    // One open code at a time. Two live codes would mean an operator could not
    // tell which screen belonged to the phone in their hand.
    this.db.prepare("DELETE FROM autopilot_pairings WHERE used_at IS NULL").run({});
    this.db
      .prepare("INSERT INTO autopilot_pairings (code, created_at, expires_at) VALUES (:code, :now, :expiresAt)")
      .run({ code, now, expiresAt });
    return { code, expiresAt };
  }

  /** The code currently on offer, if one is still open and unexpired. */
  openPairingCode(): { code: string; expiresAt: string } | null {
    if (!this.pairingAvailable()) return null;
    const row = this.db
      .prepare("SELECT code, expires_at FROM autopilot_pairings WHERE used_at IS NULL ORDER BY rowid DESC LIMIT 1")
      .get<{ code: string; expires_at: string }>({});
    if (!row) return null;
    if (Date.parse(row.expires_at) <= Date.parse(this.ports.clock.now())) return null;
    return { code: row.code, expiresAt: row.expires_at };
  }

  /**
   * Completes a pairing: binds a device to a token hash, with read only.
   *
   * Control is a separate grant made afterwards at the desktop. A code is
   * single use and expiring, or it would be a password nobody remembers
   * setting.
   */
  completePairing(input: {
    code: string;
    tokenHash: string;
    label: string;
    platform?: DeviceRecord["platform"];
    pushToken?: string;
  }): DeviceRecord {
    if (!this.pairingAvailable()) throw new Error("This database is too old to pair devices.");
    const now = this.ports.clock.now();

    return this.store.transaction(() => {
      const pairing = this.db
        .prepare("SELECT * FROM autopilot_pairings WHERE code=:code")
        .get<{ code: string; expires_at: string; used_at: string | null }>({ code: input.code });
      if (!pairing) throw new Error("That pairing code is not one this machine issued.");
      if (pairing.used_at) throw new Error("That pairing code has already been used. Ask the desktop for a new one.");
      if (Date.parse(pairing.expires_at) <= Date.parse(now)) throw new Error("That pairing code has expired. Ask the desktop for a new one.");

      const device = input.pushToken
        ? this.register({ label: input.label, ...(input.platform ? { platform: input.platform } : {}), pushToken: input.pushToken })
        : this.register({ label: input.label, ...(input.platform ? { platform: input.platform } : {}), pushToken: `pending:${input.tokenHash.slice(0, 24)}` });

      this.db
        .prepare(
          `UPDATE autopilot_devices
              SET token_hash=:hash, capabilities='read', paired_at=:now, last_seen_at=:now
            WHERE id=:id`
        )
        .run({ id: device.id, hash: input.tokenHash, now });
      this.db.prepare("UPDATE autopilot_pairings SET used_at=:now, device_id=:id WHERE code=:code").run({
        code: input.code, now, id: device.id
      });
      return this.get(device.id)!;
    });
  }

  /**
   * The device holding this token hash.
   *
   * Deliberately NOT filtered on status. `status` is about whether push can
   * reach the device, and it goes DISABLED when FCM permanently rejects a push
   * token — which happens on its own, when Android rotates one. Treating that
   * as a loss of authority would mean a phone silently stopped being able to
   * read or answer because its *delivery address* went stale, and the fix
   * (re-pair) would be nothing to do with the cause.
   *
   * A pairing ends when the operator ends it, and at no other time.
   */
  byTokenHash(tokenHash: string): DeviceRecord | null {
    if (!this.pairingAvailable()) return null;
    const row = this.db
      .prepare("SELECT * FROM autopilot_devices WHERE token_hash=:hash")
      .get<DeviceRow>({ hash: tokenHash });
    return row ? toDevice(row) : null;
  }

  /**
   * Updates where to push, without re-pairing.
   *
   * A push token rotates on its own — a reinstall, an Android decision — and
   * making someone re-pair every time it did would make the whole thing feel
   * broken. Identity is the paired token; this is only an address.
   */
  setPushToken(id: string, pushToken: string): void {
    if (!this.available()) return;
    this.db
      .prepare("UPDATE autopilot_devices SET push_token=:token, status='ACTIVE', last_failure=NULL WHERE id=:id")
      .run({ id, token: pushToken });
  }

  /** Records that a paired device made a request. */
  markSeen(id: string): void {
    if (!this.pairingAvailable()) return;
    this.db.prepare("UPDATE autopilot_devices SET last_seen_at=:now WHERE id=:id").run({ id, now: this.ports.clock.now() });
  }

  /** Grants or withdraws control. Always the operator's decision, at the desktop. */
  setCapabilities(id: string, capabilities: readonly DeviceCapability[]): DeviceRecord | null {
    if (!this.pairingAvailable()) return null;
    // Read is implied by holding a token at all; control is the real decision.
    const unique = [...new Set(["read", ...capabilities])].join(",");
    this.db.prepare("UPDATE autopilot_devices SET capabilities=:capabilities WHERE id=:id").run({ id, capabilities: unique });
    return this.get(id);
  }

  /** Revokes a device's token without forgetting what it was sent. */
  unpair(id: string): DeviceRecord | null {
    if (!this.pairingAvailable()) return null;
    this.db
      .prepare("UPDATE autopilot_devices SET token_hash=NULL, capabilities='read', paired_at=NULL WHERE id=:id")
      .run({ id });
    return this.get(id);
  }

  private pairingAvailable(): boolean {
    return (
      this.available() &&
      this.db.prepare("SELECT name FROM pragma_table_info('autopilot_devices') WHERE name='token_hash'").all<{ name: string }>({}).length > 0
    );
  }
}
