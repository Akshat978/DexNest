// Starting Reality RPG, and the built-in set.
//
// Three small pieces the Reality RPG view places:
// - StartPicker: the first screen. What the game is, the built-in rules and
//   quests to tick, and one button that turns it on with them.
// - FirstXp: on the character page before anything is earned, what to do to
//   earn the first XP.
// - BuiltInSet: in Rules, the rest of the built-in rules, quests and
//   achievements, in plain words.
//
// Nothing here writes: every change is a reality_rpg.* action.

import React, { useState } from "react";
import type { RealityRpgSnapshot } from "@dexnest/reality-rpg";
import { Swords, Zap } from "lucide-react";
import { Button, Card, ListRow, SectionTitle } from "../components/ui/kit";
import { defaultStarterPicks, firstXpSteps, questWindowText, ruleSentence, starterGroups, starterSummary } from "./realityRpgModel";

type Run = (actionId: string, params?: Record<string, unknown>) => Promise<boolean>;

export function StartPicker({ snapshot, busy, run, initial }: { snapshot: RealityRpgSnapshot; busy: boolean; run: Run; initial?: { ruleIds: string[]; questIds: string[] } }) {
  const defaults = initial ?? defaultStarterPicks(snapshot.starter);
  const [ruleIds, setRuleIds] = useState<string[]>(defaults.ruleIds);
  const [questIds, setQuestIds] = useState<string[]>(defaults.questIds);
  const groups = starterGroups(snapshot.starter);
  const toggle = (list: string[], id: string, on: boolean) => (on ? [...list, id] : list.filter((x) => x !== id));
  // A quest counts one rule: without it the quest could never move, so it is not sent.
  const quests = questIds.filter((id) => ruleIds.includes(snapshot.starter.quests.find((q) => q.id === id)?.needs ?? ""));

  return (
    <section className="rpg-start" aria-labelledby="rpg-start-title">
      <div className="rpg-start__head">
        <span className="rpg-start__icon" aria-hidden="true"><Swords /></span>
        <div>
          <h2 id="rpg-start-title">Turn what you already do into XP</h2>
          <p>Pick what should count. You earn XP, levels and achievements for it from the moment you turn this on; nothing you did before counts.</p>
        </div>
      </div>

      {groups.map((group) => (
        <fieldset key={group.id} className="rpg-start__group">
          <legend>{group.label}</legend>
          {group.rules.map(({ rule, when }) => (
            <label key={rule.id} className="rpg-pick">
              <input type="checkbox" checked={ruleIds.includes(rule.id)} onChange={(e) => setRuleIds(toggle(ruleIds, rule.id, e.target.checked))} />
              <span className="rpg-pick__text">
                <span className="rpg-pick__name">{rule.name}</span>
                <span className="rpg-hint">When {when}.</span>
              </span>
              <span className="rpg-pick__xp technical">{ruleSentence(rule)}</span>
            </label>
          ))}
        </fieldset>
      ))}

      <fieldset className="rpg-start__group">
        <legend>Quests to start with</legend>
        {snapshot.starter.quests.map((quest) => {
          const available = ruleIds.includes(quest.needs);
          return (
            <label key={quest.id} className={available ? "rpg-pick" : "rpg-pick rpg-pick--off"}>
              <input type="checkbox" disabled={!available} checked={available && questIds.includes(quest.id)} onChange={(e) => setQuestIds(toggle(questIds, quest.id, e.target.checked))} />
              <span className="rpg-pick__text">
                <span className="rpg-pick__name">{quest.title}</span>
                {!available && <span className="rpg-hint">Needs “{snapshot.starter.rules.find((r) => r.id === quest.needs)?.name ?? quest.needs}” ticked above.</span>}
              </span>
              <span className="rpg-pick__xp">{questWindowText(quest.window.kind)}</span>
            </label>
          );
        })}
      </fieldset>

      <div className="rpg-start__go">
        <Button variant="primary" disabled={busy || ruleIds.length === 0} onClick={() => void run("reality_rpg.enable", { starter: { ruleIds, questIds: quests } })}>
          {starterSummary(ruleIds.length, quests.length)}
        </Button>
        <p className="rpg-hint">Achievements for what you picked are added too. You can change any of it later under Rules. It reads only that these things happened, never vault, finance or journal activity, and never the content of anything.</p>
      </div>
    </section>
  );
}

