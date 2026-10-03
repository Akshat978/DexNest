import React, { useCallback, useEffect, useState } from "react";
import type { AwardView, RealityRpgSettings, RealityRpgSnapshot, RealityRpgStatus, Rule } from "@dexnest/reality-rpg";
import { Swords } from "lucide-react";
import { accentStyle, Button, ConfirmDialog, EmptyNote, EmptyState, ErrorState, Field, InlineError, LoadingState, Notice, PageHeader, Select, TabPanel, Tabs, TextInput } from "../components/ui/kit";
import {
  countsFromLabel,
  actionMessage,
  awardSource,
  awardTitle,
  conditionUnit,
  EMPTY_QUEST_FORM,
  EMPTY_RULE_FORM,
  levelProgress,
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
  /** The question ("Delete the rule …?"). */
  title: string;
  /** What happens if the owner says yes. */
  detail: string;
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

  return (
    <section className="view-stack rpg" style={accentStyle("rpg")} aria-labelledby="rpg-title" aria-busy={state.kind === "loading"}>
      <PageHeader
        icon={<Swords />}
        title="Reality RPG"
        titleId="rpg-title"
        subtitle="Your activity, as a game"
        actions={state.kind === "ready" || state.kind === "off" ? (
          <>
            {snapshot?.enabled && <Button disabled={busy} onClick={() => void run("reality_rpg.refresh")}>Refresh</Button>}
            {snapshot?.enabled ? (
              <Button variant="ghost" disabled={busy} onClick={() => void run("reality_rpg.disable")}>Turn off</Button>
            ) : (
              <Button variant="primary" disabled={busy} onClick={() => void run("reality_rpg.enable")}>Turn on</Button>
            )}
          </>
        ) : undefined}
      />
      {notice && (notice.ok ? <Notice>{notice.text}</Notice> : <InlineError>{notice.text}</InlineError>)}
      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          confirmLabel={confirm.confirmLabel}
          busy={busy}
          accent="rpg"
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            const c = confirm;
            setConfirm(null);
            void run(c.actionId, c.params);
          }}
        >
          {confirm.detail}
        </ConfirmDialog>
      )}

      {state.kind === "loading" && <LoadingState label="Loading your character" />}

      {state.kind === "error" && <ErrorState title="Reality RPG could not load" message={state.message} onRetry={() => void load()} />}

      {state.kind === "off" && (
        <EmptyState
          icon={<Swords />}
          title="Reality RPG is off"
        >
          <p>Reality RPG turns what you already do in DexNest into XP, achievements and quests, by rules you write. It reads only the event types your rules name, never vault, finance or journal activity, and never the content of an event.</p>
          <p>Start with a rule: open Rules below and add one from the starter set, or write your own.</p>
        </EmptyState>
      )}

      {(state.kind === "ready" || state.kind === "off") && snapshot && (
        <>
          <Tabs label="Reality RPG sections" idPrefix="rpg" value={tab} onChange={setTab} tabs={TABS.map((t) => ({ id: t, label: TAB_LABELS[t] }))} />
          <TabPanel idPrefix="rpg" id={tab}>
            {tab === "character" && <CharacterPanel snapshot={snapshot} />}
            {tab === "quests" && <QuestsPanel snapshot={snapshot} busy={busy} run={run} ask={setConfirm} />}
            {tab === "achievements" && <AchievementsPanel snapshot={snapshot} />}
            {tab === "history" && <HistoryPanel snapshot={snapshot} bridge={bridge} />}
            {tab === "rules" && <RulesPanel snapshot={snapshot} busy={busy} run={run} ask={setConfirm} />}
          </TabPanel>
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
        <EmptyNote>No XP yet. Switch on a rule and do the thing it names.</EmptyNote>
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
  if (views.length === 0) return <EmptyNote>No achievements defined. The starter set in Rules has a few.</EmptyNote>;
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
        <EmptyNote>No active quests. Create one below.</EmptyNote>
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
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => ask({ actionId: "reality_rpg.quest.abandon", params: { questId: quest.id }, title: `Abandon "${quest.title}"?`, detail: "Its progress so far is kept in history, but the quest stops counting.", confirmLabel: "Abandon" })}
                aria-label={`Abandon ${quest.title}`}
              >
                Abandon…
              </Button>
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
        <Field label="Title"><TextInput value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required /></Field>
        <Field label="Goal">
          <Select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as QuestForm["kind"] })}>
            <option value="count">Times a rule awards</option>
            <option value="days">Days with an award from a rule</option>
            <option value="xp">XP earned</option>
          </Select>
        </Field>
        {form.kind === "xp" ? (
          <Field label="Stat (optional)"><TextInput value={form.stat} onChange={(e) => setForm({ ...form, stat: e.target.value })} /></Field>
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
        <Field label="Target"><TextInput type="number" min={1} value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} /></Field>
        <Field label="Window">
          <Select value={form.window} onChange={(e) => setForm({ ...form, window: e.target.value as QuestForm["window"] })}>
            <option value="none">Until done</option>
            <option value="daily">Every day</option>
            <option value="weekly">Every week</option>
            <option value="fixed">Between two dates</option>
          </Select>
        </Field>
        {form.window === "fixed" && (
          <>
            <Field label="From"><TextInput type="date" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} /></Field>
            <Field label="To"><TextInput type="date" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} /></Field>
          </>
        )}
        <div className="button-row">
          <Button type="submit" variant="primary" disabled={busy}>Create quest</Button>
        </div>
      </form>
    </div>
  );
}

