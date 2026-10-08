/**
 * The Outside AI buttons that sit in other screens.
 *
 * Each renders nothing unless the user has switched its use on in Settings,
 * with the data it needs. Each says, next to the button, what a click sends;
 * what comes back is shown as text and changes nothing by itself.
 */

import React, { useState } from "react";
import { Sparkles } from "lucide-react";
import { Button, Card, InlineError, SectionTitle } from "../components/ui/kit";

import { useOutsideAi } from "./outsideAiUse";
import "./OutsideAi.css";

/** Text Outside AI wrote, marked as such. */
export function OutsideAiText({ children, from }: { children: React.ReactNode; from: string }) {
  return (
    <div className="outside-ai-text" role="status">
      <p className="outside-ai-text__body">{children}</p>
      <p className="outside-ai-text__from"><Sparkles aria-hidden="true" /> Written by Outside AI from {from}. It can be wrong.</p>
    </div>
  );
}

/** Today: the latest Standup's lines, said in a few sentences. */
export function StandupWords() {
  const ai = useOutsideAi<{ text?: string }>("standup", "outside_ai.standup_words");
  const [text, setText] = useState<string | null>(null);
  if (!ai.on) return null;
  return (
    <Card aria-labelledby="today-in-words">
      <SectionTitle id="today-in-words">In plain words</SectionTitle>
      {text ? <OutsideAiText from="this Standup's lines">{text}</OutsideAiText> : <p className="outside-ai-hint">Sends this Standup's lines (project names and what changed) to Outside AI, which writes a few sentences.</p>}
      <div className="button-row">
        <Button size="sm" disabled={ai.busy} onClick={() => void ai.ask().then((result) => { if (result?.text) setText(result.text); })}>
          {ai.busy ? "Writing…" : text ? "Write it again" : "Say it in plain words"}
        </Button>
      </div>
      {ai.error && <InlineError>{ai.error}</InlineError>}
    </Card>
  );
}

const SOURCE_NAMES: Record<string, string> = { object: "ObjectOS", today: "Today", skills: "Skills", ghost: "GhostOS", rpg: "Reality RPG", timetable: "Timetable", reminders: "Reminders" };

/** Search: a short answer written from the few results that match the question. */
export function OutsideAiAnswer({ question }: { question: string }) {
  const ai = useOutsideAi<{ text?: string; sources?: { title: string; sourceModule: string }[] }>("answer", "outside_ai.answer");
  const [answer, setAnswer] = useState<{ question: string; text: string; sources: { title: string; sourceModule: string }[] } | null>(null);
  if (!ai.on) return null;
  const asked = question.trim();
  return (
    <Card aria-labelledby="search-outside-answer">
      <SectionTitle id="search-outside-answer">Answer from Outside AI</SectionTitle>
      <p className="outside-ai-hint">Sends what is in the search box, and up to eight matching results from Today, Skills, Reality RPG, GhostOS, ObjectOS, the Timetable and reminders. Never the Vault, Finance, the Journal or your documents.</p>
      <div className="button-row">
        <Button size="sm" disabled={ai.busy || !asked} onClick={() => void ai.ask({ question: asked }).then((result) => { if (result?.text) setAnswer({ question: asked, text: result.text, sources: result.sources ?? [] }); })}>
          {ai.busy ? "Asking…" : "Answer from these"}
        </Button>
      </div>
      {ai.error && <InlineError>{ai.error}</InlineError>}
      {answer && !ai.error && (
        <>
          <OutsideAiText from={`${answer.sources.length} result${answer.sources.length === 1 ? "" : "s"} for "${answer.question}"`}>{answer.text}</OutsideAiText>
          <ul className="outside-ai-sources">
            {answer.sources.map((source, i) => <li key={`${source.sourceModule}:${i}`}><span className="technical">{SOURCE_NAMES[source.sourceModule] ?? source.sourceModule}</span> {source.title}</li>)}
          </ul>
        </>
      )}
    </Card>
  );
}
