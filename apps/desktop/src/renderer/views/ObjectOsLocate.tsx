// Where things are, inside ObjectOS: what Finder used to do.
//
// Two small pieces the ObjectOS view places: the panel at the top of the page
// ("Where is my…", "What's in…", a five-second add, what was placed lately),
// and the card on an object that says where it is and lets it be moved, lent,
// returned, or marked missing. Every change is the object_os.object.locate
// action; nothing here writes on its own.

import React, { useEffect, useRef, useState } from "react";
import type { LocatedObject, Parsed } from "@dexnest/object-os";
import { MapPin, PackageSearch } from "lucide-react";
import { Button, TextInput } from "../components/ui/kit";
import { locateSummary, shortDate, whereLine, type LocateMode } from "./objectOsModel";

export interface ObjectOsLocateBridge {
  objectOsFind(query: string): Promise<Parsed<LocatedObject[]>>;
  objectOsWhatIsIn(place: string): Promise<Parsed<LocatedObject[]>>;
  objectOsRecentlyLocated(): Promise<LocatedObject[]>;
  objectOsRooms(): Promise<string[]>;
  objectOsWhereabouts(id: string): Promise<Parsed<LocatedObject>>;
}

type Run = (actionId: string, params?: Record<string, unknown>) => Promise<boolean>;

/** Tests only: start from known results instead of asking the bridge. */
export interface LocateInitial {
  mode?: LocateMode;
  query?: string;
  results?: LocatedObject[] | null;
  recent?: LocatedObject[];
  rooms?: string[];
}