function HistoryPanel({ snapshot, bridge }: { snapshot: RealityRpgSnapshot; bridge: RealityRpgBridge }) {
  const [rows, setRows] = useState<AwardView[]>(snapshot.recentAwards);
  const [more, setMore] = useState(snapshot.recentAwards.length >= 50);
  const [error, setError] = useState<string | null>(null);
  if (rows.length === 0) return <EmptyNote>No XP awarded yet.</EmptyNote>;
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
      {error && <InlineError>{error}</InlineError>}
      {more && (
        <Button
          variant="ghost"
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
        </Button>
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
      {invalid > 0 && <InlineError>{invalid} saved definition{invalid === 1 ? " is" : "s are"} no longer valid and {invalid === 1 ? "is" : "are"} being ignored.</InlineError>}
      {snapshot.rules.length === 0 ? (
        <EmptyNote>No rules yet. Add one from the starter set or write your own.</EmptyNote>
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
                <Button size="sm" disabled={busy} onClick={() => void run("reality_rpg.rule.save", { rule: { ...t, enabled: false } })} aria-label={`Add rule ${t.name}`}>Add</Button>
              </li>
            ))}
            {achievementTemplates.map((a) => (
              <li key={a.id} className="rpg-item">
                <p className="rpg-item__title">{a.name}</p>
                <p className="rpg-hint">{a.description}</p>
                <Button size="sm" disabled={busy} onClick={() => void run("reality_rpg.achievement.save", { achievement: a })} aria-label={`Add achievement ${a.name}`}>Add</Button>
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
        <Field label="Name"><TextInput value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></Field>
        <Field label="Event types"><TextInput className="technical" value={form.types} placeholder="action_executed" onChange={(e) => setForm({ ...form, types: e.target.value })} required /></Field>
        <Field label="Action ids (optional)"><TextInput className="technical" value={form.actionIds} placeholder="standup.generate" onChange={(e) => setForm({ ...form, actionIds: e.target.value })} /></Field>
        <Field label="Stream (optional)"><TextInput className="technical" value={form.stream} placeholder="audit" onChange={(e) => setForm({ ...form, stream: e.target.value })} /></Field>
        <Field label="Status">
          <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as RuleForm["status"] })}>
            <option value="">Any</option>
            <option value="success">Success</option>
            <option value="failed">Failed</option>
          </Select>
        </Field>
        <Field label="XP"><TextInput type="number" min={1} max={500} value={form.xp} onChange={(e) => setForm({ ...form, xp: e.target.value })} /></Field>
        <Field label="Stat"><TextInput value={form.stat} placeholder="Craft" onChange={(e) => setForm({ ...form, stat: e.target.value })} required /></Field>
        <Field label="Most per day (optional)"><TextInput type="number" min={1} value={form.dailyCap} onChange={(e) => setForm({ ...form, dailyCap: e.target.value })} /></Field>
        <label className="rpg-check"><input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />Switch on now</label>
        <div className="button-row">
          <Button type="submit" variant="primary" disabled={busy}>Save rule</Button>
        </div>
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
        <Button size="sm" disabled={busy} onClick={() => void run("reality_rpg.rule.set_enabled", { ruleId: rule.id, enabled: !rule.enabled })} aria-label={`${rule.enabled ? "Switch off" : "Switch on"} ${rule.name}`}>
          {rule.enabled ? "Switch off" : "Switch on"}
        </Button>
        {rule.enabled && (
          <Button size="sm" disabled={busy} onClick={() => void run("reality_rpg.backfill", { ruleId: rule.id })} aria-label={`Apply ${rule.name} to past activity`}>Apply to past activity</Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => ask({ actionId: "reality_rpg.rule.delete", params: { ruleId: rule.id }, title: `Delete the rule "${rule.name}"?`, detail: "XP it already awarded stays; it awards nothing from now on. This cannot be undone.", confirmLabel: "Delete" })}
          aria-label={`Delete ${rule.name}`}
        >
          Delete…
        </Button>
      </div>
    </li>
  );
}
