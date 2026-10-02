// One project on the home screen, as a card (grid) or a row (list). The
// name opens the project; the five quick buttons say why when they can't run.

import React from "react";
import { Code2, Download, RefreshCw, SquareTerminal, Star, Upload } from "lucide-react";

import { Badge, Button, Card, Technical } from "../../components/kit";
import { fetchedAgoText } from "@dexnest/projects/domain";
import { badgeFor, branchLine, quickActions, relativeTime, type QuickActionId, type ViewEntry } from "./projectsModel";

const QUICK_ICONS: Record<QuickActionId, React.ReactNode> = {
  vscode: <Code2 />,
  terminal: <SquareTerminal />,
  fetch: <RefreshCw />,
  pull: <Download />,
  push: <Upload />
};

export interface ProjectCardProps {
  entry: ViewEntry;
  layout: "grid" | "list";
  now: string;
  /** Roving tabindex: only the focused card's name is in the tab order. */
  tabbable: boolean;
  nameRef?: (node: HTMLButtonElement | null) => void;
  onOpen(entry: ViewEntry): void;
  onQuick(entry: ViewEntry, action: QuickActionId): void;
  onToggleFavourite(entry: ViewEntry): void;
  onKeyDownName?(event: React.KeyboardEvent<HTMLButtonElement>): void;
}

export function ProjectCard({ entry, layout, now, tabbable, nameRef, onOpen, onQuick, onToggleFavourite, onKeyDownName }: ProjectCardProps) {
  const { project, state } = entry;
  const badge = badgeFor(entry);
  const actions = quickActions(entry);
  const branch = branchLine(state);
  const last = state?.isRepo ? state.lastCommit : null;
  const fetched = state?.isRepo && state.remotes.length > 0 ? fetchedAgoText(state.lastFetchAt, now) : null;
  const headingId = `project-${project.id}-name`;
  return (
    <Card accent={project.accent} interactive className={`projects-card projects-card--${layout}`} aria-labelledby={headingId}>
      <div className="projects-card__head">
        <h3 className="projects-card__title" id={headingId}>
          <button
            ref={nameRef}
            type="button"
            className="projects-card__name"
            tabIndex={tabbable ? 0 : -1}
            onClick={() => onOpen(entry)}
            onKeyDown={onKeyDownName}
          >
            {project.name}
          </button>
        </h3>
        <button
          type="button"
          className={`projects-card__fav${project.favourite ? " projects-card__fav--on" : ""}`}
          aria-pressed={project.favourite}
          aria-label={project.favourite ? `Unfavourite ${project.name}` : `Favourite ${project.name}`}
          title={project.favourite ? "Favourite" : "Add to favourites"}
          onClick={() => onToggleFavourite(entry)}
        >
          <Star aria-hidden="true" />
        </button>
        <Badge tone={badge.tone} title={entry.readError ?? undefined}>{badge.text}</Badge>
      </div>

      <div className="projects-card__meta">
        {branch && <Technical className="projects-card__branch">{branch}</Technical>}
        {last && (
          <p className="projects-card__commit" title={last.subject}>
            <span className="projects-card__subject">{last.subject}</span>
            <span className="projects-card__when">{relativeTime(last.committedAt, now)}</span>
          </p>
        )}
        {layout === "grid" && <Technical className="projects-card__path" title={project.path}>{project.path}</Technical>}
        {project.tags.length > 0 && (
          <ul className="projects-card__tags" aria-label="Tags">
            {project.tags.map((tag) => (
              <li key={tag}>{tag}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="projects-card__foot">
        <div className="projects-card__actions" role="group" aria-label={`Quick actions for ${project.name}`}>
          {actions.map((action) => (
            <Button
              key={action.id}
              size="sm"
              variant={action.id === "push" || action.id === "pull" ? "secondary" : "ghost"}
              icon={QUICK_ICONS[action.id]}
              disabledReason={action.disabledReason}
              title={`${action.label} - ${project.name}`}
              // Cards show icons only (five labelled buttons don't fit a card); the name stays for screen readers.
              aria-label={layout === "grid" ? `${action.label} - ${project.name}` : undefined}
              className={layout === "grid" ? "projects-card__quick--icon" : undefined}
              onClick={() => onQuick(entry, action.id)}
            >
              {layout === "grid" ? null : action.label}
            </Button>
          ))}
        </div>
        {fetched && <span className="projects-card__fetched">{fetched}</span>}
      </div>
    </Card>
  );
}
