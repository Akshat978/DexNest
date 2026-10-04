// Settings for the modules that used to keep them on their own screens:
// Skills, the repository scan, Reality RPG and ObjectOS. One card each, one
// Save each, in the Settings page.
//
// Turning a module on or off stays on its own screen (it is a logged action
// with its own explanation there); what is here is how it behaves once on.

import React, { useEffect, useState } from "react";
import type { RealityRpgSettings } from "@dexnest/reality-rpg";
import type { SkillConstellationSettings } from "@dexnest/skill-constellation";
import type { TodaySettings } from "./todayModel";
import { Button, Card, Field, InlineError, Notice, SectionTitle, TextInput } from "../components/ui/kit";

export interface ModuleSettingsBridge {
  skillConstellationSettings(): Promise<SkillConstellationSettings>;
  skillConstellationUpdateSettings(settings: SkillConstellationSettings): Promise<SkillConstellationSettings>;
  skillConstellationCommitAuthors?(): Promise<{ email: string; commits: number }[]>;
  devIntelligenceSettings(): Promise<ScanSettings>;
  devIntelligenceUpdateSettings(settings: ScanSettings): Promise<ScanSettings>;
  realityRpgSettings(): Promise<RpgSettings>;
  realityRpgUpdateSettings(settings: RpgSettings): Promise<RpgSettings>;
  objectOsStatus(): Promise<{ remindersEnabled: boolean }>;
}

type ScanSettings = TodaySettings;
type RpgSettings = RealityRpgSettings;

type Saved = { ok: boolean; text: string } | null;

function message(e: unknown): string {
  return e instanceof Error ? e.message : "That could not be saved.";
}

/** The emails typed into the box, as a list. */
export function parseEmails(text: string): string[] {
  return [...new Set(text.toLowerCase().split(/[,\s]+/).filter(Boolean))];
}

/** A whole number of minutes, no lower than `min`; anything else is the fallback. */
export function minutes(text: string, min: number, fallback: number): number {
  const n = Math.floor(Number(text));
  return Number.isFinite(n) && n >= min ? n : fallback;
}

function Status({ saved }: { saved: Saved }) {
  if (!saved) return null;
  return saved.ok ? <Notice>{saved.text}</Notice> : <InlineError>{saved.text}</InlineError>;
}

function SkillsCard({ bridge }: { bridge: ModuleSettingsBridge }) {
  const [settings, setSettings] = useState<SkillConstellationSettings | null>(null);
  const [emails, setEmails] = useState("");
  const [unmapped, setUnmapped] = useState(false);
  const [authors, setAuthors] = useState<{ email: string; commits: number }[]>([]);
  const [saved, setSaved] = useState<Saved>(null);

  useEffect(() => {
    let live = true;
    bridge.skillConstellationSettings().then((s) => {
      if (!live) return;
      setSettings(s);
      setEmails(s.myEmails.join(", "));
      setUnmapped(s.includeUnmappedLibraries);
    }).catch(() => undefined);
    bridge.skillConstellationCommitAuthors?.().then((found) => { if (live) setAuthors(found); }).catch(() => undefined);
    return () => { live = false; };
  }, [bridge]);

  if (!settings) return null;
  const typed = new Set(parseEmails(emails));
  const suggestions = authors.filter((a) => !typed.has(a.email));

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!settings) return;
    try {
      const next = await bridge.skillConstellationUpdateSettings({ ...settings, myEmails: parseEmails(emails), includeUnmappedLibraries: unmapped });
      setSettings(next);
      setEmails(next.myEmails.join(", "));
      setSaved({ ok: true, text: "Saved. Press Rebuild in Skills to apply it." });
    } catch (e) {
      setSaved({ ok: false, text: message(e) });
    }
  }

  return (
    <Card aria-labelledby="modset-skills">
      <SectionTitle id="modset-skills">Skills</SectionTitle>
      <form className="modset-form" aria-label="Skills settings" onSubmit={(e) => void save(e)}>
        <Field label="My commit emails" htmlFor="modset-skills-emails" hint="Only commits by these authors count. Leave empty to count every commit.">
          <TextInput id="modset-skills-emails" className="technical" value={emails} placeholder="you@example.com" onChange={(e) => setEmails(e.target.value)} />
        </Field>
        {suggestions.length > 0 && (
          <div className="modset-picks" role="group" aria-label="Emails on the commits already scanned">
            <span className="modset-hint">On your scanned commits:</span>
            {suggestions.map((a) => (
              <button key={a.email} type="button" className="modset-pick technical" title={`Add ${a.email}`} onClick={() => setEmails([...typed, a.email].join(", "))}>
                {a.email} ({a.commits === 1 ? "1 commit" : `${a.commits} commits`})
              </button>
            ))}
          </div>
        )}
        <label className="modset-check">
          <input type="checkbox" checked={unmapped} onChange={(e) => setUnmapped(e.target.checked)} />
          Include libraries that are not in the curated list
        </label>
        <div className="button-row">
          <Button type="submit" variant="primary">Save</Button>
        </div>
        <Status saved={saved} />
      </form>
    </Card>
  );
}

