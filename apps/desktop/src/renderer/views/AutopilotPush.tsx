// Where notifications go, and when they keep quiet.
//
// This is the settings half of the mobile companion. It holds the PATH to a
// Firebase service account, never its contents — the credential is read at the
// moment of sending and never copied into the database, the renderer, or a log
// line. Nothing on this screen ever displays it.
//
// Push is off until it is deliberately turned on. A default that started
// sending to a phone the moment one registered would be exactly the kind of
// surprise that makes someone turn the whole thing off.

import React, { useEffect, useState } from "react";
import type { DeviceRecord } from "@dexnest/autopilot-runtime";

interface PushSettings {
  serviceAccountPath: string;
  projectId: string;
  quietStart: string;
  quietEnd: string;
  enabled: boolean;
}

interface PushBridge {
  autopilotDevices(): Promise<DeviceRecord[]>;
  autopilotDeviceRegister(input: { label: string; platform?: "android" | "ios"; pushToken: string }): Promise<DeviceRecord>;
  autopilotDeviceRemove(id: string): Promise<void>;
  autopilotPushSettings(): Promise<PushSettings | null>;
  autopilotPushSettingsSave(settings: PushSettings): Promise<PushSettings | null>;
  autopilotPushVerify(): Promise<{ ok: boolean; detail: string }>;
  autopilotPushTest(deviceId: string): Promise<{ ok: boolean; detail: string }>;
}
const api = () => (window as unknown as { dexNest: PushBridge }).dexNest;

const EMPTY: PushSettings = {
  serviceAccountPath: "",
  projectId: "",
  quietStart: "23:00",
  quietEnd: "08:00",
  enabled: false
};

export function AutopilotPush({ refreshedAt }: { refreshedAt: number }) {
  const [settings, setSettings] = useState<PushSettings>(EMPTY);
  const [devices, setDevices] = useState<DeviceRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [pasteToken, setPasteToken] = useState("");
  const [pasteLabel, setPasteLabel] = useState("");
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const load = () => {
    void api().autopilotPushSettings().then(value => setSettings(value ?? EMPTY)).catch(() => setSettings(EMPTY));
    void api().autopilotDevices().then(setDevices).catch(() => setDevices([]));
  };
  useEffect(load, [refreshedAt]);

  const act = (fn: () => Promise<{ ok: boolean; detail: string } | unknown>) => {
    setBusy(true);
    setNote(null);
    void Promise.resolve(fn())
      .then(result => {
        const outcome = result as { ok?: boolean; detail?: string } | null;
        if (outcome && typeof outcome.ok === "boolean") setNote({ ok: outcome.ok, text: outcome.detail ?? "" });
        load();
      })
      .catch((cause: unknown) => setNote({ ok: false, text: cause instanceof Error ? cause.message : String(cause) }))
      .finally(() => setBusy(false));
  };

  return (
    <section className="view-stack" aria-label="Notifications">
      <div className="card">
        <h3>Where notifications go</h3>
        <p className="technical">
          DexNest sends straight to Firebase Cloud Messaging from this machine. The service account below is read
          when a notification is sent and never copied anywhere — not into the database, not into a log.
        </p>

        <label>
          Service account file
          <input
            value={settings.serviceAccountPath}
            disabled={busy}
            placeholder="D:\\dexnest-secrets\\...-firebase-adminsdk-....json"
            onChange={event => setSettings({ ...settings, serviceAccountPath: event.target.value })}
          />
        </label>
        <label>
          Firebase project id
          <input
            value={settings.projectId}
            disabled={busy}
            placeholder="dexnest-f1036"
            onChange={event => setSettings({ ...settings, projectId: event.target.value })}
          />
        </label>

        <div className="row">
          <label>
            Quiet from
            <input type="time" value={settings.quietStart} disabled={busy}
              onChange={event => setSettings({ ...settings, quietStart: event.target.value })} />
          </label>
          <label>
            until
            <input type="time" value={settings.quietEnd} disabled={busy}
              onChange={event => setSettings({ ...settings, quietEnd: event.target.value })} />
          </label>
        </div>
        <p className="technical">
          Routine news waits until quiet hours end. Anything that cannot continue without you still comes through —
          a quiet system is not a silent one.
        </p>

        <label>
          <input type="checkbox" checked={settings.enabled} disabled={busy}
            onChange={event => setSettings({ ...settings, enabled: event.target.checked })} />
          Send notifications to registered devices
        </label>

        {note && <p className={note.ok ? "technical" : "autopilot-error"}>{note.text}</p>}

        <div className="row">
          <button type="button" disabled={busy} onClick={() => act(() => api().autopilotPushSettingsSave(settings))}>
            SAVE
          </button>
          <button type="button" disabled={busy} onClick={() => act(() => api().autopilotPushVerify())}>
            CHECK CREDENTIALS
          </button>
        </div>
        <p className="technical">
          Checking proves Google accepts the account. Whether the FCM API is enabled only shows up on a real send,
          so it says that rather than implying more than it tested.
        </p>
      </div>

      <div className="card">
        <h3>Devices</h3>
        {devices.length === 0 && (
          <p className="technical">No devices yet.</p>
        )}

        {/* Until the phone can reach DexNest over Tailscale it cannot register
            itself, so the token is carried across by hand. Deliberately a
            stopgap, and labelled as one — a permanent copy-paste step would be
            a design that gave up. */}
        <details className="autopilot-mechanism" open={devices.length === 0}>
          <summary>Add a device by pasting its token</summary>
          <p className="technical">
            The phone app shows a token and a COPY button. Paste it here. Once the control path exists the phone
            will register itself and this goes away.
          </p>
          <label>
            What to call it
            <input value={pasteLabel} disabled={busy} placeholder="e.g. Akshat's S24 Ultra"
              onChange={event => setPasteLabel(event.target.value)} />
          </label>
          <label>
            Token
            <textarea rows={3} value={pasteToken} disabled={busy} placeholder="paste the token from the phone"
              onChange={event => setPasteToken(event.target.value)} />
          </label>
          <div className="row">
            <button type="button" disabled={busy || !pasteToken.trim()}
              onClick={() => act(async () => {
                await api().autopilotDeviceRegister({
                  label: pasteLabel.trim() || "a phone",
                  platform: "android",
                  pushToken: pasteToken.trim()
                });
                setPasteToken("");
                setPasteLabel("");
                return { ok: true, detail: "Device registered." };
              })}>
              REGISTER DEVICE
            </button>
          </div>
        </details>
        <ul className="autopilot-devices">
          {devices.map(device => (
            <li key={device.id} className={device.status === "ACTIVE" ? undefined : "device-disabled"}>
              <strong>{device.label}</strong>
              <span className="technical">
                {" — "}{device.platform}
                {device.status === "ACTIVE" ? "" : " · disabled"}
                {device.lastSentAt ? ` · last reached ${new Date(device.lastSentAt).toLocaleString()}` : " · never reached"}
              </span>
              {device.lastFailure && <p className="autopilot-error">{device.lastFailure}</p>}
              <div className="row">
                <button type="button" disabled={busy || !settings.enabled}
                  onClick={() => act(() => api().autopilotPushTest(device.id))}>
                  SEND A TEST
                </button>
                <button type="button" disabled={busy} onClick={() => act(() => api().autopilotDeviceRemove(device.id))}>
                  FORGET
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
