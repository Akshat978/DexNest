import React, { useCallback, useEffect, useRef, useState } from "react";
import type { AwardView, RealityRpgSettings, RealityRpgSnapshot, RealityRpgStatus, Rule } from "@dexnest/reality-rpg";
import { PageHeader } from "../components/shared";
import {
  countsFromLabel,
  actionMessage,
  awardSource,
  awardTitle,
  conditionUnit,
  EMPTY_QUEST_FORM,
  EMPTY_RULE_FORM,
  levelProgress,
  nextTab,
  orderAchievements,
  progressText,
  questFromForm,
  ruleFromForm,
  ruleSentence,
  shortDate,
  statShare,
  TAB_LABELS,
  TABS,
  viewState,
  type QuestForm,
  type RuleForm,
  type Tab
} from "./realityRpgModel";
import "./RealityRpg.css";

/** The preload methods this view uses. */
export interface RealityRpgBridge {
  realityRpgStatus(): Promise<RealityRpgStatus>;
  realityRpgSnapshot(): Promise<RealityRpgSnapshot>;
  realityRpgHistory(query?: { beforeSeq?: number; limit?: number }): Promise<AwardView[]>;
  realityRpgSettings(): Promise<RealityRpgSettings>;
  realityRpgUpdateSettings(settings: RealityRpgSettings): Promise<RealityRpgSettings>;
}

export interface RealityRpgViewProps {
  bridge: RealityRpgBridge;
  /** Runs a registered reality_rpg.* action through the action registry. */
  onAction(actionId: string, params?: Record<string, unknown>): Promise<unknown>;
  /** Tests only: start from a known state instead of loading. */
  initial?: { snapshot: RealityRpgSnapshot | null; error?: string | null; tab?: Tab; confirm?: Confirm | null };
}

/** A change that asks first: deleting a rule, abandoning a quest. */
export interface Confirm {
  actionId: string;
  params: Record<string, unknown>;
  question: string;
  confirmLabel: string;
}

type Ask = (confirm: Confirm) => void;

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong.";
}

export function RealityRpgView({ bridge, onAction, initial }: RealityRpgViewProps) {
  const [snapshot, setSnapshot] = useState<RealityRpgSnapshot | null>(initial?.snapshot ?? null);
  const [loading, setLoading] = useState(initial === undefined);
  const [error, setError] = useState<string | null>(initial?.error ?? null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(initial?.confirm ?? null);
  const [tab, setTab] = useState<Tab>(initial?.tab ?? "character");
  const tabRefs = useRef(new Map<Tab, HTMLButtonElement>());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSnapshot(await bridge.realityRpgSnapshot());
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }, [bridge]);

  useEffect(() => {
    if (initial === undefined) void load();
  }, [initial, load]);

  const run = useCallback(
    async (actionId: string, params: Record<string, unknown> = {}): Promise<boolean> => {
      setBusy(true);
      setNotice(null);
      try {
        const outcome = actionMessage(await onAction(actionId, params));
        if (outcome.text) setNotice({ ok: outcome.ok, text: outcome.text });
        await load();
        return outcome.ok;
      } catch (e) {
        setNotice({ ok: false, text: errorText(e) });
        return false;
      } finally {
        setBusy(false);
      }
    },
    [onAction, load]
  );

  const state = viewState({ loading, error, snapshot });

  function onTabKey(event: React.KeyboardEvent) {
    const next = nextTab(tab, event.key);
    if (!next) return;
    event.preventDefault();
    setTab(next);
    tabRefs.current.get(next)?.focus();
  }

  return (
    <section className="view-stack rpg" aria-labelledby="rpg-title" aria-busy={state.kind === "loading"}>
      <PageHeader
        eyebrow="Your activity, as a game"
        title="Reality RPG"
        titleId="rpg-title"
        actions={state.kind === "ready" || state.kind === "off" ? (
          <>
            {snapshot?.enabled && <button type="button" disabled={busy} onClick={() => void run("reality_rpg.refresh")}>Refresh</button>}
            {snapshot?.enabled ? (
              <button type="button" disabled={busy} onClick={() => void run("reality_rpg.disable")}>Turn off</button>
            ) : (
              <button type="button" disabled={busy} onClick={() => void run("reality_rpg.enable")}>Turn on</button>
            )}
          </>
        ) : undefined}
      />
      {notice && <p className={notice.ok ? "rpg-notice" : "rpg-notice rpg-notice--error"} role={notice.ok ? "status" : "alert"}>{notice.text}</p>}
      {confirm && (
        <ConfirmDialog
          confirm={confirm}
          busy={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            const c = confirm;
            setConfirm(null);
            void run(c.actionId, c.params);
          }}
        />
      )}

      {state.kind === "loading" && <p className="empty-state" role="status">Loading your character…</p>}

      {state.kind === "error" && (
        <div className="rpg-error" role="alert">
          <p>Reality RPG could not load: {state.message}</p>
          <div className="button-row">
            <button type="button" onClick={() => void load()}>Try again</button>
          </div>
        </div>
      )}

      {state.kind === "off" && (
        <div className="empty-state rpg-intro">
          <p>Reality RPG turns what you already do in DexNest into XP, achievements and quests, by rules you write. It reads only the event types your rules name, never vault, finance or journal activity, and never the content of an event.</p>
          <p>Start with a rule: open Rules below and add one from the starter set, or write your own.</p>
        </div>
      )}

      {(state.kind === "ready" || state.kind === "off") && snapshot && (
        <>
          <div className="rpg-tabs" role="tablist" aria-label="Reality RPG sections" onKeyDown={onTabKey}>
            {TABS.map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                id={`rpg-tab-${t}`}
                aria-selected={tab === t}
                aria-controls={`rpg-panel-${t}`}
                tabIndex={tab === t ? 0 : -1}
                ref={(node) => {
                  if (node) tabRefs.current.set(t, node);
                  else tabRefs.current.delete(t);
                }}
                onClick={() => setTab(t)}
              >
                {TAB_LABELS[t]}
              </button>
            ))}
          </div>
          <div className="rpg-panel" role="tabpanel" id={`rpg-panel-${tab}`} aria-labelledby={`rpg-tab-${tab}`} tabIndex={0}>
            {tab === "character" && <CharacterPanel snapshot={snapshot} />}
            {tab === "quests" && <QuestsPanel snapshot={snapshot} busy={busy} run={run} ask={setConfirm} />}
            {tab === "achievements" && <AchievementsPanel snapshot={snapshot} />}
            {tab === "history" && <HistoryPanel snapshot={snapshot} bridge={bridge} />}
            {tab === "rules" && <RulesPanel snapshot={snapshot} busy={busy} run={run} ask={setConfirm} />}
          </div>
        </>
      )}
    </section>
  );
}

