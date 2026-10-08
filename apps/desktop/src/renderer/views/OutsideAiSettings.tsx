/**
 * Settings → Outside AI.
 *
 * DexNest works without it. Turned on, it lets DexNest ask a service on the
 * internet for help, using the user's own OpenRouter key. The user chooses
 * which kinds of data it may see and where it is used; this card says exactly
 * what leaves the computer and what never does. Nothing is sent until the
 * main switch, a use, and the data that use needs are all on.
 */

import React, { useEffect, useState } from "react";
import { Button, Card, Field, InlineError, Notice, SectionTitle, TextInput } from "../components/ui/kit";

import { confidenceFromPercent, DATA_LABELS, missingData, OUTSIDE_AI_DATA, OUTSIDE_AI_USES, sendingSummary, USE_LABELS, type OutsideAiSettingsValue, type OutsideAiState } from "./outsideAiModel";

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
  const [model, setModel] = useState("");
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const take = (next: OutsideAiState | undefined | null) => {
    if (!next) return;
    setState(next);
    setPercent(String(Math.round(next.settings.minConfidence * 100)));
    setModel(next.settings.writingModel);
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
          DexNest works without this. Turned on, it lets DexNest ask a service on the internet (through OpenRouter, with your own key) for help with the things you choose below, using only the kinds of data you choose below. A decision model picks an answer from a fixed list; a writing model writes a few sentences. DexNest does the rest itself.
        </p>
        <ul className="modset-hint">
          <li><strong>Sent:</strong> only the kinds of data you switch on under "What Outside AI may see", and only for the uses you switch on under "Where it is used".</li>
          <li><strong>Never sent:</strong> anything from the Vault, Finance or Journal, files and documents, the clipboard, or anything secret. A command, question or note that mentions a password, an identity document, money, a long number, an email or a link is not sent either.</li>
          <li><strong>Logged:</strong> every request, in the activity log: when, for what, how much text, how long it took. The words themselves are not logged.</li>
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
          <p className="modset-hint">None of this has been tried against the real service yet, only against a stand-in. If Test fails, turn it off and say what it showed.</p>
        </form>

        <div className="modset-form" role="group" aria-label="Use Outside AI">
          <label className="modset-check">
            <input type="checkbox" checked={settings.enabled} disabled={busy || (!state.hasKey && !settings.enabled)} onChange={(e) => void change({ enabled: e.target.checked }, e.target.checked ? "Outside AI is on." : "Outside AI is off.")} />
            Use Outside AI
          </label>
        </div>

        <div className="modset-form" role="group" aria-labelledby="outside-ai-data">
          <h3 id="outside-ai-data">What Outside AI may see</h3>
          <p className="modset-hint">Each kind is off until you turn it on. Something that needs a kind you have left off does not work and sends nothing. There is no switch for the Vault, Finance, the Journal, your files and documents, the clipboard or anything secret: those are never sent.</p>
          {OUTSIDE_AI_DATA.map((kind) => (
            <label key={kind} className="modset-check">
              <input type="checkbox" checked={settings.data[kind]} disabled={busy || !settings.enabled} onChange={(e) => void change({ data: { ...settings.data, [kind]: e.target.checked } }, "Saved.")} />
              <span><strong>{DATA_LABELS[kind].name}.</strong> {DATA_LABELS[kind].detail}</span>
            </label>
          ))}
        </div>

        <div className="modset-form" role="group" aria-labelledby="outside-ai-uses">
          <h3 id="outside-ai-uses">Where it is used</h3>
          {OUTSIDE_AI_USES.map((use) => {
            const missing = missingData(settings, use);
            return (
              <label key={use} className="modset-check">
                <input type="checkbox" checked={settings.surfaces[use]} disabled={busy || !settings.enabled || (missing.length > 0 && !settings.surfaces[use])} onChange={(e) => void change({ surfaces: { ...settings.surfaces, [use]: e.target.checked } }, "Saved.")} />
                <span>
                  {USE_LABELS[use].name}
                  {missing.length > 0 && <span className="modset-hint"> (needs: {missing.map((kind) => DATA_LABELS[kind].name).join(", ")}{settings.surfaces[use] ? "; sends nothing until then" : ""})</span>}
                </span>
              </label>
            );
          })}
          <p className="modset-hint">Commands are sent only when DexNest's own rules cannot tell what you meant. Everything else is sent only when you click its button, and nothing it suggests happens until you click again: a note is not moved, a rule is not saved, a skill is not hidden, a commit is not made.</p>
          <p className="modset-hint">Suggest sends that one note's title and text when you click it, never an attached file. It only suggests Calendar, Journal, ObjectOS or Drop, and nothing moves until you click the suggestion. A note that reads like a Vault or Finance item is not sent.</p>
          <Field label="How sure the answer must be (%)" htmlFor="outside-ai-confidence" hint="50 to 99. Below this, the answer is ignored and DexNest's own rules decide.">
            <TextInput id="outside-ai-confidence" className="technical" inputMode="numeric" value={percent} onChange={(e) => setPercent(e.target.value)} onBlur={() => { const next = confidenceFromPercent(percent, settings.minConfidence); if (next !== settings.minConfidence) void change({ minConfidence: next }, "Saved."); else setPercent(String(Math.round(next * 100))); }} />
          </Field>
          <Field label="Model that writes text" htmlFor="outside-ai-writing-model" hint="Used for the Standup in words, commit drafts, sorting skills, checking TODOs and answers. Any model OpenRouter offers, written as maker/model. Picking from a list (commands, Capture, rules) always uses the decision model.">
            <TextInput id="outside-ai-writing-model" className="technical" value={model} onChange={(e) => setModel(e.target.value)} onBlur={() => { if (model.trim() !== settings.writingModel) void change({ writingModel: model.trim() }, "Saved."); }} />
          </Field>
          <div className="button-row">
            <Button type="button" disabled={busy || !state.hasKey} onClick={() => void act("outside_ai.test_writing", {}, "The writing model answered.")}>Test the writing model</Button>
          </div>
        </div>
        {note && (note.ok ? <Notice>{note.text}</Notice> : <InlineError>{note.text}</InlineError>)}
      </Card>
    </div>
  );
}
