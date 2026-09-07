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
}

const toDevice = (row: DeviceRow): DeviceRecord => ({
  id: row.id,
  label: row.label,
  platform: row.platform as DeviceRecord["platform"],
  pushToken: row.push_token,
  status: row.status as DeviceRecord["status"],
  registeredAt: row.registered_at,
  lastSentAt: row.last_sent_at,
  lastFailure: row.last_failure
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
}
