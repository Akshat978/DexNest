import React, { useCallback, useEffect, useState } from "react";
import type { AwardView, RealityRpgSettings, RealityRpgSnapshot, RealityRpgStatus, Rule } from "@dexnest/reality-rpg";
import { Lock, Swords, Target, Trophy, Zap } from "lucide-react";
import {
  accentStyle,
  BarChart,
  Button,
  Card,
  ConfirmDialog,
  DashboardGrid,
  EmptyNote,
  EmptyState,
  ErrorState,
  Field,
  Hero,
  InlineError,
  ListRow,
  LoadingState,
  Meter,
  Notice,
  PageHeader,
  Reveal,
  Ring,
  SectionTitle,
  Select,
  StatGrid,
  StatTile,
  TabPanel,
  Tabs,
  TextInput
} from "../components/ui/kit";
import {
  countsFromLabel,
  actionMessage,
  awardSource,
  awardTitle,
  conditionUnit,
  EMPTY_QUEST_FORM,
  EMPTY_RULE_FORM,
  heroLine,
  levelProgress,
  localToday,
  nextAchievement,
  questProgressText,
  rankedStats,
  xpByDay,
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
  formFromTemplate,
  starterGroups,
  type Tab
} from "./realityRpgModel";
import { BuiltInSet, FirstXp, StartPicker } from "./RealityRpgStart";
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
  initial?: { snapshot: RealityRpgSnapshot | null; error?: string | null; tab?: Tab; confirm?: Confirm | null; today?: string; picks?: { ruleIds: string[]; questIds: string[] } };
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
            ) : state.kind === "off" ? null : (
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

      {state.kind === "off" && snapshot && <StartPicker snapshot={snapshot} busy={busy} run={run} {...(initial?.picks ? { initial: initial.picks } : {})} />}

      {state.kind === "ready" && snapshot && (
        <>
          <Tabs label="Reality RPG sections" idPrefix="rpg" value={tab} onChange={setTab} tabs={TABS.map((t) => ({ id: t, label: TAB_LABELS[t] }))} />
          <TabPanel idPrefix="rpg" id={tab}>
            {tab === "character" && <CharacterPanel snapshot={snapshot} today={initial?.today ?? localToday()} onOpen={setTab} />}
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

const STAT_TONES = ["accent", "info", "success", "warning"] as const;

function CharacterPanel({ snapshot, today, onOpen }: { snapshot: RealityRpgSnapshot; today: string; onOpen(tab: Tab): void }) {
  const { sheet } = snapshot;
  const pct = levelProgress(sheet);
  const stats = rankedStats(sheet.stats);
  const days = xpByDay(snapshot.recentAwards, 14, today);
  const active = snapshot.quests.filter((q) => q.quest.status === "active");
  const next = nextAchievement(snapshot.achievements);
  const ringLabel = sheet.xpToNextLevel === null ? `Level ${sheet.level}, the top of the curve` : `Level ${sheet.level}, ${pct}% of the way to level ${sheet.level + 1}`;
  return (
    <Reveal className="rpg-sheet">
      <Hero
        eyebrow={`Level ${sheet.level}`}
        title={`${sheet.totalXp.toLocaleString("en")} XP`}
        visual={<Ring value={pct} size={128} stroke={10} center={String(sheet.level)} caption="level" label={ringLabel} />}
      >
        {heroLine(snapshot)}
      </Hero>

      {stats.length === 0 ? (
        <FirstXp snapshot={snapshot} onOpenRules={() => onOpen("rules")} />
      ) : (
        <StatGrid columns={stats.length >= 4 ? 4 : stats.length === 3 ? 3 : 2}>
          {stats.slice(0, 4).map((s, i) => (
            <StatTile key={s.stat} label={s.stat} value={`${s.xp.toLocaleString("en")} XP`} tone={STAT_TONES[i % STAT_TONES.length]} hint={i === 0 ? "strongest" : `${s.share}% of ${stats[0]!.stat}`} />
          ))}
        </StatGrid>
      )}

      <DashboardGrid
        main={
          <>
            <Card accent="rpg">
              <SectionTitle>XP · last 14 days</SectionTitle>
              {days.data.some((d) => d.value > 0) ? (
                <>
                  <BarChart data={days.data} labelEvery={2} label="XP earned per day over the last 14 days" />
                  {!days.complete && <p className="rpg-hint">From your latest 50 awards; earlier days may have more.</p>}
                </>
              ) : (
                <EmptyNote>No XP in the last 14 days.</EmptyNote>
              )}
            </Card>
            <Card>
              <SectionTitle count={active.length} action={<Button size="sm" variant="ghost" onClick={() => onOpen("quests")}>All quests</Button>}>Active quests</SectionTitle>
              {active.length === 0 ? (
                <EmptyNote>No active quests. Start one in Quests.</EmptyNote>
              ) : (
                <div className="rpg-meters">
                  {active.slice(0, 4).map(({ quest, progress }) => (
                    <Meter key={quest.id} label={quest.title} value={progress.current} max={progress.target} display={questProgressText(quest, progress)} tone={progress.met ? "success" : "accent"} />
                  ))}
                </div>
              )}
            </Card>
          </>
        }
        side={
          <>
            <Card>
              <SectionTitle action={snapshot.recentAwards.length > 0 ? <Button size="sm" variant="ghost" onClick={() => onOpen("history")}>History</Button> : undefined}>Recent XP</SectionTitle>
              {snapshot.recentAwards.length === 0 ? (
                <EmptyNote>Nothing earned yet.</EmptyNote>
              ) : (
                <div className="rpg-rows">
                  {snapshot.recentAwards.slice(0, 5).map((a) => (
                    <ListRow key={a.id} icon={<Zap />} title={awardTitle(a)} meta={<time dateTime={a.occurredAt} title={a.occurredAt}>{shortDate(a.occurredAt)}</time>} trailing={`+${a.xp} ${a.stat}`} />
                  ))}
                </div>
              )}
            </Card>
            <Card>
              <SectionTitle action={snapshot.achievements.length > 0 ? <Button size="sm" variant="ghost" onClick={() => onOpen("achievements")}>All</Button> : undefined}>Next achievement</SectionTitle>
              {next ? (
                <div className="rpg-next">
                  <ListRow icon={<Trophy />} title={next.achievement.name} meta={next.achievement.description} />
                  <Meter label="Progress" value={next.progress.current} max={next.progress.target} display={progressText(next.progress.current, next.progress.target, conditionUnit(next.achievement.condition.kind))} />
                </div>
              ) : (
                <EmptyNote>{snapshot.achievements.length > 0 ? "Every achievement is unlocked." : "No achievements defined yet."}</EmptyNote>
              )}
            </Card>
          </>
        }
      />

      {snapshot.lastRun && (
        <p className="rpg-hint">Last processed <time className="technical" dateTime={snapshot.lastRun.startedAt} title={snapshot.lastRun.startedAt}>{shortDate(snapshot.lastRun.startedAt)}</time>{snapshot.enabled ? "" : " · processing is off"}</p>
      )}
    </Reveal>
  );
}

function AchievementsPanel({ snapshot }: { snapshot: RealityRpgSnapshot }) {
  const views = orderAchievements(snapshot.achievements);
  if (views.length === 0) return <EmptyNote>No achievements yet. The built-in set in Rules has tiers for commits, pushes, routine and levels.</EmptyNote>;
  const unlockedCount = views.filter((v) => v.unlocked).length;
  return (
    <div className="rpg-achievements">
      <p className="rpg-hint">{unlockedCount} of {views.length} unlocked</p>
      <ul className="rpg-medals">
        {views.map(({ achievement, unlocked, progress }) => (
          <li key={achievement.id} className={unlocked ? "rpg-medal rpg-medal--done" : "rpg-medal"}>
            <span className="rpg-medal__badge" aria-hidden="true">{unlocked ? <Trophy /> : <Lock />}</span>
            <p className="rpg-medal__name">
              {achievement.name}
              <span className="kit-visually-hidden">{unlocked ? " · unlocked" : " · locked"}</span>
            </p>
            <p className="rpg-hint">{achievement.description}</p>
            {unlocked ? (
              <p className="rpg-hint">Unlocked <time className="technical" dateTime={unlocked.unlockedAt}>{shortDate(unlocked.unlockedAt)}</time></p>
            ) : (
              <Meter size="sm" label="Progress" value={progress.current} max={progress.target} display={progressText(progress.current, progress.target, conditionUnit(achievement.condition.kind))} />
            )}
          </li>
        ))}
      </ul>
    </div>
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
        <ul className="rpg-quest-grid">
          {active.map(({ quest, progress, completions }) => (
            <li key={quest.id} className={progress.met ? "rpg-quest rpg-quest--met" : "rpg-quest"}>
              <div className="rpg-quest__head">
                <span className="rpg-quest__icon" aria-hidden="true"><Target /></span>
                <p className="rpg-item__title">{quest.title}</p>
              </div>
              <Meter label={questProgressText(quest, progress)} value={progress.current} max={progress.target} tone={progress.met ? "success" : "accent"} display={progress.met ? "done" : undefined} />
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
            <ListRow
              icon={<Zap />}
              title={awardTitle(a)}
              meta={<span className="technical">{awardSource(a)}</span>}
              trailing={
                <>
                  <span className="rpg-history__xp">+{a.xp} {a.stat}</span>
                  <time dateTime={a.occurredAt} title={a.occurredAt}>{shortDate(a.occurredAt)}</time>
                </>
              }
            />
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
  const [choice, setChoice] = useState("");
  const invalid = snapshot.invalid.rules.length + snapshot.invalid.achievements.length + snapshot.invalid.quests.length;

  return (
    <div className="rpg-rules">
      {invalid > 0 && <InlineError>{invalid} saved definition{invalid === 1 ? " is" : "s are"} no longer valid and {invalid === 1 ? "is" : "are"} being ignored.</InlineError>}
      {snapshot.rules.length === 0 ? (
        <EmptyNote>No rules yet. Add one from the built-in set below, or write your own.</EmptyNote>
      ) : (
        <ul className="rpg-list">
          {snapshot.rules.map((rule) => (
            <RuleRow key={rule.id} rule={rule} busy={busy} run={run} ask={ask} />
          ))}
        </ul>
      )}

      <BuiltInSet snapshot={snapshot} busy={busy} run={run} />

      <form
        className="rpg-form"
        aria-label="New rule"
        onSubmit={(e) => {
          e.preventDefault();
          void run("reality_rpg.rule.save", { rule: ruleFromForm(form) }).then((ok) => { if (ok) { setForm(EMPTY_RULE_FORM); setChoice(""); } });
        }}
      >
        <h3>A rule of your own</h3>
        <p className="rpg-hint">Choose what should earn XP, then how much. A rule only sees that something happened - never its content - and can never count vault, finance or journal activity.</p>
        <Field label="Name"><TextInput value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></Field>
        <Field label="What earns it">
          <Select
            value={choice}
            onChange={(e) => {
              setChoice(e.target.value);
              setForm(formFromTemplate(form, snapshot.starter.rules.find((r) => r.id === e.target.value)));
            }}
          >
            <option value="">Choose…</option>
            {starterGroups(snapshot.starter).map((group) => (
              <optgroup key={group.id} label={group.label}>
                {group.rules.map(({ rule, when }) => <option key={rule.id} value={rule.id}>{`When ${when}`}</option>)}
              </optgroup>
            ))}
            <option value="custom">Something else (name the events yourself)</option>
          </Select>
        </Field>
        <details className="rpg-advanced" open={choice === "custom"}>
          <summary>The event names behind it</summary>
          <p className="rpg-hint">Filled in from your choice above. Change them only if you know the event you want.</p>
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
        </details>
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
