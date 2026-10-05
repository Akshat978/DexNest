import React, { useCallback, useEffect, useRef, useState } from "react";
import { todayKey } from "../lib/dates";
import type { EntityDetail, EntityType, GhostOsSettings, GhostOsStatus, Observation, Parsed, SearchHit, TimelineItem } from "@dexnest/ghost-os";
import { BookOpen, Brain, CalendarDays, Eye, FileText, FolderGit2, Ghost, GitFork, MapPin, MessageSquare, Network, Plug, Repeat, Sparkles, Trash2, Unlink, User, Users } from "lucide-react";
import { Button, ConfirmDialog, EmptyNote, EmptyState, ErrorState, InlineError, LoadingState, Notice, PageHeader, Select, StatGrid, StatTile, TabPanel, Tabs, TextArea, TextInput, accentStyle } from "../components/ui/kit";
import {
  EMPTY_ENTITY_FORM,
  ENTITY_TYPE_LIST,
  type EntityForm,
  type PickerOption,
  RELATION_TYPE_LIST,
  TABS,
  TAB_LABELS,
  TYPE_LABELS,
  type Tab,
  actionMessage,
  confirmed,
  connectionPhrase,
  dayHeading,
  entityFromForm,
  evidenceLabel,
  fieldsFor,
  formFromDetail,
  groupByDay,
  originLabel,
  pickerKey,
  pickerMessage,
  pickerOptionId,
  pickerState,
  relationDates,
  relationTypeFromText,
  relationTypeText,
  spanLabel,
  surenessReason,
  shortDate,
  shortDateTime,
  sourceLabel,
  sourcesOn,
  timelineKind,
  timelineLabel,
  viewState,
  whenLabel
} from "./ghostOsModel";
import "./GhostOs.css";

/** The preload methods this view uses. */
/** Each kind of entry has its own mark, everywhere it appears. */
const TYPE_ICONS: Record<EntityType, React.ComponentType<{ className?: string }>> = {
  person: User,
  project: FolderGit2,
  skill: Sparkles,
  knowledge: BookOpen,
  memory: Brain,
  event: CalendarDays,
  habit: Repeat,
  decision: GitFork,
  file: FileText,
  conversation: MessageSquare,
  place: MapPin
};

function TypeIcon({ type, kind = "entity" }: { type: EntityType; kind?: "entity" | "observation" | "relation" }) {
  const Icon = kind === "observation" ? Eye : kind === "relation" ? Unlink : TYPE_ICONS[type];
  return (
    <span className="ghost-type-icon" aria-hidden="true">
      <Icon />
    </span>
  );
}

export interface GhostOsBridge {
  ghostOsStatus(): Promise<GhostOsStatus>;
  ghostOsTimeline(query?: unknown): Promise<Parsed<TimelineItem[]>>;
  ghostOsSearch(query: { text: string; types?: string[] }): Promise<Parsed<SearchHit[]>>;
  ghostOsEntity(id: string): Promise<Parsed<EntityDetail>>;
  ghostOsSettings(): Promise<GhostOsSettings>;
  ghostOsUpdateSettings(settings: unknown): Promise<Parsed<GhostOsSettings>>;
}

export interface GhostOsViewProps {
  bridge: GhostOsBridge;
  /** Runs a registered ghost_os.* action through the action registry. */
  onAction(actionId: string, params?: Record<string, unknown>): Promise<unknown>;
  /** Tests only: start from a known state instead of loading. */
  initial?: {
    status: GhostOsStatus | null;
    /** YYYY-MM-DD, for the day headings in tests. */
    today?: string;
    items?: TimelineItem[];
    detail?: EntityDetail | null;
    results?: SearchHit[] | null;
    tab?: Tab;
    error?: string | null;
    confirmForget?: boolean;
    confirmDisable?: boolean;
    notice?: { ok: boolean; text: string };
    form?: EntityForm;
    picker?: PickerInitial;
  };
}

const PAGE = 50;

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong.";
}

function unwrap<T>(r: Parsed<T>): T {
  if (!r.ok) throw new Error(r.errors.join("; "));
  return r.value;
}

