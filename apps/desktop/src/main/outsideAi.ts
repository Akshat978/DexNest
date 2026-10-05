// Outside AI: the one place, besides Autopilot, where DexNest may ask a service
// on the internet for help. See the "Outside AI" section of AGENTS.md.
//
// What it does today, each behind its own switch:
//
//  - Commands. When the local rules cannot tell what a command means, the
//    words of that command are sent to a decision model (Jev, through
//    OpenRouter, with the user's own key) which picks one intent from a fixed
//    list. DexNest then builds the action itself, exactly as it does for the
//    local model: the service never names an action or a parameter.
//  - Capture. When the user clicks Suggest on a note in the Capture inbox,
//    the words of that note are sent and the model picks where it belongs.
//    Nothing moves until the user clicks the suggestion.
//
// It is off until the user turns it on, per surface. A command that looks
// private never leaves, and the local path stays the fallback for everything.
//
// Electron-free: main.ts supplies the key, the settings and `fetch`.

/** OpenRouter's Decisions endpoint. Marked alpha by OpenRouter: this is the one place its shape is known. */
export const OPENROUTER_DECISIONS_URL = "https://openrouter.ai/api/alpha/decisions";
export const DECISION_MODEL = "typesafe/jev-1.13";

/** Longest command sent. A command is a sentence, not a document. */
export const MAX_COMMAND_CHARS = 300;

export type OutsideAiSurface = "voice" | "typed" | "capture";

export interface OutsideAiSettings {
  /** The master switch. Off by default. */
  enabled: boolean;
  /** Which surfaces may use it. All off by default, so turning the master switch on sends nothing yet. */
  surfaces: Record<OutsideAiSurface, boolean>;
  /** The least confidence (0 to 1) at which the answer is used. Below it, the local path decides. */
  minConfidence: number;
}

export const DEFAULT_OUTSIDE_AI_SETTINGS: OutsideAiSettings = {
  enabled: false,
  surfaces: { voice: false, typed: false, capture: false },
  minConfidence: 0.7
};

export function normalizeOutsideAiSettings(value: unknown): OutsideAiSettings {
  const raw = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const surfaces = typeof raw.surfaces === "object" && raw.surfaces !== null ? (raw.surfaces as Record<string, unknown>) : {};
  const confidence = typeof raw.minConfidence === "number" && Number.isFinite(raw.minConfidence) ? raw.minConfidence : DEFAULT_OUTSIDE_AI_SETTINGS.minConfidence;
  return {
    enabled: raw.enabled === true,
    surfaces: { voice: surfaces.voice === true, typed: surfaces.typed === true, capture: surfaces.capture === true },
    // Never below one half: a coin toss is not a decision.
    minConfidence: Math.min(0.99, Math.max(0.5, Math.round(confidence * 100) / 100))
  };
}

/** An OpenRouter key by its look. The key is checked for real only by using it. */
export function looksLikeOpenRouterKey(value: unknown): value is string {
  return typeof value === "string" && /^sk-or-[A-Za-z0-9_-]{20,200}$/.test(value.trim());
}

/**
 * The intents the service may pick from, each with what it means. These are
 * the same intents the local model picks from, without the private lookup:
 * a question about a document's contents is never sent.
 */
export const INTENT_CRITERIA: Record<string, string> = {
  open_module: "Open or show one of DexNest's screens, or ask to see what a screen shows (what needs me, my skills, my level).",
  search_query: "Find or open a document, file or note by name or topic.",
  finder_search: "Ask where a physical thing is, or what is in a place.",
  calendar_create_candidate: "Add, schedule or be reminded of an event.",
  calendar_show_today: "Ask what is on today's calendar.",
  calendar_show_upcoming: "Ask about upcoming events, tomorrow, or the next event.",
  drop_send_clipboard: "Send the clipboard or the current file to the phone.",
  dev_run_command: "Run a development command for a project: typecheck, build, test, start.",
  journal_open_today: "Open today's journal.",
  capture_note: "Save a quick note or add something to the inbox.",
  unknown: "None of the others, or not a command at all."
};