function ScanCard({ bridge }: { bridge: ModuleSettingsBridge }) {
  const [settings, setSettings] = useState<ScanSettings | null>(null);
  const [every, setEvery] = useState("");
  const [health, setHealth] = useState(true);
  const [saved, setSaved] = useState<Saved>(null);

  useEffect(() => {
    let live = true;
    bridge.devIntelligenceSettings().then((s) => {
      if (!live) return;
      setSettings(s);
      setEvery(String(s.scanIntervalMinutes));
      setHealth(s.runHealthChecks);
    }).catch(() => undefined);
    return () => { live = false; };
  }, [bridge]);

  if (!settings) return null;

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!settings) return;
    try {
      const next = await bridge.devIntelligenceUpdateSettings({ ...settings, scanIntervalMinutes: minutes(every, 5, settings.scanIntervalMinutes), runHealthChecks: health });
      setSettings(next);
      setEvery(String(next.scanIntervalMinutes));
      setSaved({ ok: true, text: "Saved." });
    } catch (e) {
      setSaved({ ok: false, text: message(e) });
    }
  }

  return (
    <Card aria-labelledby="modset-scan">
      <SectionTitle id="modset-scan">Repository scan</SectionTitle>
      <form className="modset-form" aria-label="Repository scan settings" onSubmit={(e) => void save(e)}>
        <Field label="Scan every (minutes)" htmlFor="modset-scan-every" hint="At least 5. What it reads is whatever is in Projects; it is turned on and off from Today.">
          <TextInput id="modset-scan-every" type="number" min={5} value={every} onChange={(e) => setEvery(e.target.value)} />
        </Field>
        <label className="modset-check">
          <input type="checkbox" checked={health} onChange={(e) => setHealth(e.target.checked)} />
          Run the health checks you have set up for a project
        </label>
        <div className="button-row">
          <Button type="submit" variant="primary">Save</Button>
        </div>
        <Status saved={saved} />
      </form>
    </Card>
  );
}

function RpgCard({ bridge }: { bridge: ModuleSettingsBridge }) {
  const [settings, setSettings] = useState<RpgSettings | null>(null);
  const [every, setEvery] = useState("");
  const [saved, setSaved] = useState<Saved>(null);

  useEffect(() => {
    let live = true;
    bridge.realityRpgSettings().then((s) => {
      if (!live) return;
      setSettings(s);
      setEvery(String(s.intervalMinutes));
    }).catch(() => undefined);
    return () => { live = false; };
  }, [bridge]);

  if (!settings) return null;

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!settings) return;
    try {
      const next = await bridge.realityRpgUpdateSettings({ ...settings, intervalMinutes: minutes(every, 5, settings.intervalMinutes) });
      setSettings(next);
      setEvery(String(next.intervalMinutes));
      setSaved({ ok: true, text: "Saved." });
    } catch (e) {
      setSaved({ ok: false, text: message(e) });
    }
  }

  return (
    <Card aria-labelledby="modset-rpg">
      <SectionTitle id="modset-rpg">Reality RPG</SectionTitle>
      <form className="modset-form" aria-label="Reality RPG settings" onSubmit={(e) => void save(e)}>
        <Field label="Look for new XP every (minutes)" htmlFor="modset-rpg-every" hint="At least 5. Rules, quests and achievements are on the Reality RPG screen.">
          <TextInput id="modset-rpg-every" type="number" min={5} value={every} onChange={(e) => setEvery(e.target.value)} />
        </Field>
        <div className="button-row">
          <Button type="submit" variant="primary">Save</Button>
        </div>
        <Status saved={saved} />
      </form>
    </Card>
  );
}

function ObjectsCard({ bridge, onAction }: { bridge: ModuleSettingsBridge; onAction(actionId: string): Promise<unknown> }) {
  const [on, setOn] = useState<boolean | null>(null);
  const [saved, setSaved] = useState<Saved>(null);

  useEffect(() => {
    let live = true;
    bridge.objectOsStatus().then((s) => { if (live) setOn(s.remindersEnabled); }).catch(() => undefined);
    return () => { live = false; };
  }, [bridge]);

  if (on === null) return null;

  async function toggle() {
    try {
      const result = await onAction(on ? "object_os.reminders.disable" : "object_os.reminders.enable");
      const failed = typeof result === "object" && result !== null && "ok" in result && result.ok === false;
      if (failed) {
        setSaved({ ok: false, text: "ObjectOS could not change its reminders." });
        return;
      }
      setOn(!on);
      setSaved({ ok: true, text: on ? "Daily reminders are off." : "Daily reminders are on." });
    } catch (e) {
      setSaved({ ok: false, text: message(e) });
    }
  }

  return (
    <Card aria-labelledby="modset-objects">
      <SectionTitle id="modset-objects">ObjectOS</SectionTitle>
      <div className="modset-form">
        <p className="modset-hint">Daily reminders: once a day, a quiet notification with counts only (maintenance due, warranties ending, parts low). They also show under “Needs you” on Today.</p>
        <div className="button-row">
          <Button onClick={() => void toggle()}>{on ? "Turn daily reminders off" : "Turn daily reminders on"}</Button>
        </div>
        <Status saved={saved} />
      </div>
    </Card>
  );
}

export function ModuleSettings({ bridge, onAction }: { bridge: ModuleSettingsBridge; onAction(actionId: string): Promise<unknown> }) {
  return (
    <div className="modset">
      <SkillsCard bridge={bridge} />
      <ScanCard bridge={bridge} />
      <RpgCard bridge={bridge} />
      <ObjectsCard bridge={bridge} onAction={onAction} />
      <p className="modset-hint">GhostOS has no settings of its own: connecting or disconnecting your repositories is on its Sources tab, because disconnecting deletes what was added.</p>
    </div>
  );
}
