import React, { useCallback, useEffect, useState } from "react";
import type {
  AttentionItem,
  AttentionView,
  Category,
  ObjectDetail,
  ObjectOsStatus,
  ObjectRecord,
  Parsed,
  SettingsDiff,
  SettingsSnapshot,
  TimelineItem
} from "@dexnest/object-os";
import { AlertTriangle, Boxes, Car, Clock, Cpu, Package, PackageMinus, Printer, Refrigerator, ShieldAlert, Wrench } from "lucide-react";
import { Badge, Button, ConfirmDialog, EmptyNote, EmptyState, ErrorState, Field, InlineError, LoadingState, Notice, PageHeader, Select, StatGrid, StatTile, TabPanel, Tabs, TextArea, TextInput, accentStyle } from "../components/ui/kit";
import {
  deleteObjectConfirm,
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
  /** The question ("Delete Car?"). */
  title: string;
  /** What happens if the owner says yes. */
  detail: string;
  /** The button that does it; "Delete" unless said otherwise. */
  confirmLabel?: string;
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

/** Each category's mark, on list rows and the detail header. */
const CATEGORY_ICONS: Record<Category, React.ComponentType<{ className?: string }>> = {
  printer: Printer,
  computer: Cpu,
  appliance: Refrigerator,
  tool: Wrench,
  vehicle: Car,
  other: Package
};

function CategoryIcon({ category }: { category: Category }) {
  const Icon = CATEGORY_ICONS[category] ?? Package;
  return (
    <span className="objectos-icon" aria-hidden="true">
      <Icon />
    </span>
  );
}

/** What kind of attention an item needs, as a mark. */
function AttentionIcon({ item }: { item: AttentionItem }) {
  const Icon = item.kind === "maintenance" ? (item.status.state === "overdue" ? AlertTriangle : Clock) : item.kind === "warranty" ? ShieldAlert : PackageMinus;
  return (
    <span className="objectos-icon" aria-hidden="true">
      <Icon />
    </span>
  );
}
/** A schedule's due state as a badge; the words say it too, never colour alone. */
const DUE_BADGE = { bad: "error", warn: "warning", ok: "success", quiet: "neutral" } as const;
/** How many "needs attention" items show before "Show all". */
export const ATTENTION_PREVIEW = 5;

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
  const [showAllAttention, setShowAllAttention] = useState(false);

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

  /** The user opens another object: the last action's notice belongs to the old screen. */
  function showObject(id: string) {
    setNotice(null);
    void openObject(id);
  }

  function selectTab(next: Tab) {
    setNotice(null);
    setTab(next);
    if (next === "history" && detail) void loadHistory(detail.object.id, null).catch((e: unknown) => setNotice({ ok: false, text: errorText(e) }));
  }

  const state = viewState({ loading, error, status });
  const filtered = Boolean(search.trim() || filter.category || filter.status || filter.location);
  const headerActions =
    state.kind === "ready" || state.kind === "empty" ? (
      <>
        <Button variant="primary" disabled={busy} onClick={() => { setEditing(EMPTY_OBJECT_FORM); setDetail(null); }}>Add object</Button>
        {state.kind === "ready" && <Button disabled={busy} onClick={() => void run("object_os.export")}>Export all…</Button>}
        <Button disabled={busy} onClick={() => void run("object_os.import")}>Import…</Button>
      </>
    ) : undefined;

  return (
    <section className="view-stack objectos" style={accentStyle("object")} aria-labelledby="objectos-title" aria-busy={state.kind === "loading" || busy}>
      <PageHeader icon={<Package />} title="ObjectOS" titleId="objectos-title" subtitle="Your things, and everything about them" actions={headerActions} />
      <div className="objectos-live" aria-live="polite">
        {notice && (notice.ok ? <Notice>{notice.text}</Notice> : <InlineError>{notice.text}</InlineError>)}
      </div>

      {state.kind === "loading" && <LoadingState label="Loading ObjectOS" />}

      {state.kind === "error" && <ErrorState title="ObjectOS could not load" message={state.message} onRetry={() => void load()} />}

      {state.kind === "empty" && !editing && (
        <EmptyState
          icon={<Package />}
          title="Nothing in ObjectOS yet"
          actions={
            <>
              <Button variant="primary" disabled={busy} onClick={() => { setEditing(EMPTY_OBJECT_FORM); setDetail(null); }}>Add your first object</Button>
              <Button disabled={busy} onClick={() => void run("object_os.import")}>Import an export…</Button>
            </>
          }
        >
          <p>ObjectOS keeps one record for each thing you own: what it is, where it is, its maintenance, parts, settings, measurements, files and receipts, and everything that happened to it.</p>
          <p>Add your first object, or import an ObjectOS export. Everything stays on this computer; ObjectOS never reads Finance, Vault or any other module's data.</p>
        </EmptyState>
      )}

      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          confirmLabel={confirm.confirmLabel ?? "Delete"}
          busy={busy}
          accent="object"
          onConfirm={() => void confirmNow()}
          onCancel={() => setConfirm(null)}
        >
          {confirm.detail}
        </ConfirmDialog>
      )}

      {state.kind === "ready" && status && (
        <StatGrid columns={4}>
          <StatTile label="Objects" value={status.objects.toLocaleString("en")} icon={<Boxes />} hint={`${locations.length} location${locations.length === 1 ? "" : "s"}`} />
          <StatTile
            label="Maintenance due"
            value={String((attention?.summary.counts.overdue ?? 0) + (attention?.summary.counts.dueSoon ?? 0))}
            icon={<Wrench />}
            tone={(attention?.summary.counts.overdue ?? 0) > 0 ? "error" : "warning"}
            hint={(attention?.summary.counts.overdue ?? 0) > 0 ? `${attention?.summary.counts.overdue} overdue` : "none overdue"}
          />
          <StatTile label="Warranties ending" value={String(attention?.summary.counts.warrantyEnding ?? 0)} icon={<ShieldAlert />} tone="info" hint="in the next 30 days" />
          <StatTile label="Low on stock" value={String(attention?.summary.counts.lowStock ?? 0)} icon={<PackageMinus />} tone="warning" hint="parts to restock" />
        </StatGrid>
      )}

      {(state.kind === "ready" || state.kind === "empty") && status && (
        <div className="objectos-layout">
          {state.kind === "ready" && (
            <div className="objectos-column">
              {attention && (
                <section className="objectos-card" aria-labelledby="objectos-attention-title">
                  <h3 id="objectos-attention-title">Needs attention</h3>
                  <p className="objectos-meta">{attentionSummaryText(attention.summary.counts)}</p>
                  {attention.summary.items.length > 0 && (
                    <ul className="objectos-list" id="objectos-attention-list" aria-label="Needs attention">
                      {(showAllAttention ? attention.summary.items : attention.summary.items.slice(0, ATTENTION_PREVIEW)).map((item, i) => {
                        const line = attentionLabel(item, attention.names);
                        return (
                          <li key={i}>
                            {line.objectId ? (
                              <button type="button" className={`objectos-item objectos-tone-${line.tone}`} onClick={() => showObject(line.objectId as string)}>
                                <AttentionIcon item={item} />
                                <span className="objectos-item__text">
                                  <span>{line.title}</span>
                                  <span className="objectos-meta">{line.detail}</span>
                                </span>
                              </button>
                            ) : (
                              <p className={`objectos-item objectos-tone-${line.tone}`}>
                                <AttentionIcon item={item} />
                                <span className="objectos-item__text">
                                  <span>{line.title}</span>
                                  <span className="objectos-meta">{line.detail}</span>
                                </span>
                              </p>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {attention.summary.items.length > ATTENTION_PREVIEW && (
                    <button type="button" className="objectos-link" aria-expanded={showAllAttention} aria-controls="objectos-attention-list" onClick={() => setShowAllAttention(!showAllAttention)}>
                      {showAllAttention ? "Show the most urgent only" : `Show all ${attention.summary.items.length}`}
                    </button>
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
                <TextInput id="objectos-search-input" type="search" value={search} onChange={(e) => setSearch(e.target.value)} />
                <Button type="submit">Search</Button>
              </form>
              <div className="objectos-filters">
                <label>
                  Category
                  <Select value={filter.category} onChange={(e) => void applyFilter({ ...filter, category: e.target.value })}>
                    <option value="">All</option>
                    {CATEGORY_LIST.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
                  </Select>
                </label>
                <label>
                  Status
                  <Select value={filter.status} onChange={(e) => void applyFilter({ ...filter, status: e.target.value })}>
                    <option value="">All</option>
                    {STATUS_LIST.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                  </Select>
                </label>
                <label>
                  Location
                  <Select value={filter.location} onChange={(e) => void applyFilter({ ...filter, location: e.target.value })}>
                    <option value="">All</option>
                    {locations.map((l) => <option key={l} value={l}>{l}</option>)}
                  </Select>
                </label>
                {filtered && <Button variant="ghost" onClick={() => { setSearch(""); void applyFilter({ category: "", status: "", location: "" }, ""); }}>Clear</Button>}
              </div>

              <ul className="objectos-list" aria-label="Objects">
                {objects.length === 0 && <li className="objectos-hint">{filtered ? "No object matches." : "No objects yet."}</li>}
                {objects.map((o) => (
                  <li key={o.id}>
                    <button type="button" className="objectos-item" aria-current={detail?.object.id === o.id ? "true" : undefined} onClick={() => showObject(o.id)}>
                      <CategoryIcon category={o.category} />
                      <span className="objectos-item__text">
                        <span>{o.name}</span>
                        <span className="objectos-meta">
                          <Id id={o.id} /> · {CATEGORY_LABELS[o.category]} · {STATUS_LABELS[o.status]}{o.location ? ` · ${o.location}` : ""}
                        </span>
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
                {status.lastError && <InlineError>The last check failed: {status.lastError}</InlineError>}
                <Button disabled={busy} aria-pressed={status.remindersEnabled} onClick={() => void run(status.remindersEnabled ? "object_os.reminders.disable" : "object_os.reminders.enable")}>
                  {status.remindersEnabled ? "Turn off daily reminders" : "Turn on daily reminders"}
                </Button>
              </section>
            </div>
          )}

          <div className="objectos-column">
            {editing ? (
              <ObjectFormPanel form={editing} setForm={setEditing} objects={objects} locations={locations} busy={busy} onSubmit={(e) => void saveObject(e)} onCancel={() => setEditing(null)} />
            ) : detail ? (
              <section className="objectos-detail" aria-labelledby="objectos-detail-title">
                <div className="objectos-detail-head">
                  <CategoryIcon category={detail.object.category} />
                  <div className="objectos-detail-title">
                    <h3 id="objectos-detail-title">{detail.object.name}</h3>
                    <p className="objectos-meta">
                      <Id id={detail.object.id} /> · {CATEGORY_LABELS[detail.object.category]} · {STATUS_LABELS[detail.object.status]}
                    </p>
                  </div>
                  <div className="button-row">
                    <Button disabled={busy} onClick={() => setEditing(formFromObject(detail.object))}>Edit</Button>
                    <Select className="objectos-status-select" aria-label="Status" value={detail.object.status} disabled={busy} onChange={(e) => void run("object_os.object.set_status", { input: { id: detail.object.id, status: e.target.value } })}>
                      {STATUS_LIST.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                    </Select>
                    <Button disabled={busy} onClick={() => void run("object_os.export", { objectIds: [detail.object.id] })}>Export…</Button>
                    <Button
                      variant="danger"
                      disabled={busy}
                      onClick={() => ask({
                        actionId: "object_os.object.delete",
                        params: { input: { id: detail.object.id } },
                        ...deleteObjectConfirm(detail.object.name, detail.components.length)
                      })}>
                      Delete…
                    </Button>
                  </div>
                </div>

                <Tabs wrap label="Object sections" idPrefix="objectos" value={tab} onChange={selectTab} tabs={TABS.map((t) => ({ id: t, label: TAB_LABELS[t] }))} />

                <TabPanel idPrefix="objectos" id={tab} className="objectos-panel">
                  {tab === "overview" && <OverviewPanel detail={detail} photo={photo} busy={busy} run={run} onOpen={(id) => showObject(id)} />}
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
                      {moreHistory && <Button variant="ghost" disabled={busy} onClick={() => void loadHistory(detail.object.id, history[history.length - 1] ?? null)}>Show older</Button>}
                    </>
                  )}
                </TabPanel>
              </section>
            ) : state.kind === "ready" ? (
              <EmptyNote>Choose an object to see its maintenance, parts, settings, measurements, files, purchase and history.</EmptyNote>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}

// --- add and edit -----------------------------------------------------------------

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
      <Field htmlFor="objectos-f-name" label="Name (required)">
        <TextInput id="objectos-f-name" required maxLength={120} value={form.name} onChange={(e) => set("name", e.target.value)} />
      </Field>
      <div className="objectos-grid">
        <Field htmlFor="objectos-f-category" label="Category">
          <Select id="objectos-f-category" value={form.category} onChange={(e) => set("category", e.target.value as ObjectForm["category"])}>
            {CATEGORY_LIST.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
          </Select>
        </Field>
        <Field htmlFor="objectos-f-status" label="Status">
          <Select id="objectos-f-status" value={form.status} onChange={(e) => set("status", e.target.value as ObjectForm["status"])}>
            {STATUS_LIST.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
          </Select>
        </Field>
        <Field htmlFor="objectos-f-make" label="Make">
          <TextInput id="objectos-f-make" maxLength={120} value={form.make} onChange={(e) => set("make", e.target.value)} />
        </Field>
        <Field htmlFor="objectos-f-model" label="Model">
          <TextInput id="objectos-f-model" maxLength={120} value={form.model} onChange={(e) => set("model", e.target.value)} />
        </Field>
        <Field htmlFor="objectos-f-serial" label="Serial number">
          <TextInput id="objectos-f-serial" className="technical" maxLength={80} value={form.serial} onChange={(e) => set("serial", e.target.value)} />
        </Field>
        <Field htmlFor="objectos-f-location" label="Location">
          <TextInput id="objectos-f-location" list="objectos-locations" maxLength={120} value={form.location} onChange={(e) => set("location", e.target.value)} />
          <datalist id="objectos-locations">{props.locations.map((l) => <option key={l} value={l} />)}</datalist>
        </Field>
      </div>
      <Field htmlFor="objectos-f-parent" label="Part of">
        <Select id="objectos-f-parent" value={form.parentId} onChange={(e) => set("parentId", e.target.value)}>
          <option value="">Nothing (a whole object)</option>
          {props.objects.filter((o) => o.id !== form.id).map((o) => <option key={o.id} value={o.id}>{o.name} ({formatObjectId(o.id)})</option>)}
        </Select>
      </Field>
      <Field htmlFor="objectos-f-tags" label="Tags" hint="Separate with commas.">
        <TextInput id="objectos-f-tags" aria-describedby="objectos-f-tags-hint" value={form.tags} onChange={(e) => set("tags", e.target.value)} />
      </Field>
      <Field htmlFor="objectos-f-notes" label="Notes">
        <TextArea id="objectos-f-notes" rows={4} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
      </Field>
      <div className="button-row">
        <Button type="submit" variant="primary" disabled={props.busy || !form.name.trim()}>{form.id ? "Save changes" : "Add object"}</Button>
        <Button variant="ghost" onClick={props.onCancel}>Cancel</Button>
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
  title: `Delete ${what}?`,
  detail: "This cannot be undone."
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
                  <td><Button variant="ghost" size="sm" disabled={busy} onClick={() => void run("object_os.state.set", { input: { objectId: o.id, key: f.key, value: "" } })} aria-label={`Clear ${f.key}`}>Clear</Button></td>
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
          <Field htmlFor="objectos-state-key" label="What">
            <TextInput id="objectos-state-key" required maxLength={60} value={key} onChange={(e) => setKey(e.target.value)} list="objectos-state-keys" />
            <datalist id="objectos-state-keys">{detail.state.map((f) => <option key={f.key} value={f.key} />)}</datalist>
          </Field>
          <Field htmlFor="objectos-state-value" label="Value">
            <TextInput id="objectos-state-value" required maxLength={500} value={value} onChange={(e) => setValue(e.target.value)} />
          </Field>
          <Button type="submit" disabled={busy || !key.trim() || !value.trim()}>Set</Button>
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
                <Badge tone={DUE_BADGE[dueTone(status)]}>{dueLabel(status)}</Badge>
                <span className="button-row">
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => void run("object_os.schedule.save", { input: { id: schedule.id, objectId: o.id, title: schedule.title, rule: schedule.rule, startsAt: schedule.startsAt, startReading: schedule.startReading, notes: schedule.notes, active: !schedule.active } })}>
                    {schedule.active ? "Pause" : "Resume"}
                  </Button>
                  <Button variant="ghost" size="sm" disabled={busy} aria-label={`Delete schedule ${schedule.title}`} onClick={() => ask(recordDelete("schedule", schedule.id, `the schedule "${schedule.title}"`))}>Delete…</Button>
                </span>
              </li>
            ))}
          </ul>
        )}
        <form className="objectos-form" aria-label="Add a schedule" onSubmit={(e) => void addSchedule(e)}>
          <div className="objectos-grid">
            <Field htmlFor="objectos-s-title" label="Task">
              <TextInput id="objectos-s-title" required maxLength={200} value={sched.title} onChange={(e) => setSched({ ...sched, title: e.target.value })} />
            </Field>
            <Field htmlFor="objectos-s-kind" label="Repeats by">
              <Select id="objectos-s-kind" value={sched.kind} onChange={(e) => setSched({ ...sched, kind: e.target.value as "time" | "usage" })}>
                <option value="time">Time</option>
                <option value="usage">A counter</option>
              </Select>
            </Field>
            <Field htmlFor="objectos-s-every" label="Every">
              <TextInput id="objectos-s-every" className="technical" inputMode="decimal" required value={sched.every} onChange={(e) => setSched({ ...sched, every: e.target.value })} />
            </Field>
            {sched.kind === "time" ? (
              <Field htmlFor="objectos-s-unit" label="Unit">
                <Select id="objectos-s-unit" value={sched.unit} onChange={(e) => setSched({ ...sched, unit: e.target.value })}>
                  {UNIT_LIST.map((u) => <option key={u} value={u}>{u}</option>)}
                </Select>
              </Field>
            ) : (
              <Field htmlFor="objectos-s-key" label="Counter (a measurement)">
                <TextInput id="objectos-s-key" required list="objectos-measurement-keys" value={sched.measurementKey} onChange={(e) => setSched({ ...sched, measurementKey: e.target.value })} />
                <datalist id="objectos-measurement-keys">{keys.map((k) => <option key={k} value={k} />)}</datalist>
              </Field>
            )}
          </div>
          <Button type="submit" variant="primary" disabled={busy || !sched.title.trim()}>Add schedule</Button>
        </form>
      </section>

      <section aria-labelledby="objectos-log-title">
        <h4 id="objectos-log-title">Log</h4>
        <form className="objectos-form" aria-label="Log maintenance" onSubmit={(e) => void logIt(e)}>
          <div className="objectos-grid">
            <Field htmlFor="objectos-l-schedule" label="For schedule">
              <Select id="objectos-l-schedule" value={log.scheduleId} onChange={(e) => setLog({ ...log, scheduleId: e.target.value })}>
                <option value="">None (one-off)</option>
                {detail.schedules.map(({ schedule }) => <option key={schedule.id} value={schedule.id}>{schedule.title}</option>)}
              </Select>
            </Field>
            <Field htmlFor="objectos-l-title" label="What was done">
              <TextInput id="objectos-l-title" maxLength={200} value={log.title} onChange={(e) => setLog({ ...log, title: e.target.value })} placeholder={titleOf(log.scheduleId || null) ?? ""} />
            </Field>
            <Field htmlFor="objectos-l-date" label="Done on">
              <TextInput id="objectos-l-date" type="date" max={today} value={log.doneOn} onChange={(e) => setLog({ ...log, doneOn: e.target.value })} />
            </Field>
            <Field htmlFor="objectos-l-by" label="Done by">
              <TextInput id="objectos-l-by" maxLength={120} value={log.doneBy} onChange={(e) => setLog({ ...log, doneBy: e.target.value })} />
            </Field>
            <Field htmlFor="objectos-l-amount" label="Cost">
              <TextInput id="objectos-l-amount" className="technical" inputMode="decimal" value={log.amount} onChange={(e) => setLog({ ...log, amount: e.target.value })} />
            </Field>
            <Field htmlFor="objectos-l-currency" label="Currency">
              <TextInput id="objectos-l-currency" className="technical" maxLength={3} value={log.currency} onChange={(e) => setLog({ ...log, currency: e.target.value })} />
            </Field>
            <Field htmlFor="objectos-l-reading" label="Counter reading">
              <TextInput id="objectos-l-reading" className="technical" inputMode="decimal" value={log.usageReading} onChange={(e) => setLog({ ...log, usageReading: e.target.value })} />
            </Field>
            {detail.parts.length > 0 && (
              <>
                <Field htmlFor="objectos-l-part" label="Part used">
                  <Select id="objectos-l-part" value={log.partId} onChange={(e) => setLog({ ...log, partId: e.target.value })}>
                    <option value="">None</option>
                    {detail.parts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </Select>
                </Field>
                <Field htmlFor="objectos-l-qty" label="How many">
                  <TextInput id="objectos-l-qty" className="technical" inputMode="decimal" value={log.partQty} onChange={(e) => setLog({ ...log, partQty: e.target.value })} />
                </Field>
              </>
            )}
          </div>
          <Field htmlFor="objectos-l-notes" label="Notes">
            <TextArea id="objectos-l-notes" rows={2} value={log.notes} onChange={(e) => setLog({ ...log, notes: e.target.value })} />
          </Field>
          <Button type="submit" variant="primary" disabled={busy || !(log.title.trim() || log.scheduleId)}>Log it</Button>
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
                <Button variant="ghost" size="sm" disabled={busy} aria-label={`Delete log entry ${m.title}`} onClick={() => ask(recordDelete("maintenance", m.id, `the log entry "${m.title}"`))}>Delete…</Button>
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
                  <Field htmlFor={`objectos-p-delta-${p.id}`} label="Change by">
                    <TextInput id={`objectos-p-delta-${p.id}`} className="technical" inputMode="decimal" value={a.delta} onChange={(e) => setAdjust({ ...adjust, [p.id]: { ...a, delta: e.target.value } })} />
                  </Field>
                  <Field htmlFor={`objectos-p-reason-${p.id}`} label="Because">
                    <Select id={`objectos-p-reason-${p.id}`} value={a.reason} onChange={(e) => setAdjust({ ...adjust, [p.id]: { ...a, reason: e.target.value } })}>
                      <option value="restocked">Restocked</option>
                      <option value="used">Used</option>
                      <option value="corrected">Corrected a count</option>
                    </Select>
                  </Field>
                  <Button type="submit" size="sm" disabled={busy || !a.delta.trim()}>Update stock</Button>
                  <Button variant="ghost" size="sm" disabled={busy} aria-label={`Delete part ${p.name}`} onClick={() => ask(recordDelete("part", p.id, `the part "${p.name}" (from every object it fits)`))}>Delete…</Button>
                </form>
              </li>
            );
          })}
        </ul>
      )}
      <form className="objectos-form" aria-label="Add a part" onSubmit={(e) => void addPart(e)}>
        <h4>Add a part that fits this object</h4>
        <div className="objectos-grid">
          <Field htmlFor="objectos-np-name" label="Name">
            <TextInput id="objectos-np-name" required maxLength={120} value={part.name} onChange={(e) => setPart({ ...part, name: e.target.value })} />
          </Field>
          <Field htmlFor="objectos-np-number" label="Part number">
            <TextInput id="objectos-np-number" className="technical" maxLength={120} value={part.partNumber} onChange={(e) => setPart({ ...part, partNumber: e.target.value })} />
          </Field>
          <Field htmlFor="objectos-np-supplier" label="Supplier">
            <TextInput id="objectos-np-supplier" maxLength={120} value={part.supplier} onChange={(e) => setPart({ ...part, supplier: e.target.value })} />
          </Field>
          <Field htmlFor="objectos-np-unit" label="Unit">
            <TextInput id="objectos-np-unit" maxLength={20} value={part.unit} onChange={(e) => setPart({ ...part, unit: e.target.value })} />
          </Field>
          <Field htmlFor="objectos-np-qty" label="In stock">
            <TextInput id="objectos-np-qty" className="technical" inputMode="decimal" value={part.quantity} onChange={(e) => setPart({ ...part, quantity: e.target.value })} />
          </Field>
          <Field htmlFor="objectos-np-low" label="Restock at">
            <TextInput id="objectos-np-low" className="technical" inputMode="decimal" value={part.lowStockAt} onChange={(e) => setPart({ ...part, lowStockAt: e.target.value })} />
          </Field>
        </div>
        <Button type="submit" variant="primary" disabled={busy || !part.name.trim()}>Add part</Button>
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
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => void run("object_os.modification.save", { input: { id: m.id, objectId: o.id, title: m.title, doneAt: m.doneAt, reason: m.reason, before: m.before, after: m.after, reversible: true, revertedAt: new Date().toISOString() } })}>
                    Mark reverted
                  </Button>
                )}
                <Button variant="ghost" size="sm" disabled={busy} aria-label={`Delete modification ${m.title}`} onClick={() => ask(recordDelete("modification", m.id, `the modification "${m.title}"`))}>Delete…</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <form className="objectos-form" aria-label="Record a modification" onSubmit={(e) => void add(e)}>
        <h4>Record a modification</h4>
        <div className="objectos-grid">
          <Field htmlFor="objectos-m-title" label="What changed">
            <TextInput id="objectos-m-title" required maxLength={200} value={mod.title} onChange={(e) => setMod({ ...mod, title: e.target.value })} />
          </Field>
          <Field htmlFor="objectos-m-date" label="Done on">
            <TextInput id="objectos-m-date" type="date" max={today} value={mod.doneOn} onChange={(e) => setMod({ ...mod, doneOn: e.target.value })} />
          </Field>
        </div>
        <Field htmlFor="objectos-m-reason" label="Why">
          <TextArea id="objectos-m-reason" rows={2} value={mod.reason} onChange={(e) => setMod({ ...mod, reason: e.target.value })} />
        </Field>
        <div className="objectos-grid">
          <Field htmlFor="objectos-m-before" label="Before">
            <TextInput id="objectos-m-before" value={mod.before} onChange={(e) => setMod({ ...mod, before: e.target.value })} />
          </Field>
          <Field htmlFor="objectos-m-after" label="After">
            <TextInput id="objectos-m-after" value={mod.after} onChange={(e) => setMod({ ...mod, after: e.target.value })} />
          </Field>
        </div>
        <label className="objectos-check">
          <input type="checkbox" checked={mod.reversible} onChange={(e) => setMod({ ...mod, reversible: e.target.checked })} /> Can be undone
        </label>
        <Button type="submit" variant="primary" disabled={busy || !mod.title.trim()}>Record</Button>
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
                  <p className="objectos-version">
                    <span className="technical">v{v.version}</span> · <When at={v.createdAt} /> · {Object.keys(v.values).length} values{v.note ? ` · ${v.note}` : ""}
                  </p>
                  <span className="button-row">
                    <Button size="sm" aria-expanded={shown === v.id} onClick={() => setShown(shown === v.id ? null : v.id)}>{shown === v.id ? "Hide" : "Show"}</Button>
                    <Button size="sm" onClick={() => startFrom(v)}>Start from this</Button>
                    <Button variant="ghost" size="sm" disabled={busy} aria-label={`Delete version ${v.version} of ${g.name}`} onClick={() => ask(recordDelete("settings", v.id, `version ${v.version} of "${g.name}"`))}>Delete…</Button>
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
                  <Select value={comparing ? compare.from : ""} onChange={(e) => void diff(e.target.value, comparing ? compare.to : (g.versions[0]?.id ?? ""))}>
                    <option value="">Choose</option>
                    {g.versions.map((v) => <option key={v.id} value={v.id}>v{v.version}</option>)}
                  </Select>
                </label>
                <label>
                  To
                  <Select value={comparing ? compare.to : ""} onChange={(e) => void diff(comparing ? compare.from : (g.versions[g.versions.length - 1]?.id ?? ""), e.target.value)}>
                    <option value="">Choose</option>
                    {g.versions.map((v) => <option key={v.id} value={v.id}>v{v.version}</option>)}
                  </Select>
                </label>
              </div>
            )}
            {comparing && compare.error && <InlineError>{compare.error}</InlineError>}
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
        <Field htmlFor="objectos-set-name" label="Profile name" hint="Saving under an existing name adds a new version.">
          <TextInput id="objectos-set-name" aria-describedby="objectos-set-name-hint" required maxLength={120} list="objectos-settings-names" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <datalist id="objectos-settings-names">{groups.map((g) => <option key={g.name} value={g.name} />)}</datalist>
        </Field>
        <Field htmlFor="objectos-set-values" label="Values, one per line as key = value">
          <TextArea id="objectos-set-values" className="technical" rows={6} value={draft.text} aria-invalid={parsed.problems.length > 0} aria-describedby={parsed.problems.length ? "objectos-set-problems" : undefined} onChange={(e) => setDraft({ ...draft, text: e.target.value })} />
          {parsed.problems.length > 0 && <p id="objectos-set-problems" className="kit-inline-error">Line {parsed.problems.join(", ")} has no "key = value".</p>}
        </Field>
        <Field htmlFor="objectos-set-note" label="Note">
          <TextInput id="objectos-set-note" maxLength={200} value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
        </Field>
        <Button type="submit" variant="primary" disabled={busy || !draft.name.trim() || parsed.problems.length > 0 || Object.keys(parsed.values).length === 0}>Save version</Button>
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
                  <td><Button variant="ghost" size="sm" disabled={busy} aria-label={`Delete the ${g.key} reading of ${shortDate(r.measuredAt)}`} onClick={() => ask(recordDelete("measurement", r.id, `this ${g.key} reading`))}>Delete…</Button></td>
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
          <Field htmlFor="objectos-ms-key" label="What">
            <TextInput id="objectos-ms-key" required maxLength={60} list="objectos-ms-keys" value={m.key} onChange={(e) => setM({ ...m, key: e.target.value })} />
            <datalist id="objectos-ms-keys">{groups.map((g) => <option key={g.key} value={g.key} />)}</datalist>
          </Field>
          <Field htmlFor="objectos-ms-value" label="Value">
            <TextInput id="objectos-ms-value" className="technical" required inputMode="decimal" value={m.value} onChange={(e) => setM({ ...m, value: e.target.value })} />
          </Field>
          <Field htmlFor="objectos-ms-unit" label="Unit" hint={known ? `Recorded in ${known.unit || "no unit"}.` : undefined}>
            <TextInput id="objectos-ms-unit" maxLength={20} value={known ? known.unit : m.unit} disabled={Boolean(known)} aria-describedby={known ? "objectos-ms-unit-hint" : undefined} onChange={(e) => setM({ ...m, unit: e.target.value })} />
          </Field>
          <Field htmlFor="objectos-ms-date" label="Measured on">
            <TextInput id="objectos-ms-date" type="date" max={today} value={m.measuredOn} onChange={(e) => setM({ ...m, measuredOn: e.target.value })} />
          </Field>
        </div>
        <Field htmlFor="objectos-ms-note" label="Note">
          <TextInput id="objectos-ms-note" maxLength={200} value={m.note} onChange={(e) => setM({ ...m, note: e.target.value })} />
        </Field>
        <Button type="submit" variant="primary" disabled={busy || !m.key.trim() || !m.value.trim()}>Record</Button>
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
          <Select value={role} onChange={(e) => setRole(e.target.value)}>
            {ROLE_LIST.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </Select>
        </label>
        <Button disabled={busy} onClick={() => void run("object_os.file.attach", { objectId: o.id, role })}>Attach a file…</Button>
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
                    <Button size="sm" disabled={busy} aria-label={`Open ${f.name}`} onClick={() => void run("object_os.file.open", { fileId: f.id })}>Open</Button>
                    <Button variant="ghost" size="sm" disabled={busy} aria-label={`Remove ${f.name}`} onClick={() => ask({ actionId: "object_os.file.remove", params: { fileId: f.id }, title: `Remove ${f.name}?`, detail: "The copy in DexNest is deleted; the original, wherever it came from, is not touched.", confirmLabel: "Remove" })}>Remove…</Button>
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
          <Field htmlFor="objectos-pu-date" label="Bought on">
            <TextInput id="objectos-pu-date" type="date" value={form.purchasedOn} onChange={(e) => setForm({ ...form, purchasedOn: e.target.value })} />
          </Field>
          <Field htmlFor="objectos-pu-amount" label="Price">
            <TextInput id="objectos-pu-amount" className="technical" inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </Field>
          <Field htmlFor="objectos-pu-currency" label="Currency">
            <TextInput id="objectos-pu-currency" className="technical" maxLength={3} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} />
          </Field>
          <Field htmlFor="objectos-pu-shop" label="Shop">
            <TextInput id="objectos-pu-shop" maxLength={120} value={form.shop} onChange={(e) => setForm({ ...form, shop: e.target.value })} />
          </Field>
          <Field htmlFor="objectos-pu-warranty" label="Warranty until">
            <TextInput id="objectos-pu-warranty" type="date" value={form.warrantyUntil} onChange={(e) => setForm({ ...form, warrantyUntil: e.target.value })} />
          </Field>
        </div>
        <Button type="submit" variant="primary" disabled={busy}>{p ? "Save changes" : "Save purchase"}</Button>
      </form>
    </div>
  );
}