/** The screens the service may pick from when the intent is to open one. Keys are the names voice already knows. */
export const SCREEN_CRITERIA: Record<string, string> = {
  command: "Command home.",
  today: "Today: where you left off, what changed, what needs you.",
  projects: "Projects: repositories, branches, changes.",
  skills: "Skills.",
  "reality rpg": "Reality RPG: level, XP, quests, achievements.",
  ghostos: "GhostOS: the timeline of projects, decisions and memories.",
  objectos: "ObjectOS: physical things, where they are, maintenance, warranties.",
  autopilot: "Autopilot.",
  search: "Search and Ask.",
  vault: "Vault.",
  capture: "Capture inbox.",
  finance: "Finance.",
  journal: "Journal.",
  calendar: "Calendar.",
  timetable: "Timetable: the weekly routine.",
  clipboard: "Clipboard.",
  drop: "Drop: files and text to and from the phone.",
  tools: "Tools: PDF, image and OCR tools.",
  utilities: "Utilities: calculator, timers, world clocks.",
  news: "News.",
  heatmap: "Heatmap.",
  backup: "Backup.",
  "activity log": "The activity log.",
  settings: "Settings.",
  none: "No screen, or not clear which."
};

// Words that mark a command as private. Anything matching stays on this
// computer: identity documents, credentials, money, health, and the three
// modules whose content is never sent anywhere.
const PRIVATE_WORDS = /\b(password|passcode|passphrase|pin|otp|secret|token|api key|sin|ssn|social insurance|social security|passport|health card|work permit|study permit|permit number|document number|uci|licen[cs]e number|account number|card number|credit card|debit card|cvv|iban|swift|routing number|bank|balance|salary|wage|income|tax|taxes|invoice|receipt|owe|owed|paid|spent|bought|cost|price|diagnos\w*|prescription|medication|medical|vault|finance|journal|diary)\b/i;
const MONEY = /[$€£¥₹]|\b\d+(?:[.,]\d+)?\s?(?:dollars?|bucks|euros?|pounds?|rupees?|cad|usd|eur|gbp|inr)\b/i;
const LONG_NUMBER = /\d[\d\s-]{5,}\d/;
const CONTACT = /[\w.+-]+@[\w-]+\.[\w.]+|https?:\/\/\S+/i;

/**
 * Why a command may not be sent, or null when it may. Errs on the side of
 * keeping things local: a refused command is simply routed by the local path.
 */
export function privateReason(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return "empty";
  if (trimmed.length > MAX_COMMAND_CHARS) return "too_long";
  if (PRIVATE_WORDS.test(trimmed)) return "private_words";
  if (MONEY.test(trimmed)) return "money";
  if (LONG_NUMBER.test(trimmed)) return "long_number";
  if (CONTACT.test(trimmed)) return "contact";
  return null;
}

/** The request body. The command's words are the only thing of the user's in it. */
export function buildDecisionRequest(text: string): Record<string, unknown> {
  return {
    model: DECISION_MODEL,
    state: { command: text.trim() },
    questions: {
      intent: { type: "choice", instructions: "Which one of these is the user asking this personal desktop app to do?", criteria: INTENT_CRITERIA },
      screen: { type: "choice", instructions: "If the user wants a screen opened or shown, which one? Otherwise answer none.", criteria: SCREEN_CRITERIA }
    },
    // Ask the provider not to keep or train on the request.
    provider: { data_collection: "deny" }
  };
}

export interface Decision {
  intent: string;
  intentConfidence: number;
  /** A key of SCREEN_CRITERIA other than "none", or null. */
  screen: string | null;
  screenConfidence: number;
  model: string;
  inputTokens: number | null;
  cost: number | null;
}

