import React, { useCallback, useEffect, useRef, useState } from "react";
import type { EntityDetail, EntityType, GhostOsSettings, GhostOsStatus, Observation, Parsed, SearchHit, TimelineItem } from "@dexnest/ghost-os";
import { PageHeader } from "../components/shared";
import {
  actionMessage,
  EMPTY_ENTITY_FORM,
  ENTITY_TYPE_LIST,
  entityFromForm,
  evidenceLabel,
  fieldsFor,
  formFromDetail,
  nextTab,
  pickerKey,
  pickerMessage,
  pickerOptionId,
  pickerState,
  RELATION_TYPE_LIST,
  shortDate,
  shortDateTime,
  originLabel,
  sourceLabel,
  TAB_LABELS,
  TABS,
  timelineKind,
  timelineLabel,
  TYPE_LABELS,
  viewState,
  whenLabel,
  type EntityForm,
  type PickerOption,
  type Tab
} from "./ghostOsModel";
import "./GhostOs.css";

/** The preload methods this view uses. */
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
    items?: TimelineItem[];
    detail?: EntityDetail | null;
    results?: SearchHit[] | null;
    tab?: Tab;
    error?: string | null;
    confirmForget?: boolean;
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
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>(initial?.tab ?? "timeline");
  const [form, setForm] = useState<EntityForm>(initial?.form ?? EMPTY_ENTITY_FORM);
  const [confirmForget, setConfirmForget] = useState<{ kind: "entity" | "relation" | "observation"; id: string } | null>(
    initial?.confirmForget && initial.detail ? { kind: "entity", id: initial.detail.entity.id } : null
  );
  const tabRefs = useRef(new Map<Tab, HTMLButtonElement>());

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

  async function forget() {
    if (!confirmForget) return;
    const target = confirmForget;
    if (await run("ghost_os.forget", target)) {
      setConfirmForget(null);
      if (target.kind === "entity") setDetail(null);
      else if (detail) await openEntity(detail.entity.id);
    }
  }

  function onTabKey(event: React.KeyboardEvent) {
    const next = nextTab(tab, event.key);
    if (!next) return;
    event.preventDefault();
    setTab(next);
    tabRefs.current.get(next)?.focus();
  }

  const state = viewState({ loading, error, status });
  const di = status?.adapters.find((a) => a.id === "developer_intelligence");
  const anySourceOn = status?.adapters.some((a) => a.enabled) ?? false;

  return (
    <section className="view-stack ghost" aria-labelledby="ghost-title" aria-busy={state.kind === "loading"}>
      <PageHeader
        eyebrow="Your life, as evidence"
        title="GhostOS"
        titleId="ghost-title"
        actions={state.kind === "ready" || state.kind === "empty" ? (
          anySourceOn ? <button type="button" disabled={busy} onClick={() => void run("ghost_os.adapter.sync")}>Sync now</button> : undefined
        ) : undefined}
      />
      {notice && <p className={notice.ok ? "ghost-notice" : "ghost-notice ghost-notice--error"} role={notice.ok ? "status" : "alert"}>{notice.text}</p>}

      {state.kind === "loading" && <p className="empty-state" role="status">Loading GhostOS…</p>}

      {state.kind === "error" && (
        <div className="ghost-error" role="alert">
          <p>GhostOS could not load: {state.message}</p>
          <button type="button" onClick={() => void load()}>Try again</button>
        </div>
      )}

      {state.kind === "empty" && (
        <div className="empty-state ghost-intro">
          <p>GhostOS keeps a local model of you: people, projects, skills, memories, decisions and habits, and how they connect over time. Every fact says where it came from and how sure it is.</p>
          <p>Nothing is in it yet. Add something yourself, or turn on Developer Intelligence under Sources. GhostOS never reads your vault, finance, journal, clipboard, captures or chat histories, and nothing leaves this computer.</p>
        </div>
      )}

      {(state.kind === "ready" || state.kind === "empty") && status && (
        <>
          <div className="ghost-tabs" role="tablist" aria-label="GhostOS sections" onKeyDown={onTabKey}>
            {TABS.map((t) => (
              <button
                key={t}
                ref={(el) => { if (el) tabRefs.current.set(t, el); else tabRefs.current.delete(t); }}
                type="button"
                role="tab"
                id={`ghost-tab-${t}`}
                aria-selected={tab === t}
                aria-controls={`ghost-panel-${t}`}
                tabIndex={tab === t ? 0 : -1}
                onClick={() => setTab(t)}
              >
                {TAB_LABELS[t]}
              </button>
            ))}
          </div>

          <div role="tabpanel" id={`ghost-panel-${tab}`} aria-labelledby={`ghost-tab-${tab}`} className="ghost-panel">
            {tab === "timeline" && (
              <div className="ghost-timeline-layout">
                <div className="ghost-column">
                  <form className="ghost-search" role="search" aria-label="Search GhostOS" onSubmit={(e) => void search(e)}>
                    <label htmlFor="ghost-search-input">Search titles, notes and tags</label>
                    <input id="ghost-search-input" type="search" value={query} onChange={(e) => setQuery(e.target.value)} />
                    <button type="submit">Search</button>
                    {results && <button type="button" onClick={() => { setResults(null); setQuery(""); }}>Clear</button>}
                  </form>
                  <fieldset className="ghost-filter">
                    <legend>Show types</legend>
                    {ENTITY_TYPE_LIST.map((t) => (
                      <label key={t} className="ghost-chip">
                        <input type="checkbox" checked={types.includes(t)} onChange={() => void toggleType(t)} />
                        {TYPE_LABELS[t]}
                      </label>
                    ))}
                  </fieldset>

                  {results ? (
                    <ul className="ghost-list" aria-label="Search results">
                      {results.length === 0 && <li className="ghost-hint">Nothing matches.</li>}
                      {results.map((hit) => (
                        <li key={hit.id}>
                          <button type="button" className="ghost-item" aria-current={detail?.entity.id === hit.id ? "true" : undefined} onClick={() => void openEntity(hit.id)}>
                            <span>{hit.title}</span>
                            <span className="ghost-meta">{TYPE_LABELS[hit.type]} · <time className="technical" dateTime={hit.timelineAt}>{shortDate(hit.timelineAt)}</time></span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <ol className="ghost-list" aria-label="Timeline, newest first">
                      {items.length === 0 && <li className="ghost-hint">Nothing on the timeline{types.length ? " for these types" : ""} yet.</li>}
                      {items.map((item) => (
                        <li key={`${item.kind}:${item.id}`}>
                          <button type="button" className="ghost-item" aria-current={detail?.entity.id === item.entityId ? "true" : undefined} onClick={() => void openEntity(item.entityId)}>
                            <span>{timelineLabel(item)}</span>
                            <span className="ghost-meta">
                              {timelineKind(item)} · <time className="technical" dateTime={item.at}>{shortDate(item.at)}</time> · {originLabel(item.origin, item.confidence)}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ol>
                  )}
                  {!results && more && <button type="button" disabled={busy} onClick={() => void loadTimeline(items[items.length - 1] ?? null, types)}>Show older</button>}
                </div>

                <div className="ghost-column">
                  {detail ? (
                    <EntityDetailPanel
                      detail={detail}
                      busy={busy}
                      search={async (text) => unwrap(await bridge.ghostOsSearch({ text }))}
                      picker={initial?.picker}
                      confirmForget={confirmForget}
                      onAskForget={setConfirmForget}
                      onForget={() => void forget()}
                      onOpen={(id) => void openEntity(id)}
                      onEdit={() => { setForm(formFromDetail(detail)); setTab("add"); }}
                      run={run}
                      reload={() => void openEntity(detail.entity.id)}
                    />
                  ) : (
                    <p className="ghost-hint">Choose an entry to see its connections, observations and where each fact came from.</p>
                  )}
                </div>
              </div>
            )}

            {tab === "add" && <EntityFormPanel form={form} setForm={setForm} busy={busy} onSubmit={(e) => void saveEntity(e)} />}

            {tab === "sources" && (
              <div className="ghost-sources">
                <section className="ghost-card" aria-labelledby="ghost-di-title">
                  <h3 id="ghost-di-title">Developer Intelligence</h3>
                  <p>When on, GhostOS reads Developer Intelligence's repository and technology records and its commit events: repositories become projects, languages and tools become skills, and commits become one observation per repository per day. It never reads commit messages, other event types, or any file.</p>
                  {!di?.installed ? (
                    <p className="ghost-hint">Developer Intelligence is not running, so there is nothing to turn on.</p>
                  ) : di.enabled ? (
                    <>
                      <p className="ghost-meta">
                        On · last sync {di.lastSyncAt ? <time className="technical" dateTime={di.lastSyncAt}>{shortDateTime(di.lastSyncAt)}</time> : "not yet"} ·{" "}
                        <span className="technical">{di.counts.entity}</span> entries, <span className="technical">{di.counts.relation}</span> connections, <span className="technical">{di.counts.observation}</span> observations
                      </p>
                      <div className="button-row">
                        <button type="button" disabled={busy} onClick={() => void run("ghost_os.adapter.sync")}>Sync now</button>
                        <button type="button" disabled={busy} onClick={() => void run("ghost_os.adapter.disable", { adapterId: "developer_intelligence" })} aria-describedby="ghost-di-off-note">
                          Turn off and remove what it added
                        </button>
                      </div>
                      <p id="ghost-di-off-note" className="ghost-hint">Turning it off deletes everything it contributed, including detected habits. Things you forgot stay forgotten.</p>
                    </>
                  ) : (
                    <button type="button" disabled={busy} onClick={() => void run("ghost_os.adapter.enable", { adapterId: "developer_intelligence" })}>Turn on</button>
                  )}
                  {status.lastError && <p className="ghost-notice--error" role="alert">Last sync failed: {status.lastError}</p>}
                </section>
                <section className="ghost-card" aria-labelledby="ghost-files-title">
                  <h3 id="ghost-files-title">Export and import</h3>
                  <p>Export saves everything GhostOS holds as one JSON file where you choose. Import merges an export back in; nothing already here is overwritten.</p>
                  <div className="button-row">
                    <button type="button" disabled={busy} onClick={() => void run("ghost_os.export")}>Export…</button>
                    <button type="button" disabled={busy} onClick={() => void run("ghost_os.import")}>Import…</button>
                  </div>
                  <p className="ghost-meta">Search: <span className="technical">{status.searchMode === "fts" ? "full-text" : "simple"}</span></p>
                </section>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function SourceLine({ provenance }: { provenance: EntityDetail["entity"]["provenance"] }) {
  return (
    <div className="ghost-source">
      <p className="ghost-meta">{sourceLabel(provenance)}</p>
      {provenance.origin !== "manual" && (
        <ul className="ghost-evidence" aria-label="Evidence">
          {provenance.evidence.slice(0, 20).map((e, i) => <li key={i} className="technical">{evidenceLabel(e)}</li>)}
          {provenance.evidence.length > 20 && <li className="ghost-hint">and {provenance.evidence.length - 20} more</li>}
        </ul>
      )}
    </div>
  );
}

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
        <button type="button" onClick={() => props.onChoose(null)} aria-label={`Change the entry, now ${props.chosen.title}`}>Change</button>
      </p>
    );
  }

  return (
    <div className="ghost-picker">
      <label htmlFor="ghost-rel-to">To</label>
      <input
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
  confirmForget: { kind: "entity" | "relation" | "observation"; id: string } | null;
  onAskForget(target: { kind: "entity" | "relation" | "observation"; id: string } | null): void;
  onForget(): void;
  onOpen(id: string): void;
  onEdit(): void;
  run(actionId: string, params?: Record<string, unknown>): Promise<boolean>;
  reload(): void;
}) {
  const { detail, busy, confirmForget } = props;
  const { entity } = detail;
  const d = entity.details as Record<string, unknown>;
  const [statement, setStatement] = useState("");
  const [relType, setRelType] = useState("related_to");
  const [relTo, setRelTo] = useState<PickerOption | null>(props.picker?.chosen ?? null);
  const [outcome, setOutcome] = useState("");

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
    if (await props.run("ghost_os.relation.save", { relation: { fromId: entity.id, toId: relTo.id, type: relType } })) {
      setRelTo(null);
      props.reload();
    }
  }
  async function recordOutcome(event: React.FormEvent) {
    event.preventDefault();
    if (await props.run("ghost_os.decision.record_outcome", { outcome: { id: entity.id, outcome } })) props.reload();
  }

  const confirming = confirmForget !== null;
  return (
    <article className="ghost-card ghost-detail" aria-labelledby="ghost-detail-title">
      <p className="ghost-meta">{TYPE_LABELS[entity.type]}</p>
      <h3 id="ghost-detail-title">{entity.title}</h3>
      <SourceLine provenance={entity.provenance} />
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

      <div className="button-row">
        {entity.provenance.origin === "manual" && <button type="button" disabled={busy} onClick={props.onEdit}>Edit</button>}
        <button type="button" disabled={busy} onClick={() => props.onAskForget({ kind: "entity", id: entity.id })} aria-label={`Forget ${entity.title}`}>Forget…</button>
      </div>
      {confirming && (
        <div className="ghost-confirm" role="alertdialog" aria-labelledby="ghost-confirm-text">
          <p id="ghost-confirm-text">Forget this {confirmForget.kind === "entity" ? "entry" : confirmForget.kind} and everything GhostOS derived from it? This cannot be undone, and a source cannot bring it back.</p>
          <div className="button-row">
            <button type="button" disabled={busy} onClick={props.onForget}>Forget</button>
            <button type="button" onClick={() => props.onAskForget(null)}>Cancel</button>
          </div>
        </div>
      )}

      {entity.type === "decision" && entity.provenance.origin === "manual" && typeof d.outcome !== "string" && (
        <form className="ghost-form" aria-label="Record the outcome" onSubmit={(e) => void recordOutcome(e)}>
          <label htmlFor="ghost-outcome">How did it turn out?</label>
          <textarea id="ghost-outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)} />
          <button type="submit" disabled={busy || !outcome.trim()}>Record outcome</button>
        </form>
      )}

      <h4>Connections</h4>
      {detail.relations.length === 0 ? <p className="ghost-hint">No connections.</p> : (
        <ul className="ghost-list">
          {detail.relations.map(({ relation, direction, other }) => (
            <li key={relation.id} className="ghost-row">
              <div>
                <p>
                  {direction === "out" ? `${relation.type.replace(/_/g, " ")} → ` : `← ${relation.type.replace(/_/g, " ")} `}
                  {other ? <button type="button" className="ghost-link" onClick={() => props.onOpen(other.id)}>{other.title}</button> : "a forgotten entry"}
                  {relation.validFrom && <> from <time className="technical" dateTime={relation.validFrom}>{shortDate(relation.validFrom)}</time></>}
                  {relation.validTo && <> until <time className="technical" dateTime={relation.validTo}>{shortDate(relation.validTo)}</time></>}
                </p>
                <SourceLine provenance={relation.provenance} />
              </div>
              <button type="button" disabled={busy} onClick={() => props.onAskForget({ kind: "relation", id: relation.id })} aria-label={`Forget connection ${relation.type} ${other?.title ?? ""}`.trim()}>Forget…</button>
            </li>
          ))}
        </ul>
      )}
      <form className="ghost-form ghost-form--inline" aria-label="New connection" onSubmit={(e) => void addRelation(e)}>
        <label htmlFor="ghost-rel-type">Connection</label>
        <input id="ghost-rel-type" list="ghost-rel-types" value={relType} onChange={(e) => setRelType(e.target.value)} />
        <datalist id="ghost-rel-types">{RELATION_TYPE_LIST.map((t) => <option key={t} value={t} />)}</datalist>
        <ConnectionPicker excludeId={entity.id} chosen={relTo} onChoose={setRelTo} search={props.search} initial={props.picker} />
        <button type="submit" disabled={busy || !relTo}>Connect</button>
      </form>

      <h4>Observations</h4>
      {detail.observations.length === 0 ? <p className="ghost-hint">No observations.</p> : (
        <ul className="ghost-list">
          {detail.observations.map((o: Observation) => (
            <li key={o.id} className="ghost-row">
              <div>
                <p><time className="technical" dateTime={o.observedAt}>{shortDate(o.observedAt)}</time> · {o.statement}</p>
                <SourceLine provenance={o.provenance} />
              </div>
              <button type="button" disabled={busy} onClick={() => props.onAskForget({ kind: "observation", id: o.id })} aria-label={`Forget observation from ${shortDate(o.observedAt)}`}>Forget…</button>
            </li>
          ))}
        </ul>
      )}
      <form className="ghost-form ghost-form--inline" aria-label="New observation" onSubmit={(e) => void addObservation(e)}>
        <label htmlFor="ghost-obs">Something you observed</label>
        <input id="ghost-obs" value={statement} onChange={(e) => setStatement(e.target.value)} />
        <button type="submit" disabled={busy || !statement.trim()}>Add</button>
      </form>

      {detail.derivedFrom.length > 0 && (
        <p className="ghost-meta">Derived from <span className="technical">{detail.derivedFrom.length}</span> record{detail.derivedFrom.length === 1 ? "" : "s"}; forgetting any of them removes this.</p>
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
      <select id="ghost-f-type" value={form.type} disabled={form.id !== null} onChange={(e) => set("type", e.target.value as EntityType)}>
        {ENTITY_TYPE_LIST.map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
      </select>
      <label htmlFor="ghost-f-title">Title</label>
      <input id="ghost-f-title" required value={form.title} onChange={(e) => set("title", e.target.value)} />
      {fields.includes("when") && (<><label htmlFor="ghost-f-when">{whenLabel(form.type)}</label><input id="ghost-f-when" type="date" value={form.when} onChange={(e) => set("when", e.target.value)} /></>)}
      {fields.includes("endedAt") && (<><label htmlFor="ghost-f-ended">Ended</label><input id="ghost-f-ended" type="date" value={form.endedAt} onChange={(e) => set("endedAt", e.target.value)} /></>)}
      {fields.includes("text") && (<><label htmlFor="ghost-f-text">{form.type === "conversation" ? "Paste the conversation" : "What happened"}</label><textarea id="ghost-f-text" value={form.text} onChange={(e) => set("text", e.target.value)} /></>)}
      {fields.includes("participants") && (<><label htmlFor="ghost-f-participants">Participants (comma separated)</label><input id="ghost-f-participants" value={form.participants} onChange={(e) => set("participants", e.target.value)} /></>)}
      {fields.includes("choice") && (<><label htmlFor="ghost-f-choice">What you chose</label><input id="ghost-f-choice" value={form.choice} onChange={(e) => set("choice", e.target.value)} /></>)}
      {fields.includes("alternatives") && (<><label htmlFor="ghost-f-alts">Alternatives (one per line)</label><textarea id="ghost-f-alts" value={form.alternatives} onChange={(e) => set("alternatives", e.target.value)} /></>)}
      {fields.includes("rationale") && (<><label htmlFor="ghost-f-why">Why</label><textarea id="ghost-f-why" value={form.rationale} onChange={(e) => set("rationale", e.target.value)} /></>)}
      {fields.includes("cadence") && (
        <>
          <label htmlFor="ghost-f-cadence">How often</label>
          <select id="ghost-f-cadence" value={form.cadence} onChange={(e) => set("cadence", e.target.value as EntityForm["cadence"])}>
            <option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="irregular">Irregular</option>
          </select>
        </>
      )}
      {fields.includes("path") && (<><label htmlFor="ghost-f-path">Path (a reference; GhostOS never opens it)</label><input id="ghost-f-path" className="technical" value={form.path} onChange={(e) => set("path", e.target.value)} /></>)}
      {fields.includes("label") && (<><label htmlFor="ghost-f-label">Label</label><input id="ghost-f-label" value={form.label} onChange={(e) => set("label", e.target.value)} /></>)}
      <label htmlFor="ghost-f-notes">Notes</label>
      <textarea id="ghost-f-notes" value={form.notes} onChange={(e) => set("notes", e.target.value)} />
      <label htmlFor="ghost-f-tags">Tags (comma separated)</label>
      <input id="ghost-f-tags" value={form.tags} onChange={(e) => set("tags", e.target.value)} />
      <p className="ghost-hint">Saved as entered by you.</p>
      <div className="button-row">
        <button type="submit" disabled={busy || !form.title.trim()}>{form.id ? "Save changes" : "Save"}</button>
        {form.id && <button type="button" onClick={() => setForm(EMPTY_ENTITY_FORM)}>Cancel edit</button>}
      </div>
    </form>
  );
}

