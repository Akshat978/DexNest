/**
 * Settings → Outside AI.
 *
 * DexNest works without it. Turned on, it lets a command the local rules
 * cannot place be sent, as words, to a decision service on the internet,
 * using the user's own OpenRouter key. This card says exactly what leaves the
 * computer and what never does, and nothing is sent until both the main
 * switch and a place to use it are on.
 */

import React, { useEffect, useState } from "react";
import { Button, Card, Field, InlineError, Notice, SectionTitle, TextInput } from "../components/ui/kit";

import { confidenceFromPercent, sendingSummary, type OutsideAiSettingsValue, type OutsideAiState } from "./outsideAiModel";

export type { OutsideAiState } from "./outsideAiModel";

export interface OutsideAiBridge {
  getOutsideAiState?(): Promise<OutsideAiState>;
  setOutsideAiKey?(value: string): Promise<{ ok: boolean; error?: string; state?: OutsideAiState }>;
}

type ActionResult = { ok?: boolean; error?: string; message?: string; state?: OutsideAiState } | null | undefined;

export function OutsideAiSettings({ bridge, onAction }: { bridge: OutsideAiBridge; onAction(actionId: string, params?: Record<string, unknown>): Promise<unknown> }) {
  const [state, setState] = useState<OutsideAiState | null>(null);
  const [key, setKey] = useState("");
  const [percent, setPercent] = useState("70");
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const take = (next: OutsideAiState | undefined | null) => {
    if (!next) return;
    setState(next);
    setPercent(String(Math.round(next.settings.minConfidence * 100)));
  };

  useEffect(() => {
    let live = true;
    void (bridge.getOutsideAiState?.() ?? Promise.resolve(null)).then((next) => { if (live) take(next); }).catch(() => undefined);
    return () => { live = false; };
  }, [bridge]);

  if (!state) return <p className="modset-hint">Outside AI is not available in this build.</p>;

  async function act(actionId: string, params: Record<string, unknown>, done: string) {
    setBusy(true);
    try {
      const result = (await onAction(actionId, params)) as ActionResult;
      take(result?.state);
      setNote(result?.ok === false ? { ok: false, text: result.error ?? "That did not work." } : { ok: true, text: result?.message ?? done });
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : "That did not work." });
    } finally {
      setBusy(false);
    }
  }

  const change = (settings: Partial<OutsideAiSettingsValue>, done: string) => act("outside_ai.update_settings", { settings: { ...state.settings, ...settings } }, done);

  async function saveKey(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await bridge.setOutsideAiKey?.(key);
      if (result?.ok) {
        take(result.state);
        setKey("");
        setNote({ ok: true, text: "Key saved, encrypted on this computer. It is not shown again." });
      } else {
        setNote({ ok: false, text: result?.error ?? "The key could not be saved." });
      }
    } finally {
      setBusy(false);
    }
  }

  const { settings } = state;
  return (
    <div className="modset">
      <Card aria-labelledby="outside-ai-title">
        <SectionTitle id="outside-ai-title">Outside AI</SectionTitle>
        <div className="modset-form">
        <p role="status">{sendingSummary(state)}</p>
        <p className="modset-hint">
          DexNest understands commands with rules on this computer. When they cannot tell what you meant, this lets the words of that one command be sent to a decision service (Jev, through OpenRouter, with your own key), which picks one meaning from a fixed list. DexNest then does the rest itself.
        </p>
        <ul className="modset-hint">
          <li><strong>Sent:</strong> the words of the command, up to 300 characters.</li>
          <li><strong>Never sent:</strong> anything from the Vault, Finance or Journal, files, the clipboard, search results, or your projects. A command that mentions a password, an identity document, money, a long number, an email or a link is not sent either.</li>
          <li><strong>Logged:</strong> every request, in the activity log: when, how long, what was decided. The words themselves are not logged.</li>
          <li>With this on, DexNest is not fully offline. OpenRouter is asked not to keep or train on the request; what it and the model's provider do with it is governed by their terms, not by DexNest.</li>
        </ul>
        </div>

        <form className="modset-form" aria-label="OpenRouter key" onSubmit={(e) => void saveKey(e)}>
          <Field label="OpenRouter key" htmlFor="outside-ai-key" hint={state.hasKey ? "A key is saved. Type a new one to replace it." : "Starts with sk-or-. Kept encrypted on this computer and never shown again."}>
            <TextInput id="outside-ai-key" className="technical" type="password" autoComplete="off" value={key} placeholder={state.hasKey ? "saved" : "sk-or-…"} onChange={(e) => setKey(e.target.value)} />
          </Field>
          {!state.canStoreKey && <InlineError>This computer cannot encrypt the key, so it cannot be saved.</InlineError>}
          <div className="button-row">
            <Button type="submit" variant="primary" disabled={busy || !key.trim() || !state.canStoreKey}>Save key</Button>
            <Button type="button" disabled={busy || !state.hasKey} onClick={() => void act("outside_ai.test", {}, "It works.")}>Test</Button>
            <Button type="button" variant="ghost" disabled={busy || !state.hasKey} onClick={() => void act("outside_ai.clear_key", {}, "Key removed. Outside AI is off.")}>Remove key</Button>
          </div>
          <p className="modset-hint">Test sends the fixed phrase "open the settings screen" and nothing of yours.</p>
        </form>

        <div className="modset-form" role="group" aria-label="Where Outside AI may be used">
          <label className="modset-check">
            <input type="checkbox" checked={settings.enabled} disabled={busy || (!state.hasKey && !settings.enabled)} onChange={(e) => void change({ enabled: e.target.checked }, e.target.checked ? "Outside AI is on." : "Outside AI is off.")} />
            Use Outside AI
          </label>
          <label className="modset-check">
            <input type="checkbox" checked={settings.surfaces.voice} disabled={busy || !settings.enabled} onChange={(e) => void change({ surfaces: { ...settings.surfaces, voice: e.target.checked } }, "Saved.")} />
            For commands you speak
          </label>
          <label className="modset-check">
            <input type="checkbox" checked={settings.surfaces.typed} disabled={busy || !settings.enabled} onChange={(e) => void change({ surfaces: { ...settings.surfaces, typed: e.target.checked } }, "Saved.")} />
            For commands you type into Ask DexNest
          </label>
          <Field label="How sure the answer must be (%)" htmlFor="outside-ai-confidence" hint="50 to 99. Below this, the answer is ignored and DexNest's own rules decide.">
            <TextInput id="outside-ai-confidence" className="technical" inputMode="numeric" value={percent} onChange={(e) => setPercent(e.target.value)} onBlur={() => { const next = confidenceFromPercent(percent, settings.minConfidence); if (next !== settings.minConfidence) void change({ minConfidence: next }, "Saved."); else setPercent(String(Math.round(next * 100))); }} />
          </Field>
        </div>
        {note && (note.ok ? <Notice>{note.text}</Notice> : <InlineError>{note.text}</InlineError>)}
      </Card>
    </div>
  );
}
