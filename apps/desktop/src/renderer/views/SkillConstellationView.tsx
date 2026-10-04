import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ConstellationSkill,
  ConstellationSnapshot,
  EvidenceView,
  SkillConstellationSettings,
  SkillStrengthSnapshot
} from "@dexnest/skill-constellation";
import { Clock, Code2, Sparkles, Star, Stars } from "lucide-react";
import {
  accentStyle,
  Badge,
  Button,
  EmptyNote,
  EmptyState,
  ErrorState,
  Field,
  InlineError,
  ListRow,
  LoadingState,
  Meter,
  Notice,
  PageHeader,
  Ring,
  Sparkline,
  StatGrid,
  StatTile,
  TextInput
} from "../components/ui/kit";
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
  basisNote,
  recencyNote,
  repositoryRange,
  volumeNote,
  labelledIds,
  labelPlacement,
  labelSides,
  countOf,
  brightest,
  fitViewBox,
  categoryLabel,
  skyScale,
  skyStats,
  starDust,
  starGlow,
  starRadius,
  viewBoxString,
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
  skillConstellationCommitAuthors?(): Promise<{ email: string; commits: number }[]>;
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
  const [hoveredId, setHoveredId] = useState<string | null>(null);
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
  const labelled = labelledIds(skills, [hoveredId, focusedId, selectedId]);
  const box = useMemo(() => fitViewBox(points), [points]);
  const scale = skyScale(box);
  const radius = (score: number) => Math.round(starRadius(score) * scale * 10) / 10;
  const drawn = points.flatMap((p) => {
    const skill = skills.find((s) => s.id === p.skillId);
    return skill ? [{ id: skill.id, name: skill.name, x: p.x, y: p.y, r: radius(skill.strength.score) }] : [];
  });
  // Labels avoid each other and every drawn star, not just the labelled ones.
  const sides = labelSides(drawn.filter((d) => labelled.has(d.id)), scale, drawn);

  const dust = useMemo(() => starDust(box), [box]);
  const stats = useMemo(() => skyStats(skills), [skills]);

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
      icon={<Stars />}
      title="Skill Constellation"
      titleId="skills-title"
      subtitle="From the repository scan"
      actions={state.kind === "loading" || state.kind === "error" ? undefined : (
        <>
          <Button disabled={busy !== null} onClick={() => void run("skill_constellation.rebuild", "rebuild")}>
            {busy === "rebuild" ? "Rebuilding…" : snapshot?.enabled ? "Rebuild" : "Build once"}
          </Button>
          {snapshot?.enabled ? (
            <Button variant="ghost" disabled={busy !== null} onClick={() => void run("skill_constellation.disable", "toggle")}>Turn off</Button>
          ) : (
            <Button variant="primary" disabled={busy !== null} onClick={() => void run("skill_constellation.enable", "toggle")}>Turn on</Button>
          )}
        </>
      )}
    />
  );

  return (
    <section className="view-stack skill-constellation" style={accentStyle("skills")} aria-labelledby="skills-title" aria-busy={state.kind === "loading"}>
      {header}
      {notice && <Notice tone="info">{notice}</Notice>}

      {state.kind === "loading" && <LoadingState label="Loading your constellation" />}

      {state.kind === "error" && <ErrorState title="Skill Constellation could not load" message={state.message} onRetry={() => void load()} />}

      {state.kind === "off" && (
        <EmptyState icon={<Stars />} title="Skill Constellation is off">
          <p>Skill Constellation draws your skills from what the repository scan has already recorded about your repositories - technologies, TODOs and commits. It never scans your disk itself, and every star shows the evidence behind it.</p>
          <p>Turn it on to rebuild after each new repository scan, or build it once now.</p>
        </EmptyState>
      )}

      {state.kind === "empty" && (
        <EmptyState icon={<Stars />} title="No evidence yet">
          <p>Skill Constellation reads only what the repository scan has recorded, so scan your repositories from Today first, then rebuild.</p>
        </EmptyState>
      )}

      {state.kind === "ready" && (
        <>
          <StatusLine snapshot={state.snapshot} showHidden={showHidden} onToggleHidden={() => setShowHidden((v) => !v)} />
          <StatGrid columns={4}>
            <StatTile label="Skills" value={String(stats.count)} icon={<Stars />} hint={`${stats.languages} language${stats.languages === 1 ? "" : "s"}`} />
            <StatTile label="Strongest" value={stats.strongest?.name ?? "—"} icon={<Star />} tone="warning" hint={stats.strongest ? `strength ${percent(stats.strongest.strength.score)}` : undefined} />
            <StatTile label="Freshest" value={stats.freshest?.name ?? "—"} icon={<Clock />} tone="success" hint={stats.freshest?.lastActivityAt ? `last worked ${shortDate(stats.freshest.lastActivityAt)}` : "no dated work yet"} />
            <StatTile label="Evidence" value={String(skills.reduce((n, s) => n + s.evidenceCount, 0))} icon={<Code2 />} tone="info" hint="facts behind the stars" />
          </StatGrid>
          <div className="skill-layout">
            <figure className="skill-sky">
              <svg
                viewBox={viewBoxString(box)}
                preserveAspectRatio="xMidYMid meet"
                role="group"
                aria-label="Skill constellation. Use the arrow keys to move between stars, Enter to show a star's evidence, Escape to close it."
              >
                <g className="skill-dust" aria-hidden="true">
                  {dust.map((d, i) => (
                    <circle key={i} cx={d.x} cy={d.y} r={d.r} fillOpacity={d.o} />
                  ))}
                </g>
                <g className="skill-links" aria-hidden="true" style={{ strokeWidth: 1.2 * scale }}>
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
                  const r = radius(skill.strength.score);
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
                      onMouseEnter={() => setHoveredId(skill.id)}
                      onMouseLeave={() => setHoveredId((current) => (current === skill.id ? null : current))}
                      onKeyDown={(event) => onStarKey(event, skill.id)}
                    >
                      <circle className="skill-star__glow" r={r * 2.6} fillOpacity={starGlow(skill.strength.recency)} />
                      <circle className="skill-star__halo" r={r + 6 * scale} />
                      <circle className="skill-star__core" r={r} />
                      {labelled.has(skill.id) && (
                        <text
                          className="skill-star__label"
                          x={labelPlacement(r, sides.get(skill.id) ?? "below", scale).dx}
                          y={labelPlacement(r, sides.get(skill.id) ?? "below", scale).dy}
                          textAnchor={labelPlacement(r, sides.get(skill.id) ?? "below", scale).anchor}
                          style={{ fontSize: 22 * scale, strokeWidth: 6 * scale }}
                        >
                          {skill.name}
                        </text>
                      )}
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
                repositoryActivity={state.snapshot.repositoryActivity}
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
              <aside className="skill-panel skill-panel--hint" aria-labelledby="skill-brightest-title">
                <h3 id="skill-brightest-title" className="skill-panel__eyebrow">Brightest stars</h3>
                <div className="skill-rows">
                  {brightest(skills).map((s) => (
                    <ListRow
                      key={s.id}
                      icon={<Sparkles />}
                      title={s.name}
                      meta={`${categoryLabel(s.category)} · ${countOf(s.repositoryCount, "repository", "repositories")}`}
                      trailing={percent(s.strength.score)}
                      onClick={() => {
                        setFocusedId(s.id);
                        setSelectedId(s.id);
                      }}
                    />
                  ))}
                </div>
                <p className="skill-hint">Select a star to see why it is there: the repositories, files and dates behind it.</p>
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
      {snapshot.staleness.stale && (
        <p className="skill-stale">
          {snapshot.staleness.devChanged || !snapshot.staleness.settingsChanged
            ? "The repository scan has recorded something new since this was built. Rebuild to include it."
            : "A setting, or how strength is worked out, changed since this was built. Rebuild to bring the numbers up to date."}
        </p>
      )}
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
  repositoryActivity,
  onClose,
  onToggleHidden
}: {
  skill: ConstellationSkill;
  bridge: SkillConstellationBridge;
  initialEvidence: EvidenceView[] | null;
  /** When the counted commits in each repository happened. */
  repositoryActivity: ConstellationSnapshot["repositoryActivity"] | undefined;
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
        <Ring value={s.score} max={1} size={84} stroke={7} center={percent(s.score)} caption="strength" label={`${skill.name}: strength ${percent(s.score)}`} />
        <div className="skill-panel__title">
          <h3 id="skill-panel-title">{skill.name}</h3>
          <p className="skill-panel__category">
            <Badge tone="accent">{categoryLabel(skill.category)}</Badge>
            {skill.hidden ? " hidden" : ""}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label={`Close evidence for ${skill.name}`}>Close</Button>
      </div>

      <div className="skill-strength">
        <Meter label="Volume" value={s.volume} max={1} display={`${percent(s.volume)} · ${volumeNote(skill)}`} />
        <Meter label="Recency" value={s.recency} max={1} display={`${percent(s.recency)} · ${recencyNote(skill)}`} tone="success" />
        <Meter label="Variety" value={s.variety} max={1} display={`${percent(s.variety)} · ${countOf(skill.repositoryCount, "repository", "repositories")}, ${countOf(skill.evidenceKinds, "kind", "kinds")}`} tone="info" />
      </div>

      <p className="skill-hint">{basisNote(skill)}</p>

      {history.length > 1 && (
        <div className="skill-history">
          <p>Strength over the last {history.length} builds <span className="technical">{[...history].reverse().map((h) => percent(h.score)).join(" → ")}</span></p>
          <Sparkline values={[...history].reverse().map((h) => h.score)} height={36} fill label={`${skill.name}'s strength over the last ${history.length} builds`} />
        </div>
      )}

      {error && <InlineError>Could not load the evidence: {error}</InlineError>}
      {!error && !evidence && <LoadingState label="Loading evidence" rows={1} />}
      {evidence && evidence.length === 0 && <EmptyNote>No evidence rows are stored for this skill.</EmptyNote>}

      {groups.map((group) => (
        <section key={group.repositoryId} className="skill-repo" aria-label={`Evidence in ${group.repositoryName}`}>
          <h4>
            {group.repositoryName}{" "}
            <span className="skill-repo__dates technical">{repositoryRange(group.repositoryId, repositoryActivity)}</span>
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
  const [authors, setAuthors] = useState<{ email: string; commits: number }[]>([]);
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
    bridge
      .skillConstellationCommitAuthors?.()
      .then((found) => {
        if (live) setAuthors(found);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [bridge]);

  if (!settings) return null;

  const typed = new Set(emails.toLowerCase().split(/[,\s]+/).filter(Boolean));
  const suggestions = authors.filter((a) => !typed.has(a.email));

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
        <Field label="My commit emails">
          <TextInput
            type="text"
            className="technical"
            value={emails}
            placeholder="you@example.com"
            onChange={(event) => setEmails(event.target.value)}
          />
        </Field>
        {suggestions.length > 0 && (
          <div className="skill-authors" role="group" aria-label="Emails on the commits already scanned">
            <span className="skill-hint">On your scanned commits:</span>
            {suggestions.map((author) => (
              <button
                key={author.email}
                type="button"
                className="skill-link-button technical"
                title={`Add ${author.email}`}
                onClick={() => setEmails([...typed, author.email].join(", "))}
              >
                {author.email} ({countOf(author.commits, "commit", "commits")})
              </button>
            ))}
          </div>
        )}
        <p className="skill-hint">Only commits by these authors count. Pick yours above, then save. Commits recorded before authors were tracked still count.</p>
        <label className="skill-check">
          <input
            type="checkbox"
            checked={settings.includeUnmappedLibraries}
            onChange={(event) => void save({ ...settings, includeUnmappedLibraries: event.target.checked })}
          />
          Include libraries that are not in the curated list
        </label>
        <div className="button-row">
          <Button type="submit">Save emails</Button>
        </div>
        {status && <p role="status" className="skill-hint">{status}</p>}
      </form>
    </details>
  );
}