function CharacterPanel({ snapshot }: { snapshot: RealityRpgSnapshot }) {
  const { sheet } = snapshot;
  const pct = levelProgress(sheet);
  return (
    <div className="rpg-sheet">
      <div className="rpg-level">
        <p className="rpg-level__number">Level <span className="technical">{sheet.level}</span></p>
        <p className="technical">{sheet.totalXp} XP</p>
        <progress className="rpg-bar" max={100} value={pct} aria-label={`Progress to level ${sheet.level + 1}`}>{pct}%</progress>
        <p className="rpg-hint">
          {sheet.xpToNextLevel === null ? "Top of the level curve." : `${sheet.xpToNextLevel} XP to level ${sheet.level + 1}.`}
        </p>
      </div>
      <h3>Stats</h3>
      {sheet.stats.length === 0 ? (
        <p className="empty-state">No XP yet. Switch on a rule and do the thing it names.</p>
      ) : (
        <ul className="rpg-stats">
          {sheet.stats.map((s) => (
            <li key={s.stat}>
              <span className="rpg-stat__name">{s.stat}</span>
              <span className="technical">{s.xp} XP</span>
              <span className="rpg-stat__bar" aria-hidden="true"><span style={{ width: `${statShare(s.xp, Math.max(...sheet.stats.map((x) => x.xp)))}%` }} /></span>
            </li>
          ))}
        </ul>
      )}
      {snapshot.lastRun && (
        <p className="rpg-hint">Last processed <time className="technical" dateTime={snapshot.lastRun.startedAt} title={snapshot.lastRun.startedAt}>{shortDate(snapshot.lastRun.startedAt)}</time>{snapshot.enabled ? "" : " · processing is off"}</p>
      )}
    </div>
  );
}

function AchievementsPanel({ snapshot }: { snapshot: RealityRpgSnapshot }) {
  const views = orderAchievements(snapshot.achievements);
  if (views.length === 0) return <p className="empty-state">No achievements defined. The starter set in Rules has a few.</p>;
  return (
    <ul className="rpg-list">
      {views.map(({ achievement, unlocked, progress }) => (
        <li key={achievement.id} className={unlocked ? "rpg-item rpg-item--done" : "rpg-item"}>
          <p className="rpg-item__title">{achievement.name}{unlocked ? " · unlocked" : ""}</p>
          <p className="rpg-hint">{achievement.description}</p>
          {unlocked ? (
            <p className="rpg-hint">Unlocked <time className="technical" dateTime={unlocked.unlockedAt}>{shortDate(unlocked.unlockedAt)}</time></p>
          ) : (
            <p className="technical">{progressText(progress.current, progress.target, conditionUnit(achievement.condition.kind))}</p>
          )}
        </li>
      ))}
    </ul>
  );
}

