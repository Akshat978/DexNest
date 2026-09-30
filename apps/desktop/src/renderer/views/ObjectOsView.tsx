import React, { useCallback, useEffect, useRef, useState } from "react";
import type {
  AttentionView,
  ObjectDetail,
  ObjectOsStatus,
  ObjectRecord,
  Parsed,
  SettingsDiff,
  SettingsSnapshot,
  TimelineItem
} from "@dexnest/object-os";
import { PageHeader } from "../components/shared";
import {
  actionMessage,
  attentionLabel,
  attentionSummaryText,
  CATEGORY_LABELS,
  CATEGORY_LIST,
  dateToStamp,
  dueLabel,
  dueTone,
  EMPTY_OBJECT_FORM,
  fileSize,
  formatMoney,
  formatObjectId,
  formFromObject,
  LIST_LIMIT,
  localToday,
  measurementGroups,
  modificationLabel,
  moneyAmountText,
  nextTab,
  objectFromForm,
  overviewRows,
  parseSettingsText,
  ROLE_LABELS,
  ROLE_LIST,
  ruleLabel,
  settingsGroups,
  settingsText,
  shortDate,
  shortDateTime,
  STATUS_LABELS,
  STATUS_LIST,
  TAB_LABELS,
  TABS,
  TIMELINE_KIND_LABELS,
  timelineLabel,
  UNIT_LIST,
  viewState,
  warrantyLabel,
  type ObjectForm,
  type Tab
} from "./objectOsModel";
import "./ObjectOs.css";

/** The preload methods this view uses. Every change is an object_os.* action. */
export interface ObjectOsBridge {
  objectOsStatus(): Promise<ObjectOsStatus>;
  objectOsList(filter?: unknown): Promise<Parsed<ObjectRecord[]>>;
  objectOsDetail(id: string): Promise<Parsed<ObjectDetail>>;
  objectOsTimeline(query: unknown): Promise<Parsed<TimelineItem[]>>;
  objectOsAttention(): Promise<AttentionView>;
  objectOsSettingsDiff(query: unknown): Promise<Parsed<SettingsDiff>>;
  objectOsLocations(): Promise<string[]>;
  objectOsPhoto(fileId: string): Promise<string | null>;
}

/** A change that asks first: deleting an object, removing a file, deleting a record. */
export interface Confirm {
  actionId: string;
  params: Record<string, unknown>;
  question: string;
}

export interface ObjectOsViewProps {
  bridge: ObjectOsBridge;
  /** Runs a registered object_os.* action through the action registry. */
  onAction(actionId: string, params?: Record<string, unknown>): Promise<unknown>;
  /** Tests only: start from a known state instead of loading. */
  initial?: {
    status: ObjectOsStatus | null;
    objects?: ObjectRecord[];
    attention?: AttentionView | null;
    locations?: string[];
    detail?: ObjectDetail | null;
    tab?: Tab;
    error?: string | null;
    editing?: ObjectForm | null;
    confirm?: Confirm | null;
    history?: TimelineItem[];
    photo?: string | null;
    diff?: { from: string; to: string; diff: SettingsDiff } | null;
  };
}

type Run = (actionId: string, params?: Record<string, unknown>) => Promise<boolean>;
type Ask = (confirm: Confirm) => void;

const HISTORY_PAGE = 50;

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong.";
}

function unwrap<T>(r: Parsed<T>): T {
  if (!r.ok) throw new Error(r.errors.join("; "));
  return r.value;
}

const Id = ({ id }: { id: string }) => <span className="technical">{formatObjectId(id)}</span>;
const When = ({ at, withTime = false }: { at: string; withTime?: boolean }) => (
  <time className="technical" dateTime={at}>{withTime ? shortDateTime(at) : shortDate(at)}</time>
);