function choice(answers: Record<string, unknown>, key: string, allowed: Record<string, string>): { choice: string; confidence: number } | null {
  const answer = answers[key];
  if (typeof answer !== "object" || answer === null) return null;
  const { choice: picked, confidence } = answer as Record<string, unknown>;
  if (typeof picked !== "string" || !Object.hasOwn(allowed, picked)) return null;
  if (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) return null;
  return { choice: picked, confidence };
}

/** The answer, if it is one DexNest can use: an intent from the list with a confidence. Anything else is null. */
export function parseDecision(body: unknown): Decision | null {
  if (typeof body !== "object" || body === null) return null;
  const raw = body as Record<string, unknown>;
  if (typeof raw.answers !== "object" || raw.answers === null) return null;
  const answers = raw.answers as Record<string, unknown>;
  const intent = choice(answers, "intent", INTENT_CRITERIA);
  if (!intent) return null;
  const screen = choice(answers, "screen", SCREEN_CRITERIA);
  const usage = typeof raw.usage === "object" && raw.usage !== null ? (raw.usage as Record<string, unknown>) : {};
  return {
    intent: intent.choice,
    intentConfidence: intent.confidence,
    screen: screen && screen.choice !== "none" ? screen.choice : null,
    screenConfidence: screen ? screen.confidence : 0,
    model: typeof raw.model === "string" ? raw.model.slice(0, 80) : DECISION_MODEL,
    inputTokens: typeof usage.input_tokens === "number" ? usage.input_tokens : null,
    cost: typeof usage.cost === "number" ? usage.cost : null
  };
}

/** Whether a decision is sure enough to act on. Opening a screen needs the screen to be sure too. */
export function confidentEnough(decision: Decision, minConfidence: number): boolean {
  if (decision.intent === "unknown" || decision.intentConfidence < minConfidence) return false;
  if (decision.intent === "open_module") return decision.screen !== null && decision.screenConfidence >= minConfidence;
  return true;
}

/**
 * Where a captured note can be suggested to go. The Vault and Finance are not
 * on the list on purpose: a note that reads like either is never sent, so the
 * model is never asked about one.
 */
export const CAPTURE_CRITERIA: Record<string, string> = {
  calendar: "Something to do or attend at a time or on a day: an appointment, a deadline, a reminder.",
  journal: "A reflection, a thought about the day, something that happened.",
  finder: "Where a physical thing is or was put.",
  drop: "Something to have on the phone: a link-free snippet, a list to carry.",
  keep: "None of these, or not clear. Leave it in the inbox."
};

export function buildCaptureRequest(text: string): Record<string, unknown> {
  return {
    model: DECISION_MODEL,
    state: { note: text.trim() },
    questions: {
      route: { type: "choice", instructions: "The user jotted this note into an inbox. Where does it belong?", criteria: CAPTURE_CRITERIA }
    },
    provider: { data_collection: "deny" }
  };
}

export interface CaptureSuggestion {
  /** A key of CAPTURE_CRITERIA. */
  route: string;
  confidence: number;
  model: string;
  inputTokens: number | null;
  cost: number | null;
}

export function parseCaptureSuggestion(body: unknown): CaptureSuggestion | null {
  if (typeof body !== "object" || body === null) return null;
  const raw = body as Record<string, unknown>;
  if (typeof raw.answers !== "object" || raw.answers === null) return null;
  const route = choice(raw.answers as Record<string, unknown>, "route", CAPTURE_CRITERIA);
  if (!route) return null;
  const usage = typeof raw.usage === "object" && raw.usage !== null ? (raw.usage as Record<string, unknown>) : {};
  return {
    route: route.choice,
    confidence: route.confidence,
    model: typeof raw.model === "string" ? raw.model.slice(0, 80) : DECISION_MODEL,
    inputTokens: typeof usage.input_tokens === "number" ? usage.input_tokens : null,
    cost: typeof usage.cost === "number" ? usage.cost : null
  };
}

export type Failure = { ok: false; reason: "off" | "no_key" | "private" | "timeout" | "network" | "http" | "bad_answer"; detail?: string; status?: number; latencyMs: number };

