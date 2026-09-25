import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ConstellationSkill,
  ConstellationSnapshot,
  EvidenceView,
  SkillConstellationSettings,
  SkillStrengthSnapshot
} from "@dexnest/skill-constellation";
import { PageHeader } from "../components/shared";
import {
  CATEGORY_LABELS,
  EVIDENCE_LABELS,
  groupEvidence,
  isNavKey,
  linkOpacity,
  nextStar,
  percent,
  shortDate,
  starLabel,
  starRadius,
  viewState,
  visibleSkills
} from "./skillConstellationModel";
import "./SkillConstellation.css";

/** The preload methods this view uses. */
export interface SkillConstellationBridge {
  skillConstellationSnapshot(): Promise<ConstellationSnapshot>;
  skillConstellationEvidence(skillId: string): Promise<EvidenceView[]>;
  skillConstellationHistory(skillId: string): Promise<SkillStrengthSnapshot[]>;
  skillConstellationSettings(): Promise<SkillConstellationSettings>;
  skillConstellationUpdateSettings(settings: SkillConstellationSettings): Promise<SkillConstellationSettings>;
}

export interface SkillConstellationViewProps {
  bridge: SkillConstellationBridge;
  /** Runs a registered action (rebuild, enable, disable) through the action registry. */
  onAction(actionId: string): Promise<unknown>;
  /** Tests only: start from a known state instead of loading. */
  initial?: { snapshot: ConstellationSnapshot | null; error?: string | null; selectedId?: string | null; evidence?: EvidenceView[] | null };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

export function SkillConstellationView({ bridge, onAction, initial }: SkillConstellationViewProps) {
  const [snapshot, setSnapshot] = useState<ConstellationSnapshot | null>(initial?.snapshot ?? null);
  const [loading, setLoading] = useState(initial === undefined);
  const [error, setError] = useState<string | null>(initial?.error ?? null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [focusedId, setFocusedId] = useState<string | null>(initial?.selectedId ?? null);
  const [selectedId, setSelectedId] = useState<string | null>(initial?.selectedId ?? null);
  const starRefs = useRef(new Map<string, SVGGElement>());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSnapshot(await bridge.skillConstellationSnapshot());
    } catch (e) {
      setError(message(e));
    } finally {
      setLoading(false);
    }
  }, [bridge]);

  useEffect(() => {
    if (initial === undefined) void load();
  }, [initial, load]);

  async function run(actionId: string, label: string) {
    setBusy(label);
    setNotice(null);
    try {
      const result = await onAction(actionId);
      const text = result && typeof result === "object" && "message" in result && typeof result.message === "string" ? result.message : null;
      const failed = result && typeof result === "object" && "ok" in result && result.ok === false;
      if (failed) {
        const reason = "error" in result && typeof result.error === "string" ? result.error : "That did not work.";
        setNotice(reason);
      } else if (text) {
        setNotice(text);
      }
      await load();
    } catch (e) {
      setNotice(message(e));
    } finally {
      setBusy(null);
    }
  }

  const state = viewState({ loading, error, snapshot });
  const skills = useMemo(() => (snapshot ? visibleSkills(snapshot.skills, showHidden) : []), [snapshot, showHidden]);
  const shownIds = useMemo(() => new Set(skills.map((s) => s.id)), [skills]);
  const points = useMemo(() => (snapshot ? snapshot.layout.filter((p) => shownIds.has(p.skillId)) : []), [snapshot, shownIds]);
  const selected = snapshot?.skills.find((s) => s.id === selectedId) ?? null;
  const rovingId = focusedId && shownIds.has(focusedId) ? focusedId : points[0]?.skillId ?? null;

  function focusStar(id: string | null) {
    if (!id) return;
    setFocusedId(id);
    starRefs.current.get(id)?.focus();
  }

  function onStarKey(event: React.KeyboardEvent, skillId: string) {
    if (isNavKey(event.key)) {
      event.preventDefault();
      focusStar(nextStar(points, skillId, event.key));
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setSelectedId(skillId);
    } else if (event.key === "Escape" && selectedId) {
      event.preventDefault();
      setSelectedId(null);
    }
  }

  function closeEvidence() {
    const returnTo = selectedId;
    setSelectedId(null);
    focusStar(returnTo);
  }

  const header = (
    <PageHeader
      eyebrow="From Developer Intelligence"
      title="Skill Constellation"
      titleId="skills-title"
      actions={state.kind === "loading" || state.kind === "error" ? undefined : (
        <>
          <button type="button" disabled={busy !== null} onClick={() => void run("skill_constellation.rebuild", "rebuild")}>
            {busy === "rebuild" ? "Rebuilding…" : "Rebuild"}
          </button>
          {snapshot?.enabled ? (
            <button type="button" disabled={busy !== null} onClick={() => void run("skill_constellation.disable", "toggle")}>Turn off</button>
          ) : (
            <button type="button" disabled={busy !== null} onClick={() => void run("skill_constellation.enable", "toggle")}>Turn on</button>
          )}
        </>
      )}
    />
  );

  return (
    <section className="view-stack skill-constellation" aria-labelledby="skills-title" aria-busy={state.kind === "loading"}>
      {header}
      {notice && <p className="skill-notice" role="status">{notice}</p>}

      {state.kind === "loading" && <p className="empty-state" role="status">Loading your constellation…</p>}

      {state.kind === "error" && (
        <div className="skill-error" role="alert">
          <p>Skill Constellation could not load: {state.message}</p>
          <button type="button" onClick={() => void load()}>Try again</button>
        </div>
      )}

      {state.kind === "off" && (
        <div className="empty-state skill-intro">
          <p>Skill Constellation draws your skills from what Developer Intelligence has already recorded about your repositories - technologies, TODOs and commits. It never scans your disk itself, and every star shows the evidence behind it.</p>
          <p>It is off. Turn it on to rebuild after each new Developer Intelligence scan, or build it once now.</p>
        </div>
      )}

      {state.kind === "empty" && (
        <p className="empty-state">
          No evidence yet. Skill Constellation reads only what Developer Intelligence has recorded, so scan your repositories in Developer Intelligence first, then rebuild.
        </p>
      )}

      {state.kind === "ready" && (
        <>
          <StatusLine snapshot={state.snapshot} showHidden={showHidden} onToggleHidden={() => setShowHidden((v) => !v)} />
          <div className="skill-layout">
            <figure className="skill-sky">
              <svg
                viewBox="0 0 1000 1000"
                role="group"
                aria-label="Skill constellation. Use the arrow keys to move between stars, Enter to show a star's evidence, Escape to close it."
              >
                <g className="skill-links" aria-hidden="true">
                  {state.snapshot.links
                    .filter((l) => shownIds.has(l.a) && shownIds.has(l.b))
                    .map((link) => {
                      const a = points.find((p) => p.skillId === link.a);
                      const b = points.find((p) => p.skillId === link.b);
                      if (!a || !b) return null;
                      return (
                        <line
                          key={`${link.a}|${link.b}`}
                          className={`skill-link skill-link--${link.source}`}
                          x1={a.x}
                          y1={a.y}
                          x2={b.x}
                          y2={b.y}
                          strokeOpacity={linkOpacity(link.weight)}
                        />
                      );
                    })}
                </g>
                {points.map((point) => {
                  const skill = skills.find((s) => s.id === point.skillId);
                  if (!skill) return null;
                  const r = starRadius(skill.strength.score);
                  return (
                    <g
                      key={skill.id}
                      ref={(node) => {
                        if (node) starRefs.current.set(skill.id, node);
                        else starRefs.current.delete(skill.id);
                      }}
                      className={`skill-star${skill.id === selectedId ? " skill-star--selected" : ""}${skill.hidden ? " skill-star--hidden" : ""}`}
                      role="button"
                      tabIndex={skill.id === rovingId ? 0 : -1}
                      aria-label={starLabel(skill)}
                      aria-pressed={skill.id === selectedId}
                      transform={`translate(${point.x} ${point.y})`}
                      onClick={() => {
                        setFocusedId(skill.id);
                        setSelectedId(skill.id);
                      }}
                      onFocus={() => setFocusedId(skill.id)}
                      onKeyDown={(event) => onStarKey(event, skill.id)}
                    >
                      <circle className="skill-star__halo" r={r + 6} />
                      <circle className="skill-star__core" r={r} />
                      <text className="skill-star__label" y={r + 18} textAnchor="middle">{skill.name}</text>
                    </g>
                  );
                })}
              </svg>
              <figcaption className="skill-caption">
                Bigger, nearer the centre: more evidence, more recent, across more repositories. Lines join skills evidenced in the same repositories; dashed lines are hand-written relations.
              </figcaption>
            </figure>

            {selected ? (
              <EvidencePanel
                key={selected.id}
                skill={selected}
                bridge={bridge}
                initialEvidence={initial?.evidence ?? null}
                onClose={closeEvidence}
                onToggleHidden={async () => {
                  const settings = await bridge.skillConstellationSettings();
                  const hidden = new Set(settings.hiddenSkills);
                  if (hidden.has(selected.id)) hidden.delete(selected.id);
                  else hidden.add(selected.id);
                  await bridge.skillConstellationUpdateSettings({ ...settings, hiddenSkills: [...hidden] });
                  await load();
                }}
              />
            ) : (
              <aside className="skill-panel skill-panel--hint">
                <p>Select a star to see why it is there: the repositories, files and dates behind it.</p>
              </aside>
            )}
          </div>
        </>
      )}

      {(state.kind === "ready" || state.kind === "empty" || state.kind === "off") && <SettingsPanel bridge={bridge} onSaved={load} />}
    </section>
  );
}