function QuestsPanel({ snapshot, busy, run, ask }: { snapshot: RealityRpgSnapshot; busy: boolean; run(actionId: string, params?: Record<string, unknown>): Promise<boolean>; ask: Ask }) {
  const [form, setForm] = useState<QuestForm>(EMPTY_QUEST_FORM);
  const active = snapshot.quests.filter((q) => q.quest.status === "active");
  const done = snapshot.quests.filter((q) => q.quest.status !== "active");
  return (
    <div className="rpg-quests">
      {active.length === 0 ? (
        <p className="empty-state">No active quests. Create one below.</p>
      ) : (
        <ul className="rpg-list">
          {active.map(({ quest, progress, completions }) => (
            <li key={quest.id} className="rpg-item">
              <p className="rpg-item__title">{quest.title}</p>
              <p className="technical">
                {progressText(progress.current, progress.target, conditionUnit(quest.condition.kind))}
                {quest.window.kind === "daily" ? " today" : quest.window.kind === "weekly" ? " this week" : ""}
                {quest.window.kind === "fixed" && !progress.open ? " · window closed" : ""}
              </p>
              {completions > 0 && <p className="rpg-hint">Completed {completions} time{completions === 1 ? "" : "s"}</p>}
              <button
                type="button"
                disabled={busy}
                onClick={() => ask({ actionId: "reality_rpg.quest.abandon", params: { questId: quest.id }, question: `Abandon "${quest.title}"? Its progress so far is kept in history, but the quest stops counting.`, confirmLabel: "Abandon" })}
                aria-label={`Abandon ${quest.title}`}
              >
                Abandon…
              </button>
            </li>
          ))}
        </ul>
      )}
      {done.length > 0 && <p className="rpg-hint">{done.length} finished or abandoned quest{done.length === 1 ? "" : "s"}.</p>}

      <form
        className="rpg-form"
        aria-label="New quest"
        onSubmit={(e) => {
          e.preventDefault();
          void run("reality_rpg.quest.create", { quest: questFromForm(form) }).then((ok) => ok && setForm(EMPTY_QUEST_FORM));
        }}
      >
        <h3>New quest</h3>
        <label>Title<input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required /></label>
        <label>
          Goal
          <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as QuestForm["kind"] })}>
            <option value="count">Times a rule awards</option>
            <option value="days">Days with an award from a rule</option>
            <option value="xp">XP earned</option>
          </select>
        </label>
        {form.kind === "xp" ? (
          <label>Stat (optional)<input value={form.stat} onChange={(e) => setForm({ ...form, stat: e.target.value })} /></label>
        ) : (
          <fieldset>
            <legend>Rules that count</legend>
            {snapshot.rules.length === 0 && <p className="rpg-hint">Add a rule first.</p>}
            {snapshot.rules.map((r) => (
              <label key={r.id} className="rpg-check">
                <input
                  type="checkbox"
                  checked={form.ruleIds.includes(r.id)}
                  onChange={(e) => setForm({ ...form, ruleIds: e.target.checked ? [...form.ruleIds, r.id] : form.ruleIds.filter((id) => id !== r.id) })}
                />
                {r.name}
              </label>
            ))}
          </fieldset>
        )}
        <label>Target<input type="number" min={1} value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} /></label>
        <label>
          Window
          <select value={form.window} onChange={(e) => setForm({ ...form, window: e.target.value as QuestForm["window"] })}>
            <option value="none">Until done</option>
            <option value="daily">Every day</option>
            <option value="weekly">Every week</option>
            <option value="fixed">Between two dates</option>
          </select>
        </label>
        {form.window === "fixed" && (
          <>
            <label>From<input type="date" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} /></label>
            <label>To<input type="date" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} /></label>
          </>
        )}
        <button type="submit" disabled={busy}>Create quest</button>
      </form>
    </div>
  );
}