export function LocatePanel(props: {
  bridge: ObjectOsLocateBridge;
  run: Run;
  busy: boolean;
  /** How many objects there are, so the panel can say so. */
  count: number;
  /** Changes whenever something was saved, so the lists are read again. */
  refreshKey: number;
  onOpen(id: string): void;
  initial?: LocateInitial;
}) {
  const { bridge, run, busy, initial } = props;
  const [mode, setMode] = useState<LocateMode>(initial?.mode ?? "item");
  const [query, setQuery] = useState(initial?.query ?? "");
  const [results, setResults] = useState<LocatedObject[] | null>(initial?.results ?? null);
  const [recent, setRecent] = useState<LocatedObject[]>(initial?.recent ?? []);
  const [rooms, setRooms] = useState<string[]>(initial?.rooms ?? []);
  const [add, setAdd] = useState({ name: "", location: "", room: "" });
  const ticket = useRef(0);

  useEffect(() => {
    if (initial) return;
    let live = true;
    Promise.all([bridge.objectOsRecentlyLocated(), bridge.objectOsRooms()])
      .then(([r, rm]) => {
        if (!live) return;
        setRecent(r);
        setRooms(rm);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [bridge, props.refreshKey, initial]);

  useEffect(() => {
    if (initial) return;
    const text = query.trim();
    if (!text) {
      setResults(null);
      return;
    }
    const mine = ++ticket.current;
    // A short pause so each keystroke does not ask.
    const timer = setTimeout(() => {
      (mode === "item" ? bridge.objectOsFind(text) : bridge.objectOsWhatIsIn(text))
        .then((found) => {
          if (ticket.current === mine) setResults(found.ok ? found.value : []);
        })
        .catch(() => {
          if (ticket.current === mine) setResults([]);
        });
    }, 200);
    return () => clearTimeout(timer);
  }, [bridge, query, mode, props.refreshKey, initial]);

  async function quickAdd(event: React.FormEvent) {
    event.preventDefault();
    const input = { name: add.name.trim(), location: add.location.trim(), ...(add.room.trim() ? { room: add.room.trim() } : {}) };
    if (await run("object_os.object.locate", { input })) setAdd({ name: "", location: "", room: "" });
  }

  const row = (o: LocatedObject) => (
    <li key={o.id}>
      <button type="button" className="objectos-item" onClick={() => props.onOpen(o.id)}>
        <span className="objectos-icon" aria-hidden="true"><MapPin /></span>
        <span className="objectos-item__text">
          <span>{o.name}</span>
          <span className="objectos-meta">{whereLine(o)}{o.whereabouts.locatedAt ? <> · placed <time className="technical" dateTime={o.whereabouts.locatedAt}>{shortDate(o.whereabouts.locatedAt)}</time></> : null}</span>
        </span>
      </button>
    </li>
  );

  return (
    <section className="objectos-card objectos-locate" aria-labelledby="objectos-locate-title">
      <div className="objectos-locate__head">
        <span className="objectos-icon" aria-hidden="true"><PackageSearch /></span>
        <h3 id="objectos-locate-title">Where is it?</h3>
        <p className="objectos-meta">{locateSummary(props.count, rooms.length)}</p>
      </div>

      <div className="objectos-locate__grid">
        <div className="objectos-locate__find">
          <div className="objectos-locate__modes" role="group" aria-label="What to look up">
            <button type="button" className="objectos-chip" aria-pressed={mode === "item"} onClick={() => setMode("item")}>Where is my…</button>
            <button type="button" className="objectos-chip" aria-pressed={mode === "place"} onClick={() => setMode("place")}>What's in…</button>
          </div>
          <TextInput
            id="objectos-locate-query"
            type="search"
            aria-label={mode === "item" ? "The thing you are looking for" : "The place, room or container"}
            value={query}
            placeholder={mode === "item" ? "passport, charger, drill…" : "black drawer, garage, camera bag…"}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div aria-live="polite">
            {results !== null && results.length === 0 && (
              <p className="objectos-hint">{mode === "item" ? `Nothing called “${query.trim()}” yet. Add it on the right, with where it is.` : `Nothing is recorded in “${query.trim()}”.`}</p>
            )}
            {results !== null && results.length > 0 && <ul className="objectos-list" aria-label={mode === "item" ? "Where it is" : "What is there"}>{results.slice(0, 8).map(row)}</ul>}
            {results !== null && results.length > 8 && <p className="objectos-hint">and {results.length - 8} more: type more words to narrow it.</p>}
          </div>
          {results === null && recent.length > 0 && (
            <>
              <p className="objectos-meta objectos-locate__label">Recently placed</p>
              <ul className="objectos-list" aria-label="Recently placed">{recent.slice(0, 4).map(row)}</ul>
            </>
          )}
          {results === null && rooms.length > 0 && (
            <div className="objectos-locate__rooms" role="group" aria-label="Rooms">
              {rooms.map((room) => (
                <button key={room} type="button" className="objectos-chip" onClick={() => { setMode("place"); setQuery(room); }}>{room}</button>
              ))}
            </div>
          )}
        </div>

        <form className="objectos-locate__add" aria-label="Remember where something is" onSubmit={(e) => void quickAdd(e)}>
          <p className="objectos-meta objectos-locate__label">Remember where something is</p>
          <label htmlFor="objectos-quick-name">What</label>
          <TextInput id="objectos-quick-name" value={add.name} placeholder="Passport" onChange={(e) => setAdd({ ...add, name: e.target.value })} />
          <label htmlFor="objectos-quick-where">Where</label>
          <TextInput id="objectos-quick-where" value={add.location} placeholder="black drawer" onChange={(e) => setAdd({ ...add, location: e.target.value })} />
          <label htmlFor="objectos-quick-room">Room (optional)</label>
          <TextInput id="objectos-quick-room" list="objectos-quick-rooms" value={add.room} placeholder="Bedroom" onChange={(e) => setAdd({ ...add, room: e.target.value })} />
          <datalist id="objectos-quick-rooms">{rooms.map((room) => <option key={room} value={room} />)}</datalist>
          <Button type="submit" variant="primary" disabled={busy || !add.name.trim()}>Remember</Button>
          <p className="objectos-hint">Saved as an object you can add to later: maintenance, a receipt, a warranty.</p>
        </form>
      </div>
    </section>
  );
}

/** Where one object is, and the four things that happen to a place: moved, lent, back, missing. */
export function WhereaboutsCard(props: {
  bridge: ObjectOsLocateBridge;
  objectId: string;
  /** Changes when the object was saved, so its place is read again. */
  refreshKey: string;
  run: Run;
  busy: boolean;
  initial?: LocatedObject | null;
}) {
  const { bridge, objectId, run, busy } = props;
  const [located, setLocated] = useState<LocatedObject | null>(props.initial ?? null);
  const [form, setForm] = useState<"none" | "move" | "lend">("none");
  const [move, setMove] = useState({ location: "", room: "", container: "" });
  const [lentTo, setLentTo] = useState("");

  useEffect(() => {
    if (props.initial !== undefined) return;
    let live = true;
    bridge
      .objectOsWhereabouts(objectId)
      .then((r) => {
        if (live) setLocated(r.ok ? r.value : null);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [bridge, objectId, props.refreshKey, props.initial]);

  if (!located) return null;
  const w = located.whereabouts;
  const lent = located.status === "lent_out";
  const locate = (input: Record<string, unknown>) => run("object_os.object.locate", { input: { objectId, ...input } });

  return (
    <section className="objectos-whereabouts" aria-label={`Where ${located.name} is`}>
      <p className="objectos-whereabouts__where">
        <span className="objectos-icon" aria-hidden="true"><MapPin /></span>
        <span>
          <strong>{whereLine(located)}</strong>
          {lent && w.lentAt ? <span className="objectos-meta"> · since <time className="technical" dateTime={w.lentAt}>{shortDate(w.lentAt)}</time></span> : null}
          {!lent && w.locatedAt ? <span className="objectos-meta"> · placed <time className="technical" dateTime={w.locatedAt}>{shortDate(w.locatedAt)}</time></span> : null}
        </span>
      </p>
      <div className="button-row">
        <Button size="sm" disabled={busy} aria-expanded={form === "move"} onClick={() => { setMove({ location: located.location, room: w.room, container: w.container }); setForm(form === "move" ? "none" : "move"); }}>I moved it</Button>
        {lent ? (
          <Button size="sm" disabled={busy} onClick={() => void locate({ returned: true })}>It's back</Button>
        ) : (
          <Button size="sm" disabled={busy} aria-expanded={form === "lend"} onClick={() => setForm(form === "lend" ? "none" : "lend")}>Lent to…</Button>
        )}
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void locate({ missing: !w.missing })}>{w.missing ? "Found it" : "Mark missing"}</Button>
      </div>
      {form === "move" && (
        <form className="objectos-whereabouts__form" aria-label="Where it is now" onSubmit={(e) => { e.preventDefault(); void locate({ location: move.location.trim(), room: move.room.trim(), container: move.container.trim() }).then((ok) => ok && setForm("none")); }}>
          <label htmlFor="objectos-move-where">Where</label>
          <TextInput id="objectos-move-where" value={move.location} onChange={(e) => setMove({ ...move, location: e.target.value })} />
          <label htmlFor="objectos-move-room">Room</label>
          <TextInput id="objectos-move-room" value={move.room} onChange={(e) => setMove({ ...move, room: e.target.value })} />
          <label htmlFor="objectos-move-container">In (drawer, box, shelf)</label>
          <TextInput id="objectos-move-container" value={move.container} onChange={(e) => setMove({ ...move, container: e.target.value })} />
          <Button type="submit" variant="primary" size="sm" disabled={busy}>Save where it is</Button>
        </form>
      )}
      {form === "lend" && (
        <form className="objectos-whereabouts__form" aria-label="Who has it" onSubmit={(e) => { e.preventDefault(); void locate({ lentTo: lentTo.trim() }).then((ok) => { if (ok) { setForm("none"); setLentTo(""); } }); }}>
          <label htmlFor="objectos-lent-to">Lent to</label>
          <TextInput id="objectos-lent-to" value={lentTo} placeholder="Alex" onChange={(e) => setLentTo(e.target.value)} />
          <Button type="submit" variant="primary" size="sm" disabled={busy || !lentTo.trim()}>Save</Button>
        </form>
      )}
    </section>
  );
}