function StatusLine({ snapshot, showHidden, onToggleHidden }: { snapshot: ConstellationSnapshot; showHidden: boolean; onToggleHidden(): void }) {
  const hiddenCount = snapshot.skills.filter((s) => s.hidden).length;
  return (
    <div className="skill-status">
      <p>
        {snapshot.skills.length} skill{snapshot.skills.length === 1 ? "" : "s"}
        {snapshot.lastBuild?.finishedAt ? <> · built <span className="technical">{shortDate(snapshot.lastBuild.finishedAt)}</span></> : null}
        {snapshot.enabled ? " · rebuilds on schedule" : " · off"}
      </p>
      {snapshot.staleness.stale && <p className="skill-stale">Developer Intelligence has recorded something new since this was built. Rebuild to include it.</p>}
      {snapshot.countsAllCommits && (
        <p className="skill-hint">Every commit counts, because no commit emails are set. Add yours below to count only your own.</p>
      )}
      {hiddenCount > 0 && (
        <button type="button" className="skill-link-button" aria-pressed={showHidden} onClick={onToggleHidden}>
          {showHidden ? "Hide" : "Show"} {hiddenCount} hidden skill{hiddenCount === 1 ? "" : "s"}
        </button>
      )}
    </div>
  );
}

function EvidencePanel({
  skill,
  bridge,
  initialEvidence,
  onClose,
  onToggleHidden
}: {
  skill: ConstellationSkill;
  bridge: SkillConstellationBridge;
  initialEvidence: EvidenceView[] | null;
  onClose(): void;
  onToggleHidden(): Promise<void>;
}) {
  const [evidence, setEvidence] = useState<EvidenceView[] | null>(initialEvidence);
  const [history, setHistory] = useState<SkillStrengthSnapshot[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialEvidence) return;
    let live = true;
    Promise.all([bridge.skillConstellationEvidence(skill.id), bridge.skillConstellationHistory(skill.id)])
      .then(([rows, past]) => {
        if (!live) return;
        setEvidence(rows);
        setHistory(past);
      })
      .catch((e: unknown) => {
        if (live) setError(message(e));
      });
    return () => {
      live = false;
    };
  }, [bridge, skill.id, initialEvidence]);

  const groups = evidence ? groupEvidence(evidence) : [];
  const s = skill.strength;

  return (
    <aside
      className="skill-panel"
      aria-labelledby="skill-panel-title"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <div className="skill-panel__head">
        <h3 id="skill-panel-title">{skill.name}</h3>
        <button type="button" onClick={onClose} aria-label={`Close evidence for ${skill.name}`}>Close</button>
      </div>
      <p className="skill-panel__category">{CATEGORY_LABELS[skill.category]}{skill.hidden ? " · hidden" : ""}</p>

      <dl className="skill-strength">
        <div><dt>Strength</dt><dd className="technical">{percent(s.score)}</dd></div>
        <div><dt>Volume</dt><dd className="technical">{percent(s.volume)} · {skill.evidenceCount} evidence</dd></div>
        <div><dt>Recency</dt><dd className="technical">{percent(s.recency)} · last {shortDate(skill.lastEvidenceAt)}</dd></div>
        <div><dt>Variety</dt><dd className="technical">{percent(s.variety)} · {skill.repositoryCount} repos, {skill.evidenceKinds} kinds</dd></div>
      </dl>

      {history.length > 1 && (
        <p className="skill-history">
          Over the last {history.length} builds:{" "}
          <span className="technical">{[...history].reverse().map((h) => percent(h.score)).join(" → ")}</span>
        </p>
      )}

      {error && <p className="skill-error" role="alert">Could not load the evidence: {error}</p>}
      {!error && !evidence && <p className="empty-state" role="status">Loading evidence…</p>}
      {evidence && evidence.length === 0 && <p className="empty-state">No evidence rows are stored for this skill.</p>}

      {groups.map((group) => (
        <section key={group.repositoryId} className="skill-repo" aria-label={`Evidence in ${group.repositoryName}`}>
          <h4>
            {group.repositoryName}{" "}
            <span className="skill-repo__dates technical">{shortDate(group.firstAt)} – {shortDate(group.lastAt)}</span>
          </h4>
          <ul>
            {group.items.map((item) => (
              <li key={item.id} className="skill-evidence">
                <span className="skill-evidence__kind">{EVIDENCE_LABELS[item.kind]}</span>
                {item.path ? <span className="technical skill-evidence__path">{item.path}</span> : <span className="technical skill-evidence__path">{item.sourceRef.slice(0, 10)}</span>}
                <time className="technical" dateTime={item.at} title={item.at}>{shortDate(item.at)}</time>
                {item.detail && <span className="technical skill-evidence__detail">{item.detail}</span>}
                {item.todoText && <q className="skill-evidence__todo">{item.todoText}</q>}
              </li>
            ))}
          </ul>
        </section>
      ))}

      <button type="button" className="skill-link-button" onClick={() => void onToggleHidden()}>
        {skill.hidden ? "Show this skill again" : "Hide this skill"}
      </button>
    </aside>
  );
}