function HistoryPanel({ snapshot, bridge }: { snapshot: RealityRpgSnapshot; bridge: RealityRpgBridge }) {
  const [rows, setRows] = useState<AwardView[]>(snapshot.recentAwards);
  const [more, setMore] = useState(snapshot.recentAwards.length >= 50);
  const [error, setError] = useState<string | null>(null);
  if (rows.length === 0) return <p className="empty-state">No XP awarded yet.</p>;
  return (
    <div>
      <ul className="rpg-history">
        {rows.map((a) => (
          <li key={a.id}>
            <span className="rpg-history__what">
              <span>{awardTitle(a)}</span>
              <span className="rpg-hint technical">{awardSource(a)}</span>
            </span>
            <span className="technical">+{a.xp} {a.stat}</span>
            <time className="technical" dateTime={a.occurredAt} title={a.occurredAt}>{shortDate(a.occurredAt)}</time>
          </li>
        ))}
      </ul>
      {error && <p className="rpg-notice rpg-notice--error" role="alert">{error}</p>}
      {more && (
        <button
          type="button"
          onClick={() => {
            const last = rows[rows.length - 1];
            if (!last) return;
            bridge
              .realityRpgHistory({ beforeSeq: last.eventSeq, limit: 50 })
              .then((page) => {
                // History is newest first, so older pages append; ids keep it unique.
                setRows((current) => [...current, ...page.filter((p) => !current.some((c) => c.id === p.id))]);
                setMore(page.length >= 50);
              })
              .catch((e: unknown) => setError(errorText(e)));
          }}
        >
          Show older
        </button>
      )}
    </div>
  );
}