export function GhostOsView({ bridge, onAction, initial }: GhostOsViewProps) {
  const [status, setStatus] = useState<GhostOsStatus | null>(initial?.status ?? null);
  const [items, setItems] = useState<TimelineItem[]>(initial?.items ?? []);
  const [more, setMore] = useState(false);
  const [types, setTypes] = useState<EntityType[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchHit[] | null>(initial?.results ?? null);
  const [detail, setDetail] = useState<EntityDetail | null>(initial?.detail ?? null);
  const [loading, setLoading] = useState(initial === undefined);
  const [error, setError] = useState<string | null>(initial?.error ?? null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(initial?.notice ?? null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>(initial?.tab ?? "timeline");
  const [form, setForm] = useState<EntityForm>(initial?.form ?? EMPTY_ENTITY_FORM);
  const [confirmDisable, setConfirmDisable] = useState(initial?.confirmDisable ?? false);
  const [confirmForget, setConfirmForget] = useState<{ kind: "entity" | "relation" | "observation"; id: string } | null>(
    initial?.confirmForget && initial.detail ? { kind: "entity", id: initial.detail.entity.id } : null
  );
  // The timeline row the owner clicked; other rows of the same entry are only marked related.
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const loadTimeline = useCallback(
    async (append: TimelineItem | null, filter: EntityType[]) => {
      const page = unwrap(await bridge.ghostOsTimeline({ types: filter, limit: PAGE, before: append ? { at: append.at, id: append.id } : null }));
      setItems((prev) => (append ? [...prev, ...page] : page));
      setMore(page.length === PAGE);
    },
    [bridge]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setStatus(await bridge.ghostOsStatus());
      await loadTimeline(null, types);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }, [bridge, loadTimeline, types]);

  useEffect(() => {
    // Loads once on mount; filters and actions reload through their own handlers.
    if (initial === undefined) void load();
  }, []);

  // "Saved." has said what it had to after a few seconds; an error stays until something else happens.
  useEffect(() => {
    if (!notice?.ok || initial !== undefined) return;
    const timer = setTimeout(() => setNotice((current) => (current === notice ? null : current)), 5000);
    return () => clearTimeout(timer);
  }, [notice, initial]);

  const openEntity = useCallback(
    async (id: string) => {
      try {
        setDetail(unwrap(await bridge.ghostOsEntity(id)));
        setConfirmForget(null);
      } catch (e) {
        setNotice({ ok: false, text: errorText(e) });
      }
    },
    [bridge]
  );

  const run = useCallback(
    async (actionId: string, params: Record<string, unknown> = {}): Promise<boolean> => {
      setBusy(true);
      setNotice(null);
      try {
        const outcome = actionMessage(await onAction(actionId, params));
        if (outcome.text) setNotice({ ok: outcome.ok, text: outcome.text });
        setStatus(await bridge.ghostOsStatus());
        await loadTimeline(null, types);
        return outcome.ok;
      } catch (e) {
        setNotice({ ok: false, text: errorText(e) });
        return false;
      } finally {
        setBusy(false);
      }
    },
    [onAction, bridge, loadTimeline, types]
  );

  async function toggleType(type: EntityType) {
    const next = types.includes(type) ? types.filter((t) => t !== type) : [...types, type];
    setTypes(next);
    try {
      await loadTimeline(null, next);
    } catch (e) {
      setNotice({ ok: false, text: errorText(e) });
    }
  }

  async function search(event: React.FormEvent) {
    event.preventDefault();
    if (!query.trim()) {
      setResults(null);
      return;
    }
    try {
      setResults(unwrap(await bridge.ghostOsSearch({ text: query, types })));
    } catch (e) {
      setNotice({ ok: false, text: errorText(e) });
    }
  }

  async function saveEntity(event: React.FormEvent) {
    event.preventDefault();
    if (await run("ghost_os.entity.save", { entity: entityFromForm(form) })) {
      setForm(EMPTY_ENTITY_FORM);
      if (form.id) await openEntity(form.id);
      setTab("timeline");
    }
  }

  /** From the empty screen: one button turns the source on and reads it. */
  async function connectRepositories() {
    if (await run("ghost_os.adapter.enable", { adapterId: "developer_intelligence" })) await run("ghost_os.adapter.sync");
  }

  async function forget() {
    if (!confirmForget) return;
    const target = confirmForget;
    if (await run("ghost_os.forget", confirmed(target))) {
      setConfirmForget(null);
      if (target.kind === "entity") setDetail(null);
      else if (detail) await openEntity(detail.entity.id);
    }
  }

  const state = viewState({ loading, error, status });
  const today = initial?.today ?? todayKey();
  const di = status?.adapters.find((a) => a.id === "developer_intelligence");
  const anySourceOn = status?.adapters.some((a) => a.enabled) ?? false;

  // While a confirmation is open, its refusal shows inside it, next to the question.
  const confirming = confirmForget !== null || confirmDisable;
  const refusal = confirming && notice && !notice.ok ? notice.text : null;

  return (
    <section className="view-stack ghost" style={accentStyle("ghost")} aria-labelledby="ghost-title" aria-busy={state.kind === "loading"}>
      <PageHeader
        icon={<Ghost />}
        title="GhostOS"
        titleId="ghost-title"
        subtitle="Who, what and when: your projects, people, decisions and habits on one timeline"
        actions={state.kind === "ready" || state.kind === "empty" ? (
          anySourceOn ? <Button disabled={busy} onClick={() => void run("ghost_os.adapter.sync")}>Sync now</Button> : undefined
        ) : undefined}
      />
      {notice && !refusal && (notice.ok ? <Notice>{notice.text}</Notice> : <InlineError>{notice.text}</InlineError>)}

      {state.kind === "loading" && <LoadingState label="Loading GhostOS" />}

      {state.kind === "error" && <ErrorState title="GhostOS could not load" message={state.message} onRetry={() => void load()} />}

      {state.kind === "empty" && (
        <EmptyState
          icon={<Ghost />}
          title="Nothing in GhostOS yet"
          actions={
            <>
              {di?.installed && !di.enabled && (
                <Button variant="primary" disabled={busy} onClick={() => void connectRepositories()}>Connect your repositories</Button>
              )}
              <Button variant={di?.installed && !di.enabled ? "secondary" : "primary"} onClick={() => setTab("add")}>Add an entry</Button>
            </>
          }
        >
          <p>GhostOS answers questions like “when did I start that project?”, “what did I decide about the database, and why?”, “who was I working with last spring?” and “what do I usually work on at night?”.</p>
          <p>It does that from a timeline of your projects, people, decisions, memories and habits, each saying where it came from.</p>
          <p>
            {di?.installed && !di.enabled
              ? "Your repositories are already being scanned. Connect them and your projects, skills and commit days appear here; or add something yourself."
              : di?.enabled
                ? "Your repositories are connected. Press Sync now to read them, or add something yourself."
                : "Add something yourself. To bring in your projects and commits, turn on the repository scan from Today first."}{" "}
            GhostOS never reads your vault, finance, journal, clipboard, captures or chat histories, and nothing leaves this computer.
          </p>
        </EmptyState>
      )}

      {confirmForget && (
        <ConfirmDialog
          title={`Delete this ${FORGET_NOUN[confirmForget.kind]}?`}
          confirmLabel="Delete"
          busy={busy}
          error={refusal}
          accent="ghost"
          onConfirm={() => void forget()}
          onCancel={() => { setConfirmForget(null); setNotice(null); }}
        >
          GhostOS also deletes everything it worked out from it. This cannot be undone, and it stays deleted: syncing your repositories will not bring it back.
        </ConfirmDialog>
      )}

      {confirmDisable && (
        <ConfirmDialog
          title="Stop reading the repository scan?"
          confirmLabel="Turn off"
          busy={busy}
          error={refusal}
          accent="ghost"
          onConfirm={() => void run("ghost_os.adapter.disable", confirmed({ adapterId: "developer_intelligence" })).then((ok) => ok && setConfirmDisable(false))}
          onCancel={() => { setConfirmDisable(false); setNotice(null); }}
        >
          Everything it added to GhostOS is deleted, including detected habits. This cannot be undone.
        </ConfirmDialog>
      )}

      {(state.kind === "ready" || state.kind === "empty") && status && (
        <>
          {state.kind === "ready" && (
            <StatGrid columns={4}>
              <StatTile label="Entries" value={status.counts.entity.toLocaleString("en")} icon={<Users />} hint="people, projects, memories…" />
              <StatTile label="Connections" value={status.counts.relation.toLocaleString("en")} icon={<Network />} tone="info" />
              <StatTile label="Observations" value={status.counts.observation.toLocaleString("en")} icon={<Eye />} tone="success" hint="dated notes and commit days" />
              <StatTile
                label="Sources on"
                value={`${sourcesOn(status).on} of ${sourcesOn(status).installed}`}
                icon={<Plug />}
                tone="warning"
                hint={sourcesOn(status).on === 0 ? "only what you enter" : "synced locally"}
              />
            </StatGrid>
          )}
          <Tabs label="GhostOS sections" idPrefix="ghost" value={tab} onChange={setTab} tabs={TABS.map((t) => ({ id: t, label: TAB_LABELS[t] }))} />

          <TabPanel idPrefix="ghost" id={tab}>
            {tab === "timeline" && state.kind === "ready" && (
              <div className="ghost-timeline-layout">
                <div className="ghost-column">
                  <form className="ghost-search" role="search" aria-label="Search GhostOS" onSubmit={(e) => void search(e)}>
                    <label htmlFor="ghost-search-input">Search titles, notes and tags</label>
                    <TextInput id="ghost-search-input" type="search" value={query} onChange={(e) => setQuery(e.target.value)} />
                    <Button type="submit">Search</Button>
                    {results && <Button variant="ghost" onClick={() => { setResults(null); setQuery(""); }}>Clear</Button>}
                  </form>
                  <div className="ghost-filter" role="group" aria-labelledby="ghost-filter-label">
                    <span id="ghost-filter-label" className="ghost-meta">Show types{types.length ? "" : " (all)"}</span>
                    {ENTITY_TYPE_LIST.map((t) => (
                      <button key={t} type="button" className="ghost-chip" aria-pressed={types.includes(t)} onClick={() => void toggleType(t)}>
                        <TypeIcon type={t} />
                        {TYPE_LABELS[t]}
                      </button>
                    ))}
                  </div>

                  {results ? (
                    <ul className="ghost-list" aria-label="Search results">
                      {results.length === 0 && <li className="ghost-hint">Nothing matches.</li>}
                      {results.map((hit) => (
                        <li key={hit.id}>
                          <button type="button" className="ghost-item" aria-current={detail?.entity.id === hit.id ? "true" : undefined} onClick={() => void openEntity(hit.id)}>
                            <TypeIcon type={hit.type} />
                            <span className="ghost-item__text">
                              <span>{hit.title}</span>
                              <span className="ghost-meta">{TYPE_LABELS[hit.type]} · <time className="technical" dateTime={hit.timelineAt}>{shortDate(hit.timelineAt)}</time></span>
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <ol className="ghost-list" aria-label="Timeline, newest first">
                      {items.length === 0 && <li className="ghost-hint">Nothing on the timeline{types.length ? " for these types" : ""} yet.</li>}
                      {groupByDay(items).map((group) => (
                        <React.Fragment key={group.day}>
                          <li className="ghost-day" aria-hidden="true">{dayHeading(group.day, today)}</li>
                          {group.items.map((item) => (
                            <li key={`${item.kind}:${item.id}`} className="ghost-timeline-row">
                              <button
                                type="button"
                                className={detail?.entity.id === item.entityId && selectedKey !== `${item.kind}:${item.id}` ? "ghost-item ghost-item--related" : "ghost-item"}
                                aria-current={selectedKey === `${item.kind}:${item.id}` && detail?.entity.id === item.entityId ? "true" : undefined}
                                onClick={() => { setSelectedKey(`${item.kind}:${item.id}`); void openEntity(item.entityId); }}
                              >
                                <TypeIcon type={item.entityType} kind={item.kind} />
                                <span className="ghost-item__text">
                                  <span>{timelineLabel(item)}</span>
                                  <span className="ghost-meta">
                                    {timelineKind(item)} · {item.ongoing ? "since " : ""}<time className="technical" dateTime={item.at}>{shortDate(item.at)}</time>{item.ongoing ? " · ongoing" : ""} · {originLabel(item.origin, item.confidence)}
                                  </span>
                                </span>
                              </button>
                              <button
                                type="button"
                                className="ghost-row-delete"
                                disabled={busy}
                                aria-label={`Delete ${timelineLabel(item)}`}
                                title="Delete"
                                onClick={() => { setNotice(null); setConfirmForget({ kind: item.kind, id: item.id }); }}
                              >
                                <Trash2 aria-hidden="true" />
                              </button>
                            </li>
                          ))}
                        </React.Fragment>
                      ))}
                    </ol>
                  )}
                  {!results && more && <Button variant="ghost" disabled={busy} onClick={() => void loadTimeline(items[items.length - 1] ?? null, types)}>Show older</Button>}
                </div>

                <div className="ghost-column">
                  {detail ? (
                    <EntityDetailPanel
                      detail={detail}
                      busy={busy}
                      search={async (text) => unwrap(await bridge.ghostOsSearch({ text }))}
                      picker={initial?.picker}
                      onAskForget={(target) => { setNotice(null); setConfirmForget(target); }}
                      onOpen={(id) => void openEntity(id)}
                      onEdit={() => { setForm(formFromDetail(detail)); setTab("add"); }}
                      run={run}
                      reload={() => void openEntity(detail.entity.id)}
                    />
                  ) : (
                    <EmptyNote>Choose an entry to see its connections, observations and where each fact came from.</EmptyNote>
                  )}
                </div>
              </div>
            )}

            {tab === "add" && <EntityFormPanel form={form} setForm={setForm} busy={busy} onSubmit={(e) => void saveEntity(e)} />}

            {tab === "sources" && (
              <div className="ghost-sources">
                <section className="ghost-card" aria-labelledby="ghost-di-title">
                  <h3 id="ghost-di-title">Your repositories</h3>
                  <p>When connected, GhostOS reads what the repository scan and Skills already hold: each repository becomes a project named as in Projects, the skills are the ones on the Skills screen, and commits become one observation per repository per day. It never reads commit messages, other event types, or any file.</p>
                  {!di?.installed ? (
                    <p className="ghost-hint">The repository scan is not running, so there is nothing to connect. Turn it on from Today.</p>
                  ) : di.enabled ? (
                    <>
                      <p className="ghost-meta">
                        On · last sync {di.lastSyncAt ? <time className="technical" dateTime={di.lastSyncAt}>{shortDateTime(di.lastSyncAt)}</time> : "not yet"} ·{" "}
                        <span className="technical">{di.counts.entity}</span> entries, <span className="technical">{di.counts.relation}</span> connections, <span className="technical">{di.counts.observation}</span> observations
                      </p>
                      <div className="button-row">
                        <Button disabled={busy} onClick={() => void run("ghost_os.adapter.sync")}>Sync now</Button>
                        <Button variant="danger" disabled={busy || confirmDisable} onClick={() => { setNotice(null); setConfirmDisable(true); }} aria-describedby="ghost-di-off-note">
                          Turn off and remove what it added
                        </Button>
                      </div>
                      <p id="ghost-di-off-note" className="ghost-hint">Turning it off deletes everything it added, including detected habits. Things you deleted stay deleted.</p>
                    </>
                  ) : (
                    <div className="button-row">
                      <Button variant="primary" disabled={busy} onClick={() => void connectRepositories()}>Connect your repositories</Button>
                    </div>
                  )}
                  {status.lastError && <InlineError>Last sync failed: {status.lastError}</InlineError>}
                </section>
                <section className="ghost-card" aria-labelledby="ghost-files-title">
                  <h3 id="ghost-files-title">Export and import</h3>
                  <p>Export saves everything GhostOS holds as one JSON file where you choose. Import merges an export back in; nothing already here is overwritten.</p>
                  <div className="button-row">
                    <Button disabled={busy} onClick={() => void run("ghost_os.export")}>Export…</Button>
                    <Button disabled={busy} onClick={() => void run("ghost_os.import")}>Import…</Button>
                  </div>
                  <p className="ghost-meta">Search: <span className="technical">{status.searchMode === "fts" ? "full-text" : "simple"}</span></p>
                </section>
              </div>
            )}
          </TabPanel>
        </>
      )}
    </section>
  );
}

const FORGET_NOUN = { entity: "entry", relation: "connection", observation: "observation" } as const;

function SourceLine({ provenance, names, subject = "other" }: { provenance: EntityDetail["entity"]["provenance"]; names: Record<string, string> | undefined; subject?: "project" | "other" }) {
  const reason = surenessReason(provenance);
  return (
    <div className="ghost-source">
      <p className="ghost-meta">{sourceLabel(provenance)}</p>
      {reason && <p className="ghost-hint">{reason}</p>}
      {provenance.origin !== "manual" && (
        <ul className="ghost-evidence" aria-label="Evidence">
          {provenance.evidence.slice(0, EVIDENCE_SHOWN).map((e, i) => <li key={i}>{evidenceLabel(e, names, subject)}</li>)}
          {provenance.evidence.length > EVIDENCE_SHOWN && <li className="ghost-hint">and {provenance.evidence.length - EVIDENCE_SHOWN} more</li>}
        </ul>
      )}
    </div>
  );
}

/** Evidence lines shown before "and N more". */
const EVIDENCE_SHOWN = 6;

/** Tests only: pin the connection picker's state. */
interface PickerInitial {
  query: string;
  results: SearchHit[] | null;
  active?: number;
  chosen?: PickerOption | null;
  error?: string | null;
}

/**
 * Chooses a connection's target by searching every entry, not only the
 * timeline page. A WAI-ARIA combobox: the input owns a listbox; arrow keys,
 * Home and End move, Enter chooses, Escape closes; a live region says what
 * is happening (nothing typed, searching, no results, how many found).
 */
function ConnectionPicker(props: {
  excludeId: string;
  chosen: PickerOption | null;
  onChoose(option: PickerOption | null): void;
  search(text: string): Promise<SearchHit[]>;
  initial?: PickerInitial;
}) {
  const [query, setQuery] = useState(props.initial?.query ?? "");
  const [results, setResults] = useState<SearchHit[] | null>(props.initial?.results ?? null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(props.initial?.error ?? null);
  const [active, setActive] = useState(props.initial?.active ?? -1);
  const [open, setOpen] = useState(props.initial !== undefined && props.initial.query.trim() !== "");
  const latest = useRef(0);

  useEffect(() => {
    if (props.initial !== undefined) return;
    const text = query.trim();
    if (!text) {
      setResults(null);
      setSearching(false);
      return;
    }
    const ticket = ++latest.current;
    setSearching(true);
    // A short pause so each keystroke does not search.
    const timer = setTimeout(() => {
      props.search(text).then(
        (hits) => {
          if (ticket !== latest.current) return;
          setResults(hits);
          setError(null);
          setSearching(false);
          setActive(-1);
        },
        (e: unknown) => {
          if (ticket !== latest.current) return;
          setError(errorText(e));
          setSearching(false);
        }
      );
    }, 200);
    return () => clearTimeout(timer);
    // Only the query decides what to search for; a stale answer is dropped by its ticket.
  }, [query]);

  const state = pickerState({ query, results, searching, error, excludeId: props.excludeId });
  const options = state.kind === "results" ? state.options : [];
  const expanded = open && options.length > 0;

  function choose(option: PickerOption) {
    props.onChoose(option);
    setOpen(false);
    setQuery("");
    setResults(null);
    setActive(-1);
  }

  function onKey(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!open && event.key === "ArrowDown" && options.length > 0) setOpen(true);
    const next = pickerKey(event.key, active, options.length);
    if (!next) return;
    event.preventDefault();
    if (next.action === "close") {
      setOpen(false);
      setActive(-1);
      return;
    }
    setActive(next.active);
    const option = options[next.active];
    if (next.action === "choose" && option) choose(option);
  }

  if (props.chosen) {
    return (
      <p className="ghost-picked">
        <span>To</span>{" "}
        <strong>{props.chosen.title}</strong> <span className="ghost-meta">({props.chosen.typeLabel})</span>{" "}
        <Button variant="ghost" size="sm" onClick={() => props.onChoose(null)} aria-label={`Change the entry, now ${props.chosen.title}`}>Change</Button>
      </p>
    );
  }

  return (
    <div className="ghost-picker">
      <label htmlFor="ghost-rel-to">To</label>
      <TextInput
        id="ghost-rel-to"
        type="text"
        role="combobox"
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls="ghost-rel-to-list"
        aria-describedby="ghost-rel-to-status"
        aria-activedescendant={expanded && active >= 0 && options[active] ? pickerOptionId(options[active].id) : undefined}
        placeholder="Search your entries"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onKeyDown={onKey}
      />
      <ul id="ghost-rel-to-list" role="listbox" aria-label="Matching entries" className="ghost-picker-list" hidden={!expanded}>
        {options.map((option, i) => (
          <li
            key={option.id}
            id={pickerOptionId(option.id)}
            role="option"
            aria-selected={i === active}
            className="ghost-picker-option"
            onMouseDown={(e) => { e.preventDefault(); choose(option); }}
          >
            {option.title} <span className="ghost-meta">{option.typeLabel}</span>
          </li>
        ))}
      </ul>
      <p id="ghost-rel-to-status" className="ghost-hint" role="status" aria-live="polite">{pickerMessage(state)}</p>
    </div>
  );
}

function EntityDetailPanel(props: {
  detail: EntityDetail;
  busy: boolean;
  search(text: string): Promise<SearchHit[]>;
  picker?: PickerInitial;
  onAskForget(target: { kind: "entity" | "relation" | "observation"; id: string }): void;
  onOpen(id: string): void;
  onEdit(): void;
  run(actionId: string, params?: Record<string, unknown>): Promise<boolean>;
  reload(): void;
}) {
  const { detail, busy } = props;
  const { entity } = detail;
  const d = entity.details as Record<string, unknown>;
  const [statement, setStatement] = useState("");
  const [relType, setRelType] = useState(relationTypeText("related_to"));
  const [relTo, setRelTo] = useState<PickerOption | null>(props.picker?.chosen ?? null);
  const [relFrom, setRelFrom] = useState("");
  const [relUntil, setRelUntil] = useState("");
  const [relOngoing, setRelOngoing] = useState(true);
  const [outcome, setOutcome] = useState("");
  const names = detail.repositoryNames;
  const span = entity.occurredAt ? null : spanLabel(entity.startedAt, entity.endedAt);

  async function addObservation(event: React.FormEvent) {
    event.preventDefault();
    if (await props.run("ghost_os.observation.add", { observation: { entityId: entity.id, statement } })) {
      setStatement("");
      props.reload();
    }
  }
  async function addRelation(event: React.FormEvent) {
    event.preventDefault();
    if (!relTo) return;
    if (await props.run("ghost_os.relation.save", { relation: { fromId: entity.id, toId: relTo.id, type: relationTypeFromText(relType), ...relationDates(relFrom, relUntil, relOngoing) } })) {
      setRelTo(null);
      setRelFrom("");
      setRelUntil("");
      setRelOngoing(true);
      props.reload();
    }
  }
  async function recordOutcome(event: React.FormEvent) {
    event.preventDefault();
    if (await props.run("ghost_os.decision.record_outcome", { outcome: { id: entity.id, outcome } })) props.reload();
  }

  return (
    <article className="ghost-card ghost-detail" aria-labelledby="ghost-detail-title">
      <div className="ghost-detail-head">
        <TypeIcon type={entity.type} />
        <div className="ghost-detail-title">
          <p className="ghost-meta">{TYPE_LABELS[entity.type]}</p>
          <h3 id="ghost-detail-title">{entity.title}</h3>
        </div>
        <div className="button-row">
          {entity.provenance.origin === "manual" && <Button size="sm" disabled={busy} onClick={props.onEdit}>Edit</Button>}
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => props.onAskForget({ kind: "entity", id: entity.id })} aria-label={`Delete ${entity.title}`}>Delete…</Button>
        </div>
      </div>
      {span && <p className="ghost-meta ghost-span">{span.charAt(0).toUpperCase() + span.slice(1)}</p>}
      <SourceLine provenance={entity.provenance} names={names} subject={entity.type === "project" ? "project" : "other"} />
      {entity.tags.length > 0 && <p className="ghost-meta">Tags: {entity.tags.join(", ")}</p>}
      {entity.notes && <p className="ghost-notes">{entity.notes}</p>}

      {typeof d.text === "string" && <p className="ghost-notes">{d.text}</p>}
      {entity.type === "decision" && (
        <dl className="ghost-facts">
          <dt>Decided</dt><dd><time className="technical" dateTime={String(d.decidedAt)}>{shortDate(String(d.decidedAt))}</time></dd>
          <dt>Choice</dt><dd>{String(d.choice)}</dd>
          {Array.isArray(d.alternatives) && d.alternatives.length > 0 && (<><dt>Alternatives</dt><dd>{d.alternatives.join("; ")}</dd></>)}
          {typeof d.rationale === "string" && d.rationale && (<><dt>Why</dt><dd>{d.rationale}</dd></>)}
          <dt>Outcome</dt><dd>{typeof d.outcome === "string" ? d.outcome : "Not recorded yet"}</dd>
        </dl>
      )}
      {entity.type === "file" && (
        <dl className="ghost-facts">
          <dt>Path</dt><dd className="technical">{String(d.path)}</dd>
          <dt>Label</dt><dd>{String(d.label || "—")}</dd>
          <dt>Note</dt><dd>A reference only: GhostOS never opens this file.</dd>
        </dl>
      )}
      {entity.type === "habit" && (
        <p className="ghost-meta">{d.mode === "detected" ? "Detected from your activity" : "Declared by you"} · {String(d.cadence)}</p>
      )}

      {entity.type === "decision" && entity.provenance.origin === "manual" && typeof d.outcome !== "string" && (
        <form className="ghost-form" aria-label="Record the outcome" onSubmit={(e) => void recordOutcome(e)}>
          <label htmlFor="ghost-outcome">How did it turn out?</label>
          <TextArea id="ghost-outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)} />
          <div className="button-row">
            <Button type="submit" variant="primary" disabled={busy || !outcome.trim()}>Record outcome</Button>
          </div>
        </form>
      )}

      <h4>Connections</h4>
      {detail.relations.length === 0 ? <p className="ghost-hint">No connections.</p> : (
        <ul className="ghost-list">
          {detail.relations.map(({ relation, direction, other }) => (
            <li key={relation.id} className="ghost-row">
              <div>
                <p>
                  {connectionPhrase(relation.type, direction)}{" "}
                  {other ? <button type="button" className="ghost-link" onClick={() => props.onOpen(other.id)}>{other.title}</button> : "a deleted entry"}
                  {spanLabel(relation.validFrom, relation.validTo) && <span className="ghost-meta"> · {spanLabel(relation.validFrom, relation.validTo)}</span>}
                </p>
                <p className="ghost-meta">{sourceLabel(relation.provenance)}</p>
              </div>
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => props.onAskForget({ kind: "relation", id: relation.id })} aria-label={`Delete connection ${relationTypeText(relation.type)} ${other?.title ?? ""}`.trim()}>Delete…</Button>
            </li>
          ))}
        </ul>
      )}
      <form className="ghost-form ghost-form--inline" aria-label="New connection" onSubmit={(e) => void addRelation(e)}>
        <label htmlFor="ghost-rel-type">Connection</label>
        <TextInput id="ghost-rel-type" list="ghost-rel-types" value={relType} onChange={(e) => setRelType(e.target.value)} />
        <datalist id="ghost-rel-types">{RELATION_TYPE_LIST.map((t) => <option key={t} value={relationTypeText(t)} />)}</datalist>
        <ConnectionPicker excludeId={entity.id} chosen={relTo} onChoose={setRelTo} search={props.search} initial={props.picker} />
        <label htmlFor="ghost-rel-from">From (optional)</label>
        <TextInput id="ghost-rel-from" type="date" value={relFrom} onChange={(e) => setRelFrom(e.target.value)} />
        <label className="ghost-check">
          <input type="checkbox" checked={relOngoing} onChange={(e) => setRelOngoing(e.target.checked)} />
          Present / ongoing
        </label>
        {!relOngoing && (
          <>
            <label htmlFor="ghost-rel-until">Until</label>
            <TextInput id="ghost-rel-until" type="date" value={relUntil} onChange={(e) => setRelUntil(e.target.value)} />
          </>
        )}
        <Button type="submit" disabled={busy || !relTo}>Connect</Button>
      </form>

      <h4>Observations</h4>
      <p className="ghost-hint">Dated notes about this entry: something that happened or that you noticed, such as “shipped version 2” or “moved the API to Postgres”. Connected repositories add one for each day with commits.</p>
      {detail.observations.length === 0 ? <p className="ghost-hint">None yet.</p> : (
        <ul className="ghost-list">
          {detail.observations.map((o: Observation) => (
            <li key={o.id} className="ghost-row">
              <div>
                <p><time className="technical" dateTime={o.observedAt}>{shortDate(o.observedAt)}</time> · {o.statement}</p>
                <SourceLine provenance={o.provenance} names={names} />
              </div>
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => props.onAskForget({ kind: "observation", id: o.id })} aria-label={`Delete observation from ${shortDate(o.observedAt)}`}>Delete…</Button>
            </li>
          ))}
        </ul>
      )}
      <form className="ghost-form ghost-form--inline" aria-label="New observation" onSubmit={(e) => void addObservation(e)}>
        <label htmlFor="ghost-obs">Something you observed</label>
        <TextInput id="ghost-obs" value={statement} onChange={(e) => setStatement(e.target.value)} />
        <Button type="submit" disabled={busy || !statement.trim()}>Add</Button>
      </form>

      {detail.derivedFrom.length > 0 && (
        <p className="ghost-meta">Worked out from <span className="technical">{detail.derivedFrom.length}</span> record{detail.derivedFrom.length === 1 ? "" : "s"}; deleting any of them removes this.</p>
      )}
    </article>
  );
}

function EntityFormPanel({ form, setForm, busy, onSubmit }: { form: EntityForm; setForm(f: EntityForm): void; busy: boolean; onSubmit(e: React.FormEvent): void }) {
  const set = <K extends keyof EntityForm>(key: K, value: EntityForm[K]) => setForm({ ...form, [key]: value });
  const fields = fieldsFor(form.type);
  return (
    <form className="ghost-form ghost-card" aria-label={form.id ? "Edit entry" : "New entry"} onSubmit={onSubmit}>
      <label htmlFor="ghost-f-type">Type</label>
      <Select id="ghost-f-type" value={form.type} disabled={form.id !== null} onChange={(e) => set("type", e.target.value as EntityType)}>
        {ENTITY_TYPE_LIST.map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
      </Select>
      <label htmlFor="ghost-f-title">Title</label>
      <TextInput id="ghost-f-title" required value={form.title} onChange={(e) => set("title", e.target.value)} />
      {fields.includes("when") && (<><label htmlFor="ghost-f-when">{whenLabel(form.type)}</label><TextInput id="ghost-f-when" type="date" value={form.when} onChange={(e) => set("when", e.target.value)} /></>)}
      {fields.includes("endedAt") && (
        <>
          <label className="ghost-check">
            <input type="checkbox" checked={form.ongoing} onChange={(e) => set("ongoing", e.target.checked)} />
            Present / ongoing (it has not ended)
          </label>
          {!form.ongoing && (<><label htmlFor="ghost-f-ended">Ended</label><TextInput id="ghost-f-ended" type="date" value={form.endedAt} onChange={(e) => set("endedAt", e.target.value)} /></>)}
        </>
      )}
      {fields.includes("text") && (<><label htmlFor="ghost-f-text">{form.type === "conversation" ? "Paste the conversation" : "What happened"}</label><TextArea id="ghost-f-text" value={form.text} onChange={(e) => set("text", e.target.value)} /></>)}
      {fields.includes("participants") && (<><label htmlFor="ghost-f-participants">Participants (comma separated)</label><TextInput id="ghost-f-participants" value={form.participants} onChange={(e) => set("participants", e.target.value)} /></>)}
      {fields.includes("choice") && (<><label htmlFor="ghost-f-choice">What you chose</label><TextInput id="ghost-f-choice" value={form.choice} onChange={(e) => set("choice", e.target.value)} /></>)}
      {fields.includes("alternatives") && (<><label htmlFor="ghost-f-alts">Alternatives (one per line)</label><TextArea id="ghost-f-alts" value={form.alternatives} onChange={(e) => set("alternatives", e.target.value)} /></>)}
      {fields.includes("rationale") && (<><label htmlFor="ghost-f-why">Why</label><TextArea id="ghost-f-why" value={form.rationale} onChange={(e) => set("rationale", e.target.value)} /></>)}
      {fields.includes("cadence") && (
        <>
          <label htmlFor="ghost-f-cadence">How often</label>
          <Select id="ghost-f-cadence" value={form.cadence} onChange={(e) => set("cadence", e.target.value as EntityForm["cadence"])}>
            <option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="irregular">Irregular</option>
          </Select>
        </>
      )}
      {fields.includes("path") && (<><label htmlFor="ghost-f-path">Path (a reference; GhostOS never opens it)</label><TextInput id="ghost-f-path" className="technical" value={form.path} onChange={(e) => set("path", e.target.value)} /></>)}
      {fields.includes("label") && (<><label htmlFor="ghost-f-label">Label</label><TextInput id="ghost-f-label" value={form.label} onChange={(e) => set("label", e.target.value)} /></>)}
      <label htmlFor="ghost-f-notes">Notes</label>
      <TextArea id="ghost-f-notes" value={form.notes} onChange={(e) => set("notes", e.target.value)} />
      <label htmlFor="ghost-f-tags">Tags (comma separated)</label>
      <TextInput id="ghost-f-tags" value={form.tags} onChange={(e) => set("tags", e.target.value)} />
      <p className="ghost-hint">Saved as entered by you.</p>
      <div className="button-row">
        <Button type="submit" variant="primary" disabled={busy || !form.title.trim()}>{form.id ? "Save changes" : "Save"}</Button>
        {form.id && <Button variant="ghost" onClick={() => setForm(EMPTY_ENTITY_FORM)}>Cancel edit</Button>}
      </div>
    </form>
  );
}