export type CaptureOutcome = { ok: true; suggestion: CaptureSuggestion; used: boolean; latencyMs: number } | Failure;

export type RouteOutcome =
  | { ok: true; decision: Decision; used: boolean; latencyMs: number }
  | Failure;

export interface RouteDeps {
  fetch: (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
  /** The key, read only when a request is really going out. */
  key: () => string | null;
  settings: OutsideAiSettings;
  timeoutMs?: number;
  now?: () => number;
  url?: string;
}

/**
 * Asks the service what a command means. Every way this can fail comes back
 * as a reason, never as a throw: the caller carries on with the local path.
 */
export async function routeCommand(text: string, surface: OutsideAiSurface, deps: RouteDeps): Promise<RouteOutcome> {
  const asked = await ask(text, surface, deps, buildDecisionRequest, parseDecision);
  if (!asked.ok) return asked;
  return { ok: true, decision: asked.value, used: confidentEnough(asked.value, deps.settings.minConfidence), latencyMs: asked.latencyMs };
}

/**
 * Asks where a captured note belongs. The same switches, the same private
 * check and the same failures as a command; "keep" is never a suggestion.
 */
export async function suggestCaptureRoute(text: string, deps: RouteDeps): Promise<CaptureOutcome> {
  const asked = await ask(text, "capture", deps, buildCaptureRequest, parseCaptureSuggestion);
  if (!asked.ok) return asked;
  const used = asked.value.route !== "keep" && asked.value.confidence >= deps.settings.minConfidence;
  return { ok: true, suggestion: asked.value, used, latencyMs: asked.latencyMs };
}

/** The one place a request leaves from: the switches, the private check and the key are checked here, in that order. */
async function ask<T>(text: string, surface: OutsideAiSurface, deps: RouteDeps, build: (text: string) => Record<string, unknown>, parse: (body: unknown) => T | null): Promise<{ ok: true; value: T; latencyMs: number } | Failure> {
  const now = deps.now ?? Date.now;
  const started = now();
  const took = () => now() - started;
  if (!deps.settings.enabled || deps.settings.surfaces[surface] !== true) return { ok: false, reason: "off", latencyMs: 0 };
  const refused = privateReason(text);
  if (refused) return { ok: false, reason: "private", detail: refused, latencyMs: 0 };
  const key = deps.key();
  if (!key) return { ok: false, reason: "no_key", latencyMs: 0 };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? 4000);
  try {
    const response = await deps.fetch(deps.url ?? OPENROUTER_DECISIONS_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(build(text)),
      signal: controller.signal
    });
    if (!response.ok) return { ok: false, reason: "http", status: response.status, latencyMs: took() };
    const value = parse(await response.json().catch(() => null));
    if (value === null) return { ok: false, reason: "bad_answer", latencyMs: took() };
    return { ok: true, value, latencyMs: took() };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return { ok: false, reason: aborted ? "timeout" : "network", latencyMs: took() };
  } finally {
    clearTimeout(timer);
  }
}

/** In plain words, for the Settings page and the assistant. */
export function outcomeInWords(outcome: RouteOutcome | CaptureOutcome): string {
  if (outcome.ok) return outcome.used ? "Answered." : "Answered, but not sure enough to act on.";
  switch (outcome.reason) {
    case "off": return "Outside AI is off for this.";
    case "no_key": return "No OpenRouter key is saved.";
    case "private": return "That looked private, so it was not sent.";
    case "timeout": return "The service did not answer in time.";
    case "network": return "The service could not be reached.";
    case "http": return outcome.status === 401 ? "OpenRouter refused the key." : outcome.status === 402 ? "The OpenRouter account has no credit." : outcome.status === 429 ? "OpenRouter's rate limit was reached." : `OpenRouter answered with an error (${outcome.status}).`;
    case "bad_answer": return "The service answered in a form DexNest does not understand.";
  }
}