function RulesPanel({ snapshot, busy, run, ask }: { snapshot: RealityRpgSnapshot; busy: boolean; run(actionId: string, params?: Record<string, unknown>): Promise<boolean>; ask: Ask }) {
  const [form, setForm] = useState<RuleForm>(EMPTY_RULE_FORM);
  const existing = new Set(snapshot.rules.map((r) => r.id));
  const templates = snapshot.starter.rules.filter((r) => !existing.has(r.id));
  const achievementIds = new Set(snapshot.achievements.map((a) => a.achievement.id));
  const achievementTemplates = snapshot.starter.achievements.filter((a) => !achievementIds.has(a.id));
  const invalid = snapshot.invalid.rules.length + snapshot.invalid.achievements.length + snapshot.invalid.quests.length;

  return (
    <div className="rpg-rules">
      {invalid > 0 && <p className="rpg-notice rpg-notice--error" role="alert">{invalid} saved definition{invalid === 1 ? " is" : "s are"} no longer valid and {invalid === 1 ? "is" : "are"} being ignored.</p>}
      {snapshot.rules.length === 0 ? (
        <p className="empty-state">No rules yet. Add one from the starter set or write your own.</p>
      ) : (
        <ul className="rpg-list">
          {snapshot.rules.map((rule) => (
            <RuleRow key={rule.id} rule={rule} busy={busy} run={run} ask={ask} />
          ))}
        </ul>
      )}

      {(templates.length > 0 || achievementTemplates.length > 0) && (
        <section aria-labelledby="rpg-starter">
          <h3 id="rpg-starter">Starter set</h3>
          <p className="rpg-hint">Added switched off. Switch a rule on when you want it to count - it counts from then on.</p>
          <ul className="rpg-list">
            {templates.map((t) => (
              <li key={t.id} className="rpg-item">
                <p className="rpg-item__title">{t.name}</p>
                <p className="technical">{t.match.types.join(", ")}{t.match.actionIds ? ` · ${t.match.actionIds.join(", ")}` : ""} · +{t.award.xp} {t.award.stat}</p>
                <button type="button" disabled={busy} onClick={() => void run("reality_rpg.rule.save", { rule: { ...t, enabled: false } })} aria-label={`Add rule ${t.name}`}>Add</button>
              </li>
            ))}
            {achievementTemplates.map((a) => (
              <li key={a.id} className="rpg-item">
                <p className="rpg-item__title">{a.name}</p>
                <p className="rpg-hint">{a.description}</p>
                <button type="button" disabled={busy} onClick={() => void run("reality_rpg.achievement.save", { achievement: a })} aria-label={`Add achievement ${a.name}`}>Add</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <form
        className="rpg-form"
        aria-label="New rule"
        onSubmit={(e) => {
          e.preventDefault();
          void run("reality_rpg.rule.save", { rule: ruleFromForm(form) }).then((ok) => ok && setForm(EMPTY_RULE_FORM));
        }}
      >
        <h3>New rule</h3>
        <p className="rpg-hint">A rule names exact event types. It can never name vault, finance or journal activity, and it only reads an event's type, module, action and status - never its content.</p>
        <label>Name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
        <label>Event types<input className="technical" value={form.types} placeholder="action_executed" onChange={(e) => setForm({ ...form, types: e.target.value })} required /></label>
        <label>Action ids (optional)<input className="technical" value={form.actionIds} placeholder="standup.generate" onChange={(e) => setForm({ ...form, actionIds: e.target.value })} /></label>
        <label>Stream (optional)<input className="technical" value={form.stream} placeholder="audit" onChange={(e) => setForm({ ...form, stream: e.target.value })} /></label>
        <label>
          Status
          <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as RuleForm["status"] })}>
            <option value="">Any</option>
            <option value="success">Success</option>
            <option value="failed">Failed</option>
          </select>
        </label>
        <label>XP<input type="number" min={1} max={500} value={form.xp} onChange={(e) => setForm({ ...form, xp: e.target.value })} /></label>
        <label>Stat<input value={form.stat} placeholder="Craft" onChange={(e) => setForm({ ...form, stat: e.target.value })} required /></label>
        <label>Most per day (optional)<input type="number" min={1} value={form.dailyCap} onChange={(e) => setForm({ ...form, dailyCap: e.target.value })} /></label>
        <label className="rpg-check"><input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />Switch on now</label>
        <button type="submit" disabled={busy}>Save rule</button>
      </form>
    </div>
  );
}

function RuleRow({ rule, busy, run, ask }: { rule: Rule; busy: boolean; run(actionId: string, params?: Record<string, unknown>): Promise<boolean>; ask: Ask }) {
  return (
    <li className={rule.enabled ? "rpg-item" : "rpg-item rpg-item--off"}>
      <p className="rpg-item__title">{rule.name}{rule.enabled ? "" : " · off"}</p>
      <p>{ruleSentence(rule)}</p>
      <p className="rpg-hint technical">
        {rule.match.types.join(", ")}{rule.match.actionIds ? ` · ${rule.match.actionIds.join(", ")}` : ""}
      </p>
      <p className="rpg-hint">
        {Date.parse(rule.effectiveFrom) <= 0 ? countsFromLabel(rule.effectiveFrom) : <>Counts from <time className="technical" dateTime={rule.effectiveFrom}>{shortDate(rule.effectiveFrom)}</time></>}
      </p>
      <div className="button-row">
        <button type="button" disabled={busy} onClick={() => void run("reality_rpg.rule.set_enabled", { ruleId: rule.id, enabled: !rule.enabled })} aria-label={`${rule.enabled ? "Switch off" : "Switch on"} ${rule.name}`}>
          {rule.enabled ? "Switch off" : "Switch on"}
        </button>
        {rule.enabled && (
          <button type="button" disabled={busy} onClick={() => void run("reality_rpg.backfill", { ruleId: rule.id })} aria-label={`Apply ${rule.name} to past activity`}>Apply to past activity</button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => ask({ actionId: "reality_rpg.rule.delete", params: { ruleId: rule.id }, question: `Delete the rule "${rule.name}"? XP it already awarded stays; it awards nothing from now on. This cannot be undone.`, confirmLabel: "Delete" })}
          aria-label={`Delete ${rule.name}`}
        >
          Delete…
        </button>
      </div>
    </li>
  );
}

/** Asks before a change that cannot be undone. Modal: focus stays inside, Cancel is focused, Escape cancels. */
function ConfirmDialog({ confirm, busy, onConfirm, onCancel }: { confirm: Confirm; busy: boolean; onConfirm(): void; onCancel(): void }) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelRef.current?.focus();
    return () => opener?.focus();
  }, [confirm]);
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
      return;
    }
    if (e.key !== "Tab") return;
    const order = [confirmRef.current, cancelRef.current].filter((b): b is HTMLButtonElement => b !== null && !b.disabled);
    if (order.length === 0) return;
    const at = order.indexOf(document.activeElement as HTMLButtonElement);
    e.preventDefault();
    const next = e.shiftKey ? (at <= 0 ? order.length - 1 : at - 1) : (at + 1) % order.length;
    order[next]?.focus();
  }
  return (
    <div className="rpg-backdrop">
      <div className="rpg-confirm" role="alertdialog" aria-labelledby="rpg-confirm-text" aria-modal="true" onKeyDown={onKeyDown}>
        <p id="rpg-confirm-text">{confirm.question}</p>
        <div className="button-row">
          <button type="button" ref={confirmRef} className="rpg-danger" disabled={busy} onClick={onConfirm}>{confirm.confirmLabel}</button>
          <button type="button" ref={cancelRef} onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
