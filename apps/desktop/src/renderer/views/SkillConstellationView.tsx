import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ConstellationSkill,
  ConstellationSnapshot,
  EvidenceCount,
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
  countsFromEvidence,
  METER_HELP,
  orderEvidence,
  STRENGTH_HELP,
  summariseRepositories,
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
import { useOutsideAi } from "./outsideAiUse";
import "./OutsideAi.css";
import "./SkillConstellation.css";

/** The preload methods this view uses. */
export interface SkillConstellationBridge {
  skillConstellationSnapshot(): Promise<ConstellationSnapshot>;
  skillConstellationEvidence(skillId: string): Promise<EvidenceView[]>;
  skillConstellationEvidenceCounts?(skillId: string): Promise<EvidenceCount[]>;
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
      } else if (text && !(result && typeof result === "object" && "status" in result && result.status === "completed")) {
        // A finished rebuild needs no second line: the status line below already says what was built and when.
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
      title="Skills"
      titleId="skills-title"
      subtitle="Your constellation, drawn from the repository scan"
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

      {state.kind === "error" && <ErrorState title="Skills could not load" message={state.message} onRetry={() => void load()} />}

      {state.kind === "off" && (
        <EmptyState icon={<Stars />} title="Skills is off">
          <p>Skills draws your skills from what the repository scan has already recorded about your repositories - technologies, TODOs and commits. It never scans your disk itself, and every star shows the evidence behind it.</p>
          <p>Turn it on to rebuild after each new repository scan, or build it once now.</p>
        </EmptyState>
      )}

      {state.kind === "empty" && (
        <EmptyState icon={<Stars />} title="No evidence yet">
          <p>Skills reads only what the repository scan has recorded, so scan your repositories from Today first, then rebuild.</p>
        </EmptyState>
      )}

      {state.kind === "ready" && (
        <>
          <StatusLine snapshot={state.snapshot} showHidden={showHidden} onToggleHidden={() => setShowHidden((v) => !v)} />
          <ToolingCheck bridge={bridge} onChanged={load} />
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
                      <title>{`${skill.name} · ${categoryLabel(skill.category)} · strength ${percent(skill.strength.score)}`}</title>
                      <circle className="skill-star__glow" r={r * 2.6} fillOpacity={starGlow(skill.strength.recency)} />
                      <circle className="skill-star__halo" r={r + 6 * scale} />
                      <circle className="skill-star__core" r={r} />
                      {labelled.has(skill.id) && (
                        <text
                          className={`skill-star__label${skill.strength.score < 0.1 ? " skill-star__label--faint" : ""}`}
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
              <figcaption className="skill-legend">
                <span className="skill-legend__title">How to read it</span>
                <ul>
                  <li><span className="skill-key skill-key--size" aria-hidden="true" />Bigger and nearer the centre: stronger</li>
                  <li><span className="skill-key skill-key--glow" aria-hidden="true" />Brighter glow: worked in more recently</li>
                  <li><span className="skill-key skill-key--line" aria-hidden="true" />Line: used in the same repositories</li>
                  <li><span className="skill-key skill-key--dashed" aria-hidden="true" />Dashed line: known to go together</li>
                </ul>
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
                <StrengthHelp />
              </aside>
            )}
          </div>
        </>
      )}

      {(state.kind === "ready" || state.kind === "empty" || state.kind === "off") && (
        <p className="skill-hint skill-settings-link">
          Which commits count as yours, and which libraries are included, are in{" "}
          <button
            type="button"
            className="skill-link-button"
            onClick={() => {
              // Settings opens on the section asked for here.
              try { sessionStorage.setItem("dexnest:settingsSection", "modules"); } catch { /* opens on its first section */ }
              void onAction("settings.open");
            }}
          >
            Settings → Modules
          </button>
          .
        </p>
      )}
    </section>
  );
}

/**
 * With Outside AI switched on for it: asks which of the names Skills shows are
 * tooling and not skills. It only lists them; hiding one is the user's click.
 */