function SettingsPanel({ bridge, onSaved }: { bridge: SkillConstellationBridge; onSaved(): Promise<void> }) {
  const [settings, setSettings] = useState<SkillConstellationSettings | null>(null);
  const [emails, setEmails] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    bridge
      .skillConstellationSettings()
      .then((s) => {
        if (!live) return;
        setSettings(s);
        setEmails(s.myEmails.join(", "));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [bridge]);

  if (!settings) return null;

  async function save(next: SkillConstellationSettings) {
    try {
      const saved = await bridge.skillConstellationUpdateSettings(next);
      setSettings(saved);
      setEmails(saved.myEmails.join(", "));
      setStatus("Saved. Rebuild to apply.");
      await onSaved();
    } catch (e) {
      setStatus(`Could not save: ${message(e)}`);
    }
  }

  return (
    <details className="skill-settings">
      <summary>Settings</summary>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save({ ...settings, myEmails: emails.split(/[,\s]+/).filter(Boolean) });
        }}
      >
        <label>
          My commit emails
          <input
            type="text"
            className="technical"
            value={emails}
            placeholder="you@example.com"
            onChange={(event) => setEmails(event.target.value)}
          />
        </label>
        <p className="skill-hint">Only commits by these authors count. Commits recorded before authors were tracked still count.</p>
        <label className="skill-check">
          <input
            type="checkbox"
            checked={settings.includeUnmappedLibraries}
            onChange={(event) => void save({ ...settings, includeUnmappedLibraries: event.target.checked })}
          />
          Include libraries that are not in the curated list
        </label>
        <button type="submit">Save emails</button>
        {status && <p role="status" className="skill-hint">{status}</p>}
      </form>
    </details>
  );
}