export function ObjectOsView({ bridge, onAction, initial }: ObjectOsViewProps) {
  const [status, setStatus] = useState<ObjectOsStatus | null>(initial?.status ?? null);
  const [objects, setObjects] = useState<ObjectRecord[]>(initial?.objects ?? []);
  const [attention, setAttention] = useState<AttentionView | null>(initial?.attention ?? null);
  const [locations, setLocations] = useState<string[]>(initial?.locations ?? []);
  const [detail, setDetail] = useState<ObjectDetail | null>(initial?.detail ?? null);
  const [photo, setPhoto] = useState<string | null>(initial?.photo ?? null);
  const [tab, setTab] = useState<Tab>(initial?.tab ?? "overview");
  const [editing, setEditing] = useState<ObjectForm | null>(initial?.editing ?? null);
  const [confirm, setConfirm] = useState<Confirm | null>(initial?.confirm ?? null);
  const [loading, setLoading] = useState(initial === undefined);
  const [error, setError] = useState<string | null>(initial?.error ?? null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<{ category: string; status: string; location: string }>({ category: "", status: "", location: "" });
  const [history, setHistory] = useState<TimelineItem[]>(initial?.history ?? []);
  const [moreHistory, setMoreHistory] = useState(false);
  const tabRefs = useRef(new Map<Tab, HTMLButtonElement>());

  const listFilter = useCallback(
    (text: string, f: typeof filter) => ({
      ...(text.trim() ? { search: text.trim() } : {}),
      ...(f.category ? { category: f.category } : {}),
      ...(f.status ? { status: f.status } : {}),
      ...(f.location ? { location: f.location } : {})
    }),
    []
  );

  const refreshLists = useCallback(
    async (text: string, f: typeof filter) => {
      const [s, list, att, locs] = await Promise.all([bridge.objectOsStatus(), bridge.objectOsList(listFilter(text, f)), bridge.objectOsAttention(), bridge.objectOsLocations()]);
      setStatus(s);
      setObjects(unwrap(list));
      setAttention(att);
      setLocations(locs);
    },
    [bridge, listFilter]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await refreshLists(search, filter);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }, [refreshLists, search, filter]);

  useEffect(() => {
    // Loads once on mount; filters and actions reload through their own handlers.
    if (initial === undefined) void load();
  }, []);

  const loadHistory = useCallback(
    async (objectId: string, after: TimelineItem | null) => {
      const page = unwrap(await bridge.objectOsTimeline({ objectId, limit: HISTORY_PAGE, before: after ? { at: after.at, refId: after.refId } : null }));
      setHistory((prev) => (after ? [...prev, ...page] : page));
      setMoreHistory(page.length === HISTORY_PAGE);
    },
    [bridge]
  );

  const openObject = useCallback(
    async (id: string, keepTab = false) => {
      try {
        const next = unwrap(await bridge.objectOsDetail(id));
        setDetail(next);
        setEditing(null);
        setConfirm(null);
        if (!keepTab) setTab("overview");
        setPhoto(next.object.photoFileId ? await bridge.objectOsPhoto(next.object.photoFileId) : null);
        if (keepTab && tab === "history") await loadHistory(id, null);
      } catch (e) {
        setNotice({ ok: false, text: errorText(e) });
      }
    },
    [bridge, loadHistory, tab]
  );

  const run: Run = useCallback(
    async (actionId, params = {}) => {
      setBusy(true);
      setNotice(null);
      try {
        const result = await onAction(actionId, params);
        const outcome = actionMessage(result);
        if (outcome.text) setNotice({ ok: outcome.ok, text: outcome.text });
        await refreshLists(search, filter);
        if (detail && actionId !== "object_os.object.delete") await openObject(detail.object.id, true);
        return outcome.ok;
      } catch (e) {
        setNotice({ ok: false, text: errorText(e) });
        return false;
      } finally {
        setBusy(false);
      }
    },
    [onAction, refreshLists, search, filter, detail, openObject]
  );

  const ask: Ask = (c) => setConfirm(c);

  async function confirmNow() {
    if (!confirm) return;
    const c = confirm;
    setConfirm(null);
    const ok = await run(c.actionId, { ...c.params, confirmedDangerous: true });
    if (ok && c.actionId === "object_os.object.delete") {
      setDetail(null);
      setPhoto(null);
    }
  }

  async function applyFilter(next: typeof filter, text = search) {
    setFilter(next);
    try {
      setObjects(unwrap(await bridge.objectOsList(listFilter(text, next))));
    } catch (e) {
      setNotice({ ok: false, text: errorText(e) });
    }
  }

  async function saveObject(event: React.FormEvent) {
    event.preventDefault();
    if (!editing) return;
    setBusy(true);
    setNotice(null);
    try {
      const result = await onAction("object_os.object.save", { input: objectFromForm(editing) });
      const outcome = actionMessage(result);
      if (outcome.text) setNotice({ ok: outcome.ok, text: outcome.text });
      if (!outcome.ok) return;
      const saved = (result as { value?: ObjectRecord }).value;
      await refreshLists(search, filter);
      setEditing(null);
      if (saved) await openObject(saved.id);
    } catch (e) {
      setNotice({ ok: false, text: errorText(e) });
    } finally {
      setBusy(false);
    }
  }

  function selectTab(next: Tab) {
    setTab(next);
    if (next === "history" && detail) void loadHistory(detail.object.id, null).catch((e: unknown) => setNotice({ ok: false, text: errorText(e) }));
  }

  function onTabKey(event: React.KeyboardEvent) {
    const next = nextTab(tab, event.key);
    if (!next) return;
    event.preventDefault();
    selectTab(next);
    tabRefs.current.get(next)?.focus();
  }

  const state = viewState({ loading, error, status });
  const filtered = Boolean(search.trim() || filter.category || filter.status || filter.location);
  const headerActions =
    state.kind === "ready" || state.kind === "empty" ? (
      <>
        <button type="button" disabled={busy} onClick={() => { setEditing(EMPTY_OBJECT_FORM); setDetail(null); }}>Add object</button>
        {state.kind === "ready" && <button type="button" disabled={busy} onClick={() => void run("object_os.export")}>Export all…</button>}
        <button type="button" disabled={busy} onClick={() => void run("object_os.import")}>Import…</button>
      </>
    ) : undefined;

  return (
    <section className="view-stack objectos" aria-labelledby="objectos-title" aria-busy={state.kind === "loading" || busy}>
      <PageHeader eyebrow="Your things, and everything about them" title="ObjectOS" titleId="objectos-title" actions={headerActions} />
      <div aria-live="polite">
        {notice && <p className={notice.ok ? "objectos-notice" : "objectos-notice objectos-notice--error"} role={notice.ok ? "status" : "alert"}>{notice.text}</p>}
      </div>

      {state.kind === "loading" && <p className="empty-state" role="status">Loading ObjectOS…</p>}

      {state.kind === "error" && (
        <div className="objectos-error" role="alert">
          <p>ObjectOS could not load: {state.message}</p>
          <button type="button" onClick={() => void load()}>Try again</button>
        </div>
      )}

      {state.kind === "empty" && !editing && (
        <div className="empty-state objectos-intro">
          <p>ObjectOS keeps one record for each thing you own: what it is, where it is, its maintenance, parts, settings, measurements, files and receipts, and everything that happened to it.</p>
          <p>Nothing is in it yet. Add your first object, or import an ObjectOS export. Everything stays on this computer; ObjectOS never reads Finance, Vault or any other module's data.</p>
        </div>
      )}

      {confirm && <ConfirmBox confirm={confirm} busy={busy} onConfirm={() => void confirmNow()} onCancel={() => setConfirm(null)} />}

      {(state.kind === "ready" || state.kind === "empty") && status && (
        <div className="objectos-layout">
          {state.kind === "ready" && (
            <div className="objectos-column">
              {attention && (
                <section className="objectos-card" aria-labelledby="objectos-attention-title">
                  <h3 id="objectos-attention-title">Needs attention</h3>
                  <p className="objectos-meta">{attentionSummaryText(attention.summary.counts)}</p>
                  {attention.summary.items.length > 0 && (
                    <ul className="objectos-list" aria-label="Needs attention">
                      {attention.summary.items.map((item, i) => {
                        const line = attentionLabel(item, attention.names);
                        return (
                          <li key={i}>
                            {line.objectId ? (
                              <button type="button" className={`objectos-item objectos-tone-${line.tone}`} onClick={() => void openObject(line.objectId as string)}>
                                <span>{line.title}</span>
                                <span className="objectos-meta">{line.detail}</span>
                              </button>
                            ) : (
                              <p className={`objectos-item objectos-tone-${line.tone}`}>
                                <span>{line.title}</span>
                                <span className="objectos-meta">{line.detail}</span>
                              </p>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
              )}

              <form
                className="objectos-search"
                role="search"
                aria-label="Search objects"
                onSubmit={(e) => { e.preventDefault(); void applyFilter(filter, search); }}
              >
                <label htmlFor="objectos-search-input">Search names, makes, models, serials and tags</label>
                <input id="objectos-search-input" type="search" value={search} onChange={(e) => setSearch(e.target.value)} />
                <button type="submit">Search</button>
              </form>
              <div className="objectos-filters">
                <label>
                  Category
                  <select value={filter.category} onChange={(e) => void applyFilter({ ...filter, category: e.target.value })}>
                    <option value="">All</option>
                    {CATEGORY_LIST.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
                  </select>
                </label>
                <label>
                  Status
                  <select value={filter.status} onChange={(e) => void applyFilter({ ...filter, status: e.target.value })}>
                    <option value="">All</option>
                    {STATUS_LIST.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                  </select>
                </label>
                <label>
                  Location
                  <select value={filter.location} onChange={(e) => void applyFilter({ ...filter, location: e.target.value })}>
                    <option value="">All</option>
                    {locations.map((l) => <option key={l} value={l}>{l}</option>)}
                  </select>
                </label>
                {filtered && <button type="button" onClick={() => { setSearch(""); void applyFilter({ category: "", status: "", location: "" }, ""); }}>Clear</button>}
              </div>

              <ul className="objectos-list" aria-label="Objects">
                {objects.length === 0 && <li className="objectos-hint">{filtered ? "No object matches." : "No objects yet."}</li>}
                {objects.map((o) => (
                  <li key={o.id}>
                    <button type="button" className="objectos-item" aria-current={detail?.object.id === o.id ? "true" : undefined} onClick={() => void openObject(o.id)}>
                      <span>{o.name}</span>
                      <span className="objectos-meta">
                        <Id id={o.id} /> · {CATEGORY_LABELS[o.category]} · {STATUS_LABELS[o.status]}{o.location ? ` · ${o.location}` : ""}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {objects.length >= LIST_LIMIT && <p className="objectos-hint" role="note">Showing the first {LIST_LIMIT} objects by name. Search or filter to find the others.</p>}

              <section className="objectos-card" aria-labelledby="objectos-reminders-title">
                <h3 id="objectos-reminders-title">Daily reminders</h3>
                <p className="objectos-meta">
                  {status.remindersEnabled ? "On." : "Off."} Once a day, a quiet notification with counts only: how many things are overdue, due soon, out of warranty soon or low on stock. Needs attention above is always up to date either way.
                </p>
                {status.lastReminder && <p className="objectos-meta">Last check <When at={status.lastReminder.startedAt} withTime /></p>}
                {status.lastError && <p className="objectos-notice--error" role="alert">The last check failed: {status.lastError}</p>}
                <button type="button" disabled={busy} aria-pressed={status.remindersEnabled} onClick={() => void run(status.remindersEnabled ? "object_os.reminders.disable" : "object_os.reminders.enable")}>
                  {status.remindersEnabled ? "Turn off daily reminders" : "Turn on daily reminders"}
                </button>
              </section>
            </div>
          )}

          <div className="objectos-column">
            {editing ? (
              <ObjectFormPanel form={editing} setForm={setEditing} objects={objects} locations={locations} busy={busy} onSubmit={(e) => void saveObject(e)} onCancel={() => setEditing(null)} />
            ) : detail ? (
              <section className="objectos-detail" aria-labelledby="objectos-detail-title">
                <div className="objectos-detail-head">
                  <div>
                    <h3 id="objectos-detail-title">{detail.object.name}</h3>
                    <p className="objectos-meta">
                      <Id id={detail.object.id} /> · {CATEGORY_LABELS[detail.object.category]} · {STATUS_LABELS[detail.object.status]}
                    </p>
                  </div>
                  <div className="button-row">
                    <button type="button" disabled={busy} onClick={() => setEditing(formFromObject(detail.object))}>Edit</button>
                    <label className="objectos-inline">
                      Status
                      <select value={detail.object.status} disabled={busy} onChange={(e) => void run("object_os.object.set_status", { input: { id: detail.object.id, status: e.target.value } })}>
                        {STATUS_LIST.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                      </select>
                    </label>
                    <button type="button" disabled={busy} onClick={() => void run("object_os.export", { objectIds: [detail.object.id] })}>Export…</button>
                    <button
                      type="button"
                      className="objectos-danger"
                      disabled={busy}
                      onClick={() => ask({
                        actionId: "object_os.object.delete",
                        params: { input: { id: detail.object.id } },
                        question: `Delete ${detail.object.name} with all its records and attached files? Its ${detail.components.length} component${detail.components.length === 1 ? "" : "s"} will be kept. This cannot be undone.`
                      })}
                    >
                      Delete…
                    </button>
                  </div>
                </div>

                <div className="objectos-tabs" role="tablist" aria-label="Object sections" onKeyDown={onTabKey}>
                  {TABS.map((t) => (
                    <button
                      key={t}
                      ref={(el) => { if (el) tabRefs.current.set(t, el); else tabRefs.current.delete(t); }}
                      type="button"
                      role="tab"
                      id={`objectos-tab-${t}`}
                      aria-selected={tab === t}
                      aria-controls={`objectos-panel-${t}`}
                      tabIndex={tab === t ? 0 : -1}
                      onClick={() => selectTab(t)}
                    >
                      {TAB_LABELS[t]}
                    </button>
                  ))}
                </div>

                <div role="tabpanel" id={`objectos-panel-${tab}`} aria-labelledby={`objectos-tab-${tab}`} className="objectos-panel" tabIndex={0}>
                  {tab === "overview" && <OverviewPanel detail={detail} photo={photo} busy={busy} run={run} onOpen={(id) => void openObject(id)} />}
                  {tab === "maintenance" && <MaintenancePanel detail={detail} busy={busy} run={run} ask={ask} />}
                  {tab === "parts" && <PartsPanel detail={detail} busy={busy} run={run} ask={ask} />}
                  {tab === "modifications" && <ModificationsPanel detail={detail} busy={busy} run={run} ask={ask} />}
                  {tab === "settings" && <SettingsPanel detail={detail} busy={busy} run={run} ask={ask} bridge={bridge} initialDiff={initial?.diff ?? null} />}
                  {tab === "measurements" && <MeasurementsPanel detail={detail} busy={busy} run={run} ask={ask} />}
                  {tab === "files" && <FilesPanel detail={detail} busy={busy} run={run} ask={ask} />}
                  {tab === "purchase" && <PurchasePanel detail={detail} busy={busy} run={run} />}
                  {tab === "history" && (
                    <>
                      <ol className="objectos-list" aria-label="History, newest first">
                        {history.length === 0 && <li className="objectos-hint">No history yet.</li>}
                        {history.map((item) => (
                          <li key={`${item.kind}:${item.refId}:${item.at}`} className="objectos-row">
                            <span>{timelineLabel(item)}</span>
                            <span className="objectos-meta">{TIMELINE_KIND_LABELS[item.kind]} · <When at={item.at} withTime /></span>
                          </li>
                        ))}
                      </ol>
                      {moreHistory && <button type="button" disabled={busy} onClick={() => void loadHistory(detail.object.id, history[history.length - 1] ?? null)}>Show older</button>}
                    </>
                  )}
                </div>
              </section>
            ) : state.kind === "ready" ? (
              <p className="objectos-hint">Choose an object to see its maintenance, parts, settings, measurements, files, purchase and history.</p>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}

// --- confirm ------------------------------------------------------------------

function ConfirmBox({ confirm, busy, onConfirm, onCancel }: { confirm: Confirm; busy: boolean; onConfirm(): void; onCancel(): void }) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    // The safe choice has focus: Enter on an unexpected dialog does nothing harmful.
    cancelRef.current?.focus();
  }, [confirm]);
  return (
    <div
      className="objectos-confirm"
      role="alertdialog"
      aria-labelledby="objectos-confirm-text"
      onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); onCancel(); } }}
    >
      <p id="objectos-confirm-text">{confirm.question}</p>
      <div className="button-row">
        <button type="button" className="objectos-danger" disabled={busy} onClick={onConfirm}>Delete</button>
        <button type="button" ref={cancelRef} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

// --- add and edit -----------------------------------------------------------------

function Field(props: { id: string; label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="objectos-field">
      <label htmlFor={props.id}>{props.label}</label>
      {props.children}
      {props.hint && <p className="objectos-hint" id={`${props.id}-hint`}>{props.hint}</p>}
    </div>
  );
}

function ObjectFormPanel(props: {
  form: ObjectForm;
  setForm(f: ObjectForm): void;
  objects: ObjectRecord[];
  locations: string[];
  busy: boolean;
  onSubmit(e: React.FormEvent): void;
  onCancel(): void;
}) {
  const { form, setForm } = props;
  const set = <K extends keyof ObjectForm>(key: K, value: ObjectForm[K]) => setForm({ ...form, [key]: value });
  return (
    <form className="objectos-form" aria-labelledby="objectos-form-title" onSubmit={props.onSubmit}>
      <h3 id="objectos-form-title">{form.id ? "Edit object" : "Add an object"}</h3>
      <Field id="objectos-f-name" label="Name">
        <input id="objectos-f-name" required maxLength={120} value={form.name} onChange={(e) => set("name", e.target.value)} />
      </Field>
      <div className="objectos-grid">
        <Field id="objectos-f-category" label="Category">
          <select id="objectos-f-category" value={form.category} onChange={(e) => set("category", e.target.value as ObjectForm["category"])}>
            {CATEGORY_LIST.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
          </select>
        </Field>
        <Field id="objectos-f-status" label="Status">
          <select id="objectos-f-status" value={form.status} onChange={(e) => set("status", e.target.value as ObjectForm["status"])}>
            {STATUS_LIST.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
          </select>
        </Field>
        <Field id="objectos-f-make" label="Make">
          <input id="objectos-f-make" maxLength={120} value={form.make} onChange={(e) => set("make", e.target.value)} />
        </Field>
        <Field id="objectos-f-model" label="Model">
          <input id="objectos-f-model" maxLength={120} value={form.model} onChange={(e) => set("model", e.target.value)} />
        </Field>
        <Field id="objectos-f-serial" label="Serial number">
          <input id="objectos-f-serial" className="technical" maxLength={80} value={form.serial} onChange={(e) => set("serial", e.target.value)} />
        </Field>
        <Field id="objectos-f-location" label="Location">
          <input id="objectos-f-location" list="objectos-locations" maxLength={120} value={form.location} onChange={(e) => set("location", e.target.value)} />
          <datalist id="objectos-locations">{props.locations.map((l) => <option key={l} value={l} />)}</datalist>
        </Field>
      </div>
      <Field id="objectos-f-parent" label="Part of">
        <select id="objectos-f-parent" value={form.parentId} onChange={(e) => set("parentId", e.target.value)}>
          <option value="">Nothing (a whole object)</option>
          {props.objects.filter((o) => o.id !== form.id).map((o) => <option key={o.id} value={o.id}>{o.name} ({formatObjectId(o.id)})</option>)}
        </select>
      </Field>
      <Field id="objectos-f-tags" label="Tags" hint="Separate with commas.">
        <input id="objectos-f-tags" aria-describedby="objectos-f-tags-hint" value={form.tags} onChange={(e) => set("tags", e.target.value)} />
      </Field>
      <Field id="objectos-f-notes" label="Notes">
        <textarea id="objectos-f-notes" rows={4} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
      </Field>
      <div className="button-row">
        <button type="submit" disabled={props.busy || !form.name.trim()}>{form.id ? "Save changes" : "Add object"}</button>
        <button type="button" onClick={props.onCancel}>Cancel</button>
      </div>
    </form>
  );
}

// --- panels ----------------------------------------------------------------------

interface PanelProps {
  detail: ObjectDetail;
  busy: boolean;
  run: Run;
  ask: Ask;
}

const recordDelete = (kind: string, id: string, what: string): Confirm => ({
  actionId: "object_os.record.delete",
  params: { kind, id },
  question: `Delete ${what}? This cannot be undone.`
});

function OverviewPanel({ detail, photo, busy, run, onOpen }: { detail: ObjectDetail; photo: string | null; busy: boolean; run: Run; onOpen(id: string): void }) {
  const o = detail.object;
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  return (
    <div className="objectos-stack">
      {photo && <img className="objectos-photo" src={photo} alt={`Photo of ${o.name}`} />}
      <dl className="objectos-facts">
        {overviewRows(o).map((row) => (
          <div key={row.label}>
            <dt>{row.label}</dt>
            <dd className={row.technical ? "technical" : undefined}>{row.value}</dd>
          </div>
        ))}
        {detail.parent && (
          <div>
            <dt>Part of</dt>
            <dd><button type="button" className="objectos-link" onClick={() => onOpen(detail.parent?.id as string)}>{detail.parent.name}</button></dd>
          </div>
        )}
        {o.tags.length > 0 && (
          <div>
            <dt>Tags</dt>
            <dd>{o.tags.join(", ")}</dd>
          </div>
        )}
        <div>
          <dt>Added</dt>
          <dd><When at={o.createdAt} /></dd>
        </div>
      </dl>
      {o.notes && <p className="objectos-notes">{o.notes}</p>}

      <section aria-labelledby="objectos-components-title">
        <h4 id="objectos-components-title">Components</h4>
        {detail.components.length === 0 ? (
          <p className="objectos-hint">No components. To add one, add an object and set "Part of" to this one.</p>
        ) : (
          <ul className="objectos-list">
            {detail.components.map((c) => (
              <li key={c.id}>
                <button type="button" className="objectos-item" onClick={() => onOpen(c.id)}>
                  <span>{c.name}</span>
                  <span className="objectos-meta"><Id id={c.id} /> · {STATUS_LABELS[c.status]}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="objectos-state-title">
        <h4 id="objectos-state-title">Current state</h4>
        {detail.state.length === 0 ? (
          <p className="objectos-hint">Nothing recorded, such as a firmware version or the filament loaded.</p>
        ) : (
          <table className="objectos-table">
            <thead><tr><th scope="col">What</th><th scope="col">Value</th><th scope="col">Updated</th><th scope="col"><span className="objectos-sr">Actions</span></th></tr></thead>
            <tbody>
              {detail.state.map((f) => (
                <tr key={f.key}>
                  <th scope="row">{f.key}</th>
                  <td>{f.value}</td>
                  <td><When at={f.updatedAt} /></td>
                  <td><button type="button" disabled={busy} onClick={() => void run("object_os.state.set", { input: { objectId: o.id, key: f.key, value: "" } })} aria-label={`Clear ${f.key}`}>Clear</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <form
          className="objectos-inline-form"
          aria-label="Set a state value"
          onSubmit={(e) => {
            e.preventDefault();
            void run("object_os.state.set", { input: { objectId: o.id, key, value } }).then((ok) => { if (ok) { setKey(""); setValue(""); } });
          }}
        >
          <Field id="objectos-state-key" label="What">
            <input id="objectos-state-key" required maxLength={60} value={key} onChange={(e) => setKey(e.target.value)} list="objectos-state-keys" />
            <datalist id="objectos-state-keys">{detail.state.map((f) => <option key={f.key} value={f.key} />)}</datalist>
          </Field>
          <Field id="objectos-state-value" label="Value">
            <input id="objectos-state-value" required maxLength={500} value={value} onChange={(e) => setValue(e.target.value)} />
          </Field>
          <button type="submit" disabled={busy || !key.trim() || !value.trim()}>Set</button>
        </form>
      </section>
    </div>
  );
}

function MaintenancePanel({ detail, busy, run, ask }: PanelProps) {
  const o = detail.object;
  const [sched, setSched] = useState({ title: "", kind: "time" as "time" | "usage", every: "6", unit: "months", measurementKey: "", notes: "" });
  const today = localToday(new Date());
  const [log, setLog] = useState({ title: "", scheduleId: "", doneOn: today, doneBy: "", amount: "", currency: "EUR", usageReading: "", partId: "", partQty: "1", notes: "" });
  const keys = [...new Set(detail.measurements.map((m) => m.key))].sort();
  const titleOf = (id: string | null) => detail.schedules.find((s) => s.schedule.id === id)?.schedule.title ?? null;

  async function addSchedule(e: React.FormEvent) {
    e.preventDefault();
    const rule = sched.kind === "time" ? { kind: "time", every: sched.every, unit: sched.unit } : { kind: "usage", every: sched.every, measurementKey: sched.measurementKey };
    if (await run("object_os.schedule.save", { input: { objectId: o.id, title: sched.title, rule, notes: sched.notes } })) setSched({ ...sched, title: "", notes: "" });
  }

  async function logIt(e: React.FormEvent) {
    e.preventDefault();
    const input = {
      objectId: o.id,
      title: log.title || titleOf(log.scheduleId || null) || "",
      scheduleId: log.scheduleId || null,
      doneAt: dateToStamp(log.doneOn, new Date()),
      doneBy: log.doneBy,
      cost: log.amount.trim() ? { amount: log.amount.trim(), currency: log.currency.trim().toUpperCase() } : null,
      usageReading: log.usageReading.trim() || null,
      parts: log.partId ? [{ partId: log.partId, quantity: log.partQty }] : [],
      notes: log.notes
    };
    if (await run("object_os.maintenance.log", { input })) setLog({ ...log, title: "", scheduleId: "", amount: "", usageReading: "", partId: "", partQty: "1", notes: "" });
  }

  return (
    <div className="objectos-stack">
      <section aria-labelledby="objectos-schedules-title">
        <h4 id="objectos-schedules-title">Schedules</h4>
        {detail.schedules.length === 0 ? (
          <p className="objectos-hint">No schedules. Add one by time (every 6 months) or by a counter (every 200 print hours).</p>
        ) : (
          <ul className="objectos-list">
            {detail.schedules.map(({ schedule, status }) => (
              <li key={schedule.id} className="objectos-row">
                <span>{schedule.title} <span className="objectos-meta">{ruleLabel(schedule.rule)}</span></span>
                <span className={`objectos-due objectos-tone-${dueTone(status)}`}>{dueLabel(status)}</span>
                <span className="button-row">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void run("object_os.schedule.save", { input: { id: schedule.id, objectId: o.id, title: schedule.title, rule: schedule.rule, startsAt: schedule.startsAt, startReading: schedule.startReading, notes: schedule.notes, active: !schedule.active } })}
                  >
                    {schedule.active ? "Pause" : "Resume"}
                  </button>
                  <button type="button" disabled={busy} aria-label={`Delete schedule ${schedule.title}`} onClick={() => ask(recordDelete("schedule", schedule.id, `the schedule "${schedule.title}"`))}>Delete…</button>
                </span>
              </li>
            ))}
          </ul>
        )}
        <form className="objectos-form" aria-label="Add a schedule" onSubmit={(e) => void addSchedule(e)}>
          <div className="objectos-grid">
            <Field id="objectos-s-title" label="Task">
              <input id="objectos-s-title" required maxLength={200} value={sched.title} onChange={(e) => setSched({ ...sched, title: e.target.value })} />
            </Field>
            <Field id="objectos-s-kind" label="Repeats by">
              <select id="objectos-s-kind" value={sched.kind} onChange={(e) => setSched({ ...sched, kind: e.target.value as "time" | "usage" })}>
                <option value="time">Time</option>
                <option value="usage">A counter</option>
              </select>
            </Field>
            <Field id="objectos-s-every" label="Every">
              <input id="objectos-s-every" className="technical" inputMode="decimal" required value={sched.every} onChange={(e) => setSched({ ...sched, every: e.target.value })} />
            </Field>
            {sched.kind === "time" ? (
              <Field id="objectos-s-unit" label="Unit">
                <select id="objectos-s-unit" value={sched.unit} onChange={(e) => setSched({ ...sched, unit: e.target.value })}>
                  {UNIT_LIST.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </Field>
            ) : (
              <Field id="objectos-s-key" label="Counter (a measurement)">
                <input id="objectos-s-key" required list="objectos-measurement-keys" value={sched.measurementKey} onChange={(e) => setSched({ ...sched, measurementKey: e.target.value })} />
                <datalist id="objectos-measurement-keys">{keys.map((k) => <option key={k} value={k} />)}</datalist>
              </Field>
            )}
          </div>
          <button type="submit" disabled={busy || !sched.title.trim()}>Add schedule</button>
        </form>
      </section>

      <section aria-labelledby="objectos-log-title">
        <h4 id="objectos-log-title">Log</h4>
        <form className="objectos-form" aria-label="Log maintenance" onSubmit={(e) => void logIt(e)}>
          <div className="objectos-grid">
            <Field id="objectos-l-schedule" label="For schedule">
              <select id="objectos-l-schedule" value={log.scheduleId} onChange={(e) => setLog({ ...log, scheduleId: e.target.value })}>
                <option value="">None (one-off)</option>
                {detail.schedules.map(({ schedule }) => <option key={schedule.id} value={schedule.id}>{schedule.title}</option>)}
              </select>
            </Field>
            <Field id="objectos-l-title" label="What was done">
              <input id="objectos-l-title" maxLength={200} value={log.title} onChange={(e) => setLog({ ...log, title: e.target.value })} placeholder={titleOf(log.scheduleId || null) ?? ""} />
            </Field>
            <Field id="objectos-l-date" label="Done on">
              <input id="objectos-l-date" type="date" max={today} value={log.doneOn} onChange={(e) => setLog({ ...log, doneOn: e.target.value })} />
            </Field>
            <Field id="objectos-l-by" label="Done by">
              <input id="objectos-l-by" maxLength={120} value={log.doneBy} onChange={(e) => setLog({ ...log, doneBy: e.target.value })} />
            </Field>
            <Field id="objectos-l-amount" label="Cost">
              <input id="objectos-l-amount" className="technical" inputMode="decimal" value={log.amount} onChange={(e) => setLog({ ...log, amount: e.target.value })} />
            </Field>
            <Field id="objectos-l-currency" label="Currency">
              <input id="objectos-l-currency" className="technical" maxLength={3} value={log.currency} onChange={(e) => setLog({ ...log, currency: e.target.value })} />
            </Field>
            <Field id="objectos-l-reading" label="Counter reading">
              <input id="objectos-l-reading" className="technical" inputMode="decimal" value={log.usageReading} onChange={(e) => setLog({ ...log, usageReading: e.target.value })} />
            </Field>
            {detail.parts.length > 0 && (
              <>
                <Field id="objectos-l-part" label="Part used">
                  <select id="objectos-l-part" value={log.partId} onChange={(e) => setLog({ ...log, partId: e.target.value })}>
                    <option value="">None</option>
                    {detail.parts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </Field>
                <Field id="objectos-l-qty" label="How many">
                  <input id="objectos-l-qty" className="technical" inputMode="decimal" value={log.partQty} onChange={(e) => setLog({ ...log, partQty: e.target.value })} />
                </Field>
              </>
            )}
          </div>
          <Field id="objectos-l-notes" label="Notes">
            <textarea id="objectos-l-notes" rows={2} value={log.notes} onChange={(e) => setLog({ ...log, notes: e.target.value })} />
          </Field>
          <button type="submit" disabled={busy || !(log.title.trim() || log.scheduleId)}>Log it</button>
        </form>
        {detail.maintenance.length === 0 ? (
          <p className="objectos-hint">Nothing logged yet.</p>
        ) : (
          <ul className="objectos-list" aria-label="Maintenance log, newest first">
            {detail.maintenance.map((m) => (
              <li key={m.id} className="objectos-row">
                <span>
                  {m.title}
                  <span className="objectos-meta">
                    {" "}<When at={m.doneAt} />{m.doneBy ? ` · ${m.doneBy}` : ""}{m.cost ? <> · <span className="technical">{formatMoney(m.cost)}</span></> : null}
                    {m.parts.length ? ` · ${m.parts.length} part${m.parts.length === 1 ? "" : "s"} used` : ""}
                  </span>
                  {m.notes && <span className="objectos-notes">{m.notes}</span>}
                </span>
                <button type="button" disabled={busy} aria-label={`Delete log entry ${m.title}`} onClick={() => ask(recordDelete("maintenance", m.id, `the log entry "${m.title}"`))}>Delete…</button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function PartsPanel({ detail, busy, run, ask }: PanelProps) {
  const o = detail.object;
  const [part, setPart] = useState({ name: "", partNumber: "", supplier: "", unit: "pcs", quantity: "0", lowStockAt: "", notes: "" });
  const [adjust, setAdjust] = useState<Record<string, { delta: string; reason: string }>>({});

  async function addPart(e: React.FormEvent) {
    e.preventDefault();
    const input = { ...part, lowStockAt: part.lowStockAt.trim() || null, fits: [o.id] };
    if (await run("object_os.part.save", { input })) setPart({ name: "", partNumber: "", supplier: "", unit: "pcs", quantity: "0", lowStockAt: "", notes: "" });
  }

  return (
    <div className="objectos-stack">
      {detail.parts.length === 0 ? (
        <p className="objectos-hint">No parts recorded for this object.</p>
      ) : (
        <ul className="objectos-list" aria-label="Parts that fit this object">
          {detail.parts.map((p) => {
            const a = adjust[p.id] ?? { delta: "", reason: "restocked" };
            const low = p.lowStockAt !== null && p.quantity <= p.lowStockAt;
            return (
              <li key={p.id} className="objectos-card">
                <p>
                  {p.name}
                  {p.partNumber && <> · <span className="technical">{p.partNumber}</span></>}
                  {p.supplier && <span className="objectos-meta"> · {p.supplier}</span>}
                </p>
                <p className={low ? "objectos-tone-warn" : "objectos-meta"}>
                  <span className="technical">{p.quantity}</span> {p.unit} in stock{p.lowStockAt !== null ? <> · restock at <span className="technical">{p.lowStockAt}</span></> : null}{low ? " · low" : ""}
                  {p.fits.length > 1 ? ` · fits ${p.fits.length} objects` : ""}
                </p>
                <form
                  className="objectos-inline-form"
                  aria-label={`Change stock of ${p.name}`}
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run("object_os.part.adjust_stock", { input: { partId: p.id, delta: a.delta, reason: a.reason } }).then((ok) => { if (ok) setAdjust({ ...adjust, [p.id]: { delta: "", reason: a.reason } }); });
                  }}
                >
                  <Field id={`objectos-p-delta-${p.id}`} label="Change by">
                    <input id={`objectos-p-delta-${p.id}`} className="technical" inputMode="decimal" value={a.delta} onChange={(e) => setAdjust({ ...adjust, [p.id]: { ...a, delta: e.target.value } })} />
                  </Field>
                  <Field id={`objectos-p-reason-${p.id}`} label="Because">
                    <select id={`objectos-p-reason-${p.id}`} value={a.reason} onChange={(e) => setAdjust({ ...adjust, [p.id]: { ...a, reason: e.target.value } })}>
                      <option value="restocked">Restocked</option>
                      <option value="used">Used</option>
                      <option value="corrected">Corrected a count</option>
                    </select>
                  </Field>
                  <button type="submit" disabled={busy || !a.delta.trim()}>Update stock</button>
                  <button type="button" disabled={busy} aria-label={`Delete part ${p.name}`} onClick={() => ask(recordDelete("part", p.id, `the part "${p.name}" (from every object it fits)`))}>Delete…</button>
                </form>
              </li>
            );
          })}
        </ul>
      )}
      <form className="objectos-form" aria-label="Add a part" onSubmit={(e) => void addPart(e)}>
        <h4>Add a part that fits this object</h4>
        <div className="objectos-grid">
          <Field id="objectos-np-name" label="Name">
            <input id="objectos-np-name" required maxLength={120} value={part.name} onChange={(e) => setPart({ ...part, name: e.target.value })} />
          </Field>
          <Field id="objectos-np-number" label="Part number">
            <input id="objectos-np-number" className="technical" maxLength={120} value={part.partNumber} onChange={(e) => setPart({ ...part, partNumber: e.target.value })} />
          </Field>
          <Field id="objectos-np-supplier" label="Supplier">
            <input id="objectos-np-supplier" maxLength={120} value={part.supplier} onChange={(e) => setPart({ ...part, supplier: e.target.value })} />
          </Field>
          <Field id="objectos-np-unit" label="Unit">
            <input id="objectos-np-unit" maxLength={20} value={part.unit} onChange={(e) => setPart({ ...part, unit: e.target.value })} />
          </Field>
          <Field id="objectos-np-qty" label="In stock">
            <input id="objectos-np-qty" className="technical" inputMode="decimal" value={part.quantity} onChange={(e) => setPart({ ...part, quantity: e.target.value })} />
          </Field>
          <Field id="objectos-np-low" label="Restock at">
            <input id="objectos-np-low" className="technical" inputMode="decimal" value={part.lowStockAt} onChange={(e) => setPart({ ...part, lowStockAt: e.target.value })} />
          </Field>
        </div>
        <button type="submit" disabled={busy || !part.name.trim()}>Add part</button>
      </form>
    </div>
  );
}

function ModificationsPanel({ detail, busy, run, ask }: PanelProps) {
  const o = detail.object;
  const today = localToday(new Date());
  const empty = { title: "", doneOn: today, reason: "", before: "", after: "", reversible: true };
  const [mod, setMod] = useState(empty);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const input = { objectId: o.id, title: mod.title, doneAt: dateToStamp(mod.doneOn, new Date()), reason: mod.reason, before: mod.before, after: mod.after, reversible: mod.reversible };
    if (await run("object_os.modification.save", { input })) setMod(empty);
  }

  return (
    <div className="objectos-stack">
      {detail.modifications.length === 0 ? (
        <p className="objectos-hint">No modifications recorded.</p>
      ) : (
        <ul className="objectos-list" aria-label="Modifications, newest first">
          {detail.modifications.map((m) => (
            <li key={m.id} className="objectos-card">
              <p>{m.title} <span className="objectos-meta">· <When at={m.doneAt} /> · {modificationLabel(m)}</span></p>
              {m.reason && <p className="objectos-notes">{m.reason}</p>}
              {(m.before || m.after) && (
                <dl className="objectos-facts">
                  {m.before && <div><dt>Before</dt><dd>{m.before}</dd></div>}
                  {m.after && <div><dt>After</dt><dd>{m.after}</dd></div>}
                </dl>
              )}
              <div className="button-row">
                {m.reversible && !m.revertedAt && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void run("object_os.modification.save", { input: { id: m.id, objectId: o.id, title: m.title, doneAt: m.doneAt, reason: m.reason, before: m.before, after: m.after, reversible: true, revertedAt: new Date().toISOString() } })}
                  >
                    Mark reverted
                  </button>
                )}
                <button type="button" disabled={busy} aria-label={`Delete modification ${m.title}`} onClick={() => ask(recordDelete("modification", m.id, `the modification "${m.title}"`))}>Delete…</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <form className="objectos-form" aria-label="Record a modification" onSubmit={(e) => void add(e)}>
        <h4>Record a modification</h4>
        <div className="objectos-grid">
          <Field id="objectos-m-title" label="What changed">
            <input id="objectos-m-title" required maxLength={200} value={mod.title} onChange={(e) => setMod({ ...mod, title: e.target.value })} />
          </Field>
          <Field id="objectos-m-date" label="Done on">
            <input id="objectos-m-date" type="date" max={today} value={mod.doneOn} onChange={(e) => setMod({ ...mod, doneOn: e.target.value })} />
          </Field>
        </div>
        <Field id="objectos-m-reason" label="Why">
          <textarea id="objectos-m-reason" rows={2} value={mod.reason} onChange={(e) => setMod({ ...mod, reason: e.target.value })} />
        </Field>
        <div className="objectos-grid">
          <Field id="objectos-m-before" label="Before">
            <input id="objectos-m-before" value={mod.before} onChange={(e) => setMod({ ...mod, before: e.target.value })} />
          </Field>
          <Field id="objectos-m-after" label="After">
            <input id="objectos-m-after" value={mod.after} onChange={(e) => setMod({ ...mod, after: e.target.value })} />
          </Field>
        </div>
        <label className="objectos-check">
          <input type="checkbox" checked={mod.reversible} onChange={(e) => setMod({ ...mod, reversible: e.target.checked })} /> Can be undone
        </label>
        <button type="submit" disabled={busy || !mod.title.trim()}>Record</button>
      </form>
    </div>
  );
}

function SettingsPanel({ detail, busy, run, ask, bridge, initialDiff }: PanelProps & { bridge: ObjectOsBridge; initialDiff: { from: string; to: string; diff: SettingsDiff } | null }) {
  const o = detail.object;
  const groups = settingsGroups(detail.settings);
  const [draft, setDraft] = useState({ name: "", text: "", note: "" });
  const [shown, setShown] = useState<string | null>(null);
  const [compare, setCompare] = useState<{ from: string; to: string; diff: SettingsDiff | null; error: string | null }>(
    initialDiff ? { ...initialDiff, error: null } : { from: "", to: "", diff: null, error: null }
  );
  const parsed = parseSettingsText(draft.text);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (parsed.problems.length) return;
    if (await run("object_os.settings.save", { input: { objectId: o.id, name: draft.name, values: parsed.values, note: draft.note } })) setDraft({ name: "", text: "", note: "" });
  }

  async function diff(from: string, to: string) {
    setCompare({ from, to, diff: null, error: null });
    if (!from || !to || from === to) return;
    try {
      setCompare({ from, to, diff: unwrap(await bridge.objectOsSettingsDiff({ objectId: o.id, from, to })), error: null });
    } catch (e) {
      setCompare({ from, to, diff: null, error: errorText(e) });
    }
  }

  const startFrom = (s: SettingsSnapshot) => setDraft({ name: s.name, text: settingsText(s.values), note: "" });

  return (
    <div className="objectos-stack">
      {groups.length === 0 && <p className="objectos-hint">No settings saved. Save a profile (slicer, BIOS, router…) and each change becomes a new version you can compare.</p>}
      {groups.map((g) => {
        const inGroup = new Set(g.versions.map((v) => v.id));
        const comparing = inGroup.has(compare.from) && inGroup.has(compare.to);
        return (
          <section key={g.name} className="objectos-card" aria-label={`Settings: ${g.name}`}>
            <h4>{g.name}</h4>
            <ul className="objectos-list">
              {g.versions.map((v) => (
                <li key={v.id} className="objectos-row">
                  <span>
                    <span className="technical">v{v.version}</span> · <When at={v.createdAt} /> · {Object.keys(v.values).length} values{v.note ? ` · ${v.note}` : ""}
                  </span>
                  <span className="button-row">
                    <button type="button" aria-expanded={shown === v.id} onClick={() => setShown(shown === v.id ? null : v.id)}>{shown === v.id ? "Hide" : "Show"}</button>
                    <button type="button" onClick={() => startFrom(v)}>Start from this</button>
                    <button type="button" disabled={busy} aria-label={`Delete version ${v.version} of ${g.name}`} onClick={() => ask(recordDelete("settings", v.id, `version ${v.version} of "${g.name}"`))}>Delete…</button>
                  </span>
                  {shown === v.id && (
                    <dl className="objectos-facts objectos-values">
                      {Object.keys(v.values).sort().map((k) => <div key={k}><dt className="technical">{k}</dt><dd className="technical">{v.values[k]}</dd></div>)}
                    </dl>
                  )}
                </li>
              ))}
            </ul>
            {g.versions.length > 1 && (
              <div className="objectos-inline-form" role="group" aria-label={`Compare versions of ${g.name}`}>
                <label>
                  From
                  <select value={comparing ? compare.from : ""} onChange={(e) => void diff(e.target.value, comparing ? compare.to : (g.versions[0]?.id ?? ""))}>
                    <option value="">Choose</option>
                    {g.versions.map((v) => <option key={v.id} value={v.id}>v{v.version}</option>)}
                  </select>
                </label>
                <label>
                  To
                  <select value={comparing ? compare.to : ""} onChange={(e) => void diff(comparing ? compare.from : (g.versions[g.versions.length - 1]?.id ?? ""), e.target.value)}>
                    <option value="">Choose</option>
                    {g.versions.map((v) => <option key={v.id} value={v.id}>v{v.version}</option>)}
                  </select>
                </label>
              </div>
            )}
            {comparing && compare.error && <p className="objectos-notice--error" role="alert">{compare.error}</p>}
            {comparing && compare.diff && (
              <div className="objectos-diff" aria-label="Differences">
                {compare.diff.added.length + compare.diff.removed.length + compare.diff.changed.length === 0 && <p className="objectos-hint">No differences.</p>}
                <ul className="objectos-list">
                  {compare.diff.changed.map((c) => <li key={`c:${c.key}`} className="technical">~ {c.key}: {c.from} → {c.to}</li>)}
                  {compare.diff.added.map((c) => <li key={`a:${c.key}`} className="technical">+ {c.key} = {c.value}</li>)}
                  {compare.diff.removed.map((c) => <li key={`r:${c.key}`} className="technical">- {c.key} = {c.value}</li>)}
                </ul>
                <p className="objectos-meta">{compare.diff.unchanged} unchanged</p>
              </div>
            )}
          </section>
        );
      })}
      <form className="objectos-form" aria-label="Save settings" onSubmit={(e) => void save(e)}>
        <h4>Save settings</h4>
        <Field id="objectos-set-name" label="Profile name" hint="Saving under an existing name adds a new version.">
          <input id="objectos-set-name" aria-describedby="objectos-set-name-hint" required maxLength={120} list="objectos-settings-names" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <datalist id="objectos-settings-names">{groups.map((g) => <option key={g.name} value={g.name} />)}</datalist>
        </Field>
        <Field id="objectos-set-values" label="Values, one per line as key = value">
          <textarea id="objectos-set-values" className="technical" rows={6} value={draft.text} aria-invalid={parsed.problems.length > 0} aria-describedby={parsed.problems.length ? "objectos-set-problems" : undefined} onChange={(e) => setDraft({ ...draft, text: e.target.value })} />
          {parsed.problems.length > 0 && <p id="objectos-set-problems" className="objectos-notice--error">Line {parsed.problems.join(", ")} has no "key = value".</p>}
        </Field>
        <Field id="objectos-set-note" label="Note">
          <input id="objectos-set-note" maxLength={200} value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
        </Field>
        <button type="submit" disabled={busy || !draft.name.trim() || parsed.problems.length > 0 || Object.keys(parsed.values).length === 0}>Save version</button>
      </form>
    </div>
  );
}

function MeasurementsPanel({ detail, busy, run, ask }: PanelProps) {
  const o = detail.object;
  const today = localToday(new Date());
  const groups = measurementGroups(detail);
  const [m, setM] = useState({ key: "", value: "", unit: "", measuredOn: today, note: "" });
  const known = groups.find((g) => g.key === m.key.trim());

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const input = { objectId: o.id, key: m.key, value: m.value, unit: known ? known.unit : m.unit, measuredAt: dateToStamp(m.measuredOn, new Date()), note: m.note };
    if (await run("object_os.measurement.add", { input })) setM({ ...m, value: "", note: "" });
  }

  return (
    <div className="objectos-stack">
      {groups.length === 0 && <p className="objectos-hint">No measurements. Record readings such as print hours, mileage or tyre pressure; counters can drive maintenance.</p>}
      {groups.map((g) => (
        <section key={g.key} className="objectos-card" aria-label={`Measurements: ${g.key}`}>
          <h4>{g.key} <span className="objectos-meta">latest <span className="technical">{g.readings[0]?.value}</span> {g.unit}</span></h4>
          <table className="objectos-table">
            <thead><tr><th scope="col">Date</th><th scope="col">Value</th><th scope="col">Note</th><th scope="col"><span className="objectos-sr">Actions</span></th></tr></thead>
            <tbody>
              {g.readings.slice(0, 50).map((r) => (
                <tr key={r.id}>
                  <td><When at={r.measuredAt} /></td>
                  <td className="technical">{r.value} {r.unit}</td>
                  <td>{r.note}</td>
                  <td><button type="button" disabled={busy} aria-label={`Delete the ${g.key} reading of ${shortDate(r.measuredAt)}`} onClick={() => ask(recordDelete("measurement", r.id, `this ${g.key} reading`))}>Delete…</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {g.readings.length > 50 && <p className="objectos-hint">Showing the newest 50 of {g.readings.length}.</p>}
        </section>
      ))}
      <form className="objectos-form" aria-label="Record a measurement" onSubmit={(e) => void add(e)}>
        <h4>Record a measurement</h4>
        <div className="objectos-grid">
          <Field id="objectos-ms-key" label="What">
            <input id="objectos-ms-key" required maxLength={60} list="objectos-ms-keys" value={m.key} onChange={(e) => setM({ ...m, key: e.target.value })} />
            <datalist id="objectos-ms-keys">{groups.map((g) => <option key={g.key} value={g.key} />)}</datalist>
          </Field>
          <Field id="objectos-ms-value" label="Value">
            <input id="objectos-ms-value" className="technical" required inputMode="decimal" value={m.value} onChange={(e) => setM({ ...m, value: e.target.value })} />
          </Field>
          <Field id="objectos-ms-unit" label="Unit" hint={known ? `Recorded in ${known.unit || "no unit"}.` : undefined}>
            <input id="objectos-ms-unit" maxLength={20} value={known ? known.unit : m.unit} disabled={Boolean(known)} aria-describedby={known ? "objectos-ms-unit-hint" : undefined} onChange={(e) => setM({ ...m, unit: e.target.value })} />
          </Field>
          <Field id="objectos-ms-date" label="Measured on">
            <input id="objectos-ms-date" type="date" max={today} value={m.measuredOn} onChange={(e) => setM({ ...m, measuredOn: e.target.value })} />
          </Field>
        </div>
        <Field id="objectos-ms-note" label="Note">
          <input id="objectos-ms-note" maxLength={200} value={m.note} onChange={(e) => setM({ ...m, note: e.target.value })} />
        </Field>
        <button type="submit" disabled={busy || !m.key.trim() || !m.value.trim()}>Record</button>
      </form>
    </div>
  );
}

function FilesPanel({ detail, busy, run, ask }: PanelProps) {
  const o = detail.object;
  const [role, setRole] = useState<string>("manual");
  return (
    <div className="objectos-stack">
      <div className="objectos-inline-form" role="group" aria-label="Attach a file">
        <label>
          Attach as
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            {ROLE_LIST.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>
        </label>
        <button type="button" disabled={busy} onClick={() => void run("object_os.file.attach", { objectId: o.id, role })}>Attach a file…</button>
      </div>
      <p className="objectos-hint">Files are copied into DexNest's data folder for this object (up to 200 MB each) and never run. Files that could run a program are shown in their folder instead of opened.</p>
      {detail.files.length === 0 ? (
        <p className="objectos-hint">No files attached.</p>
      ) : (
        <table className="objectos-table">
          <thead><tr><th scope="col">Name</th><th scope="col">Kind</th><th scope="col">Size</th><th scope="col">Added</th><th scope="col"><span className="objectos-sr">Actions</span></th></tr></thead>
          <tbody>
            {detail.files.map((f) => (
              <tr key={f.id}>
                <th scope="row">{f.name}{o.photoFileId === f.id ? " (photo)" : ""}{detail.purchase?.receiptFileId === f.id ? " (receipt)" : ""}</th>
                <td>{ROLE_LABELS[f.role]} <span className="objectos-meta">{f.type}</span></td>
                <td className="technical">{fileSize(f.sizeBytes)}</td>
                <td><When at={f.addedAt} /></td>
                <td>
                  <span className="button-row">
                    <button type="button" disabled={busy} aria-label={`Open ${f.name}`} onClick={() => void run("object_os.file.open", { fileId: f.id })}>Open</button>
                    <button type="button" disabled={busy} aria-label={`Remove ${f.name}`} onClick={() => ask({ actionId: "object_os.file.remove", params: { fileId: f.id }, question: `Remove ${f.name}? The copy in DexNest is deleted; the original, wherever it came from, is not touched.` })}>Remove…</button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function PurchasePanel({ detail, busy, run }: { detail: ObjectDetail; busy: boolean; run: Run }) {
  const o = detail.object;
  const p = detail.purchase;
  const [form, setForm] = useState({
    purchasedOn: p?.purchasedOn ?? "",
    amount: moneyAmountText(p?.price ?? null),
    currency: p?.price?.currency ?? "EUR",
    shop: p?.shop ?? "",
    warrantyUntil: p?.warrantyUntil ?? ""
  });
  const receipt = p?.receiptFileId ? detail.files.find((f) => f.id === p.receiptFileId) : undefined;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const input = {
      objectId: o.id,
      purchasedOn: form.purchasedOn || null,
      price: form.amount.trim() ? { amount: form.amount.trim(), currency: form.currency.trim().toUpperCase() } : null,
      shop: form.shop,
      warrantyUntil: form.warrantyUntil || null
    };
    await run("object_os.purchase.save", { input });
  }

  return (
    <div className="objectos-stack">
      <p className={detail.warranty.state === "ending" || detail.warranty.state === "expired" ? "objectos-tone-warn" : "objectos-meta"}>{warrantyLabel(detail.warranty)}</p>
      {p && (
        <dl className="objectos-facts">
          {p.purchasedOn && <div><dt>Bought</dt><dd className="technical">{p.purchasedOn}</dd></div>}
          {p.price && <div><dt>Price</dt><dd className="technical">{formatMoney(p.price)}</dd></div>}
          {p.shop && <div><dt>Shop</dt><dd>{p.shop}</dd></div>}
          {p.warrantyUntil && <div><dt>Warranty until</dt><dd className="technical">{p.warrantyUntil}</dd></div>}
          <div>
            <dt>Receipt</dt>
            <dd>
              {receipt ? (
                <button type="button" className="objectos-link" disabled={busy} onClick={() => void run("object_os.file.open", { fileId: receipt.id })}>{receipt.name}</button>
              ) : (
                <button type="button" className="objectos-link" disabled={busy} onClick={() => void run("object_os.file.attach", { objectId: o.id, role: "receipt" })}>Attach a receipt…</button>
              )}
            </dd>
          </div>
        </dl>
      )}
      <form className="objectos-form" aria-label="Purchase and warranty" onSubmit={(e) => void save(e)}>
        <div className="objectos-grid">
          <Field id="objectos-pu-date" label="Bought on">
            <input id="objectos-pu-date" type="date" value={form.purchasedOn} onChange={(e) => setForm({ ...form, purchasedOn: e.target.value })} />
          </Field>
          <Field id="objectos-pu-amount" label="Price">
            <input id="objectos-pu-amount" className="technical" inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </Field>
          <Field id="objectos-pu-currency" label="Currency">
            <input id="objectos-pu-currency" className="technical" maxLength={3} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} />
          </Field>
          <Field id="objectos-pu-shop" label="Shop">
            <input id="objectos-pu-shop" maxLength={120} value={form.shop} onChange={(e) => setForm({ ...form, shop: e.target.value })} />
          </Field>
          <Field id="objectos-pu-warranty" label="Warranty until">
            <input id="objectos-pu-warranty" type="date" value={form.warrantyUntil} onChange={(e) => setForm({ ...form, warrantyUntil: e.target.value })} />
          </Field>
        </div>
        <button type="submit" disabled={busy}>{p ? "Save changes" : "Save purchase"}</button>
      </form>
    </div>
  );
}