function ToolingCheck({ bridge, onChanged }: { bridge: SkillConstellationBridge; onChanged(): Promise<void> | void }) {
  const ai = useOutsideAi<{ asked?: number; tooling?: { id: string; name: string }[] }>("skills", "outside_ai.sort_skills");
  const [found, setFound] = useState<{ asked: number; tooling: { id: string; name: string }[] } | null>(null);
  if (!ai.on) return null;
  const hide = async (ids: string[]) => {
    const settings = await bridge.skillConstellationSettings();
    await bridge.skillConstellationUpdateSettings({ ...settings, hiddenSkills: [...new Set([...settings.hiddenSkills, ...ids])] });
    setFound((current) => current && { ...current, tooling: current.tooling.filter((skill) => !ids.includes(skill.id)) });
    await onChanged();
  };
  return (
    <div className="skill-status" role="group" aria-label="Sort skills from tooling">
      <div className="outside-ai-row">
        <button type="button" className="skill-link-button" disabled={ai.busy} onClick={() => void ai.ask().then((result) => { if (result) setFound({ asked: result.asked ?? 0, tooling: result.tooling ?? [] }); })}>
          {ai.busy ? "Asking…" : "Ask which are tooling"}
        </button>
        <span className="skill-hint">Sends the names of up to 40 of these (not the languages) to Outside AI. Names only.</span>
      </div>
      {ai.error && <p className="skill-stale" role="alert">{ai.error}</p>}
      {found && !ai.error && (found.tooling.length === 0 ? (
        <p className="skill-hint" role="status">Of the {found.asked} names sent, none {found.asked === 1 ? "was" : "were"} marked as tooling.</p>
      ) : (
        <>
          <p className="skill-hint" role="status">Outside AI marked these as tooling, not skills. It can be wrong; hide only the ones you agree with. A hidden skill can be shown again.</p>
          <ul className="outside-ai-sources">
            {found.tooling.map((skill) => (
              <li key={skill.id}>
                {skill.name} <button type="button" className="skill-link-button" onClick={() => void hide([skill.id])}>Hide</button>
              </li>
            ))}
          </ul>
          {found.tooling.length > 1 && <button type="button" className="skill-link-button" onClick={() => void hide(found.tooling.map((skill) => skill.id))}>Hide all {found.tooling.length}</button>}
        </>
      ))}
    </div>
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
        <p className="skill-hint">Every commit counts, because no commit emails are set. Add yours in Settings → Modules to count only your own.</p>
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
  const [counts, setCounts] = useState<EvidenceCount[] | null>(null);
  const [history, setHistory] = useState<SkillStrengthSnapshot[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialEvidence) return;
    let live = true;
    Promise.all([
      bridge.skillConstellationEvidence(skill.id),
      bridge.skillConstellationHistory(skill.id),
      bridge.skillConstellationEvidenceCounts?.(skill.id) ?? Promise.resolve(null)
    ])
      .then(([rows, past, counted]) => {
        if (!live) return;
        setEvidence(rows);
        setHistory(past);
        setCounts(counted);
      })
      .catch((e: unknown) => {
        if (live) setError(message(e));
      });
    return () => {
      live = false;
    };
  }, [bridge, skill.id, initialEvidence]);

  const groups = evidence ? groupEvidence(evidence) : [];
  // The whole counts when the host gave them; otherwise what the listed rows add up to.
  const summaries = evidence ? summariseRepositories(counts ?? countsFromEvidence(evidence)) : [];
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
        <p className="skill-meter-help">{skill.category === "language" ? METER_HELP.volume.language : METER_HELP.volume.other}</p>
        <Meter label="Recency" value={s.recency} max={1} display={`${percent(s.recency)} · ${recencyNote(skill)}`} tone="success" />
        <p className="skill-meter-help">{METER_HELP.recency}</p>
        <Meter label="Variety" value={s.variety} max={1} display={`${percent(s.variety)} · ${countOf(skill.repositoryCount, "repository", "repositories")}, ${countOf(skill.evidenceKinds, "kind", "kinds")}`} tone="info" />
        <p className="skill-meter-help">{METER_HELP.variety}</p>
      </div>

      <p className="skill-hint">{basisNote(skill)}</p>
      <StrengthHelp />

      {history.length > 1 && (
        <div className="skill-history">
          <p>Strength over the last {history.length} builds <span className="technical">{[...history].reverse().map((h) => percent(h.score)).join(" → ")}</span></p>
          <Sparkline values={[...history].reverse().map((h) => h.score)} height={36} fill label={`${skill.name}'s strength over the last ${history.length} builds`} />
        </div>
      )}

      {error && <InlineError>Could not load the evidence: {error}</InlineError>}
      {!error && !evidence && <LoadingState label="Loading evidence" rows={1} />}
      {evidence && evidence.length === 0 && <EmptyNote>No evidence rows are stored for this skill.</EmptyNote>}

      {summaries.length > 0 && <h4 className="skill-panel__eyebrow">Where it comes from</h4>}
      {summaries.map((summary) => {
        const items = orderEvidence(groups.find((g) => g.repositoryId === summary.repositoryId)?.items ?? []);
        return (
          <section key={summary.repositoryId} className="skill-repo" aria-label={`Evidence in ${summary.repositoryName}`}>
            <h4>
              {summary.repositoryName}{" "}
              <span className="skill-repo__dates technical">{repositoryRange(summary.repositoryId, repositoryActivity)}</span>
            </h4>
            <p className="skill-repo__summary">{summary.line}</p>
            {items.length > 0 && (
              <details className="skill-repo__detail">
                <summary>
                  {items.length < summary.total ? `Show the latest ${items.length} of ${summary.total.toLocaleString("en-GB")} pieces of evidence` : `Show ${countOf(items.length, "piece", "pieces")} of evidence`}
                </summary>
                <ul>
                  {items.map((item) => (
                    <li key={item.id} className={`skill-evidence${item.kind === "todo.open" || item.kind === "todo.resolved" ? " skill-evidence--todo" : ""}`}>
                      <span className="skill-evidence__kind">{EVIDENCE_LABELS[item.kind]}</span>
                      {item.path ? <span className="technical skill-evidence__path">{item.path}</span> : <span className="technical skill-evidence__path">{item.sourceRef.slice(0, 10)}</span>}
                      <time className="technical" dateTime={item.at} title={item.at}>
                        {item.kind === "commit" || item.kind === "todo.resolved" ? shortDate(item.at) : `seen ${shortDate(item.at)}`}
                      </time>
                      {item.detail && <span className="technical skill-evidence__detail">{item.detail}</span>}
                      {item.todoText && <q className="skill-evidence__todo">{item.todoText}</q>}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </section>
        );
      })}

      <button type="button" className="skill-link-button" onClick={() => void onToggleHidden()}>
        {skill.hidden ? "Show this skill again" : "Hide this skill"}
      </button>
    </aside>
  );
}

/** What a strength percentage means, for whoever asks. Closed until opened. */
function StrengthHelp() {
  return (
    <details className="skill-help">
      <summary>What the percentages mean</summary>
      {STRENGTH_HELP.map((line) => (
        <p key={line}>{line}</p>
      ))}
    </details>
  );
}
