// The thing a person says before letting it carry on.
//
// A run that stops overnight is read in the morning, and reading it almost
// always produces a sentence: "the error handling is the wrong shape", "don't
// touch the migration", "finish the tests before starting the UI". Until now
// there was nowhere to put that sentence. The choices were to edit the Run
// Spec — which is the wrong instrument, because the goal has not changed — or
// to type it into the agent's session by hand, which is the manual shuttling
// this whole thing exists to remove.
//
// So a note is its own kind of record: durable, attributed, timestamped, and
// folded into exactly one prompt.
//
// WHAT AUTHORITY IT HAS
//
// Less than the Run Spec, more than the agent's own plan for the next turn.
//
// It cannot change the goal, the constraints or the acceptance criteria. Those
// are human-owned and are edited deliberately, not by a sentence typed at
// breakfast — otherwise "what was this run actually asked to do" would have no
// answer, which is the question the whole journal exists to answer.
//
// It does outrank what the agent said it would do next, because the person
// writing it has just read that and decided otherwise. The rendered text says
// this in words rather than relying on position in the prompt.
//
// CONSUMED EXACTLY ONCE
//
// Same mechanism as an assignment and a consultant diagnosis:
// consumed_by_turn_id can only move away from NULL a single time. A note that
// re-appeared every turn would read as a standing instruction, and the person
// who wrote one sentence in the morning did not mean to bind every turn until
// midnight.

import type { RuntimePorts, SqlDatabase } from "./ports.ts";
import { AutopilotStore } from "./store.ts";

/** Long enough for a paragraph of direction, short of a pasted document. */
export const MAX_OPERATOR_NOTE_CHARS = 4000;

export interface OperatorNoteRecord {
  id: string;
  runId: string;
  text: string;
  /** Who wrote it. Free text: DexNest has no accounts. */
  author: string;
  createdAt: string;
  consumedTurnId: string | null;
}

interface OperatorNoteRow {
  id: string;
  run_id: string;
  text: string;
  author: string;
  created_at: string;
  consumed_by_turn_id: string | null;
}

const toNote = (row: OperatorNoteRow): OperatorNoteRecord => ({
  id: row.id,
  runId: row.run_id,
  text: row.text,
  author: row.author,
  createdAt: row.created_at,
  consumedTurnId: row.consumed_by_turn_id
});

export class OperatorNoteStore {
  private readonly ports: RuntimePorts;
  private readonly db: SqlDatabase;
  private readonly store: AutopilotStore;

  constructor(ports: RuntimePorts) {
    this.ports = ports;
    this.db = ports.db;
    this.store = new AutopilotStore(ports);
  }

  /** Older databases have no notes table; a run without one simply has none. */
  private available(): boolean {
    return Boolean(
      this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='autopilot_operator_notes'").get()
    );
  }

  list(runId: string): OperatorNoteRecord[] {
    if (!this.available()) return [];
    return this.db
      .prepare("SELECT * FROM autopilot_operator_notes WHERE run_id=:runId ORDER BY created_at, rowid")
      .all<OperatorNoteRow>({ runId })
      .map(toNote);
  }

  /**
   * The note waiting to reach a prompt.
   *
   * The most recent unconsumed one, not all of them: two notes written before
   * the same resume are a person correcting themselves, and the later sentence
   * is the one they meant. The earlier ones stay in the journal, unconsumed and
   * visible, rather than being deleted.
   */
  pending(runId: string): OperatorNoteRecord | null {
    if (!this.available()) return null;
    const row = this.db
      .prepare("SELECT * FROM autopilot_operator_notes WHERE run_id=:runId AND consumed_by_turn_id IS NULL ORDER BY rowid DESC LIMIT 1")
      .get<OperatorNoteRow>({ runId });
    return row ? toNote(row) : null;
  }

  add(input: { runId: string; text: string; author?: string }): OperatorNoteRecord {
    if (!this.available()) throw new Error("This database is too old to record notes.");
    const text = String(input.text ?? "").trim();
    if (!text) throw new Error("A note needs something in it.");
    if (text.length > MAX_OPERATOR_NOTE_CHARS) {
      throw new Error(`A note is at most ${MAX_OPERATOR_NOTE_CHARS} characters; this one is ${text.length}.`);
    }
    const author = String(input.author ?? "").trim() || "operator";

    return this.store.transaction(() => {
      const id = this.ports.ids.next("note");
      const now = this.ports.clock.now();
      this.db
        .prepare(
          `INSERT INTO autopilot_operator_notes (id, run_id, text, author, created_at)
           VALUES (:id, :runId, :text, :author, :now)`
        )
        .run({ id, runId: input.runId, text, author, now });
      // Journalled with its length rather than its content: the note itself is
      // already a durable row, and the event stream is read in places where a
      // paragraph of prose would drown the sequence it is there to show.
      this.store.appendEvent(input.runId, {
        type: "OPERATOR_NOTE_RECORDED",
        payload: { noteId: id, author, length: text.length }
      });
      return toNote(
        this.db.prepare("SELECT * FROM autopilot_operator_notes WHERE id=:id").get<OperatorNoteRow>({ id })!
      );
    });
  }

  /** Binds a note to the one turn that carried it. Never reversible. */
  consume(noteId: string, turnId: string): void {
    if (!this.available()) return;
    this.db
      .prepare("UPDATE autopilot_operator_notes SET consumed_by_turn_id=:turnId WHERE id=:id AND consumed_by_turn_id IS NULL")
      .run({ id: noteId, turnId });
  }
}

/**
 * How a note appears in the prompt.
 *
 * Attributed and dated, because "a human said this" is the whole reason it
 * carries more weight than the agent's own note to itself, and an unattributed
 * instruction is indistinguishable from one the agent wrote.
 */
export function renderOperatorNote(note: OperatorNoteRecord): string {
  return [
    "A NOTE FROM THE PERSON RUNNING THIS",
    "",
    `Written by ${note.author} at ${note.createdAt}, after reading what you had done:`,
    "",
    note.text.split("\n").map(line => `  ${line}`).join("\n"),
    "",
    "Act on this before anything else. It takes precedence over the next step",
    "you named for yourself. It does not change the goal, the constraints or",
    "the acceptance criteria above — those are still what bind you, and if the",
    "note seems to contradict them, say so rather than quietly picking one."
  ].join("\n");
}