/** Before the first XP: the rules that are on, as things to go and do. */
export function FirstXp({ snapshot, onOpenRules }: { snapshot: RealityRpgSnapshot; onOpenRules(): void }) {
  const steps = firstXpSteps(snapshot);
  return (
    <Card accent="rpg">
      <SectionTitle action={<Button size="sm" variant="ghost" onClick={onOpenRules}>Change what counts</Button>}>How to earn your first XP</SectionTitle>
      {steps.length === 0 ? (
        <p className="rpg-hint">No rule is switched on, so nothing can earn yet. Open Rules and switch one on.</p>
      ) : (
        <div className="rpg-rows">
          {steps.slice(0, 6).map((step) => (
            <ListRow key={step.id} icon={<Zap />} title={step.title} meta={step.when} trailing={step.reward} />
          ))}
        </div>
      )}
      <p className="rpg-hint">XP shows up within a few minutes of doing one of these, or press Refresh. Project activity is seen at the next repository scan.</p>
    </Card>
  );
}

/** In Rules: what is left of the built-in set, grouped and said in plain words. */
export function BuiltInSet({ snapshot, busy, run }: { snapshot: RealityRpgSnapshot; busy: boolean; run: Run }) {
  const have = new Set(snapshot.rules.map((r) => r.id));
  const groups = starterGroups(snapshot.starter)
    .map((g) => ({ ...g, rules: g.rules.filter(({ rule }) => !have.has(rule.id)) }))
    .filter((g) => g.rules.length > 0);
  const haveQuests = new Set(snapshot.quests.map((q) => q.quest.id));
  const quests = snapshot.starter.quests.filter((q) => !haveQuests.has(q.id) && have.has(q.needs));
  const haveAchievements = new Set(snapshot.achievements.map((a) => a.achievement.id));
  const achievements = snapshot.starter.achievements.filter((a) => !haveAchievements.has(a.id) && (a.condition.kind === "xp" || a.condition.ruleIds.some((id) => have.has(id))));
  if (groups.length === 0 && quests.length === 0 && achievements.length === 0) return null;

  return (
    <section aria-labelledby="rpg-starter">
      <h3 id="rpg-starter">Built-in rules, quests and achievements</h3>
      <p className="rpg-hint">Ready-made. A rule counts from the moment you add it.</p>
      {groups.map((group) => (
        <div key={group.id} className="rpg-builtin">
          <h4>{group.label}</h4>
          <ul className="rpg-list">
            {group.rules.map(({ rule, when }) => (
              <li key={rule.id} className="rpg-item">
                <p className="rpg-item__title">{rule.name}</p>
                <p className="rpg-hint">When {when}. {ruleSentence(rule)}.</p>
                <Button size="sm" disabled={busy} onClick={() => void run("reality_rpg.rule.save", { rule: { ...rule, enabled: true } })} aria-label={`Add rule ${rule.name}`}>Add</Button>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {quests.length > 0 && (
        <div className="rpg-builtin">
          <h4>Quests</h4>
          <ul className="rpg-list">
            {quests.map((quest) => (
              <li key={quest.id} className="rpg-item">
                <p className="rpg-item__title">{quest.title}</p>
                <p className="rpg-hint">{questWindowText(quest.window.kind)}</p>
                <Button size="sm" disabled={busy} onClick={() => void run("reality_rpg.quest.create", { quest: { id: quest.id, title: quest.title, condition: quest.condition, window: quest.window } })} aria-label={`Start quest ${quest.title}`}>Start</Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {achievements.length > 0 && (
        <div className="rpg-builtin">
          <h4>Achievements</h4>
          <ul className="rpg-list">
            {achievements.map((a) => (
              <li key={a.id} className="rpg-item">
                <p className="rpg-item__title">{a.name}</p>
                <p className="rpg-hint">{a.description}</p>
                <Button size="sm" disabled={busy} onClick={() => void run("reality_rpg.achievement.save", { achievement: a })} aria-label={`Add achievement ${a.name}`}>Add</Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
