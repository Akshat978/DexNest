// "Import projects": choose a folder once, see every repository inside it,
// import the ticked ones in one click. New repositories start ticked; ones
// that are already projects are shown, not ticked, and can't be added twice.
// The walk is Developer Intelligence's discovery in the main process (bounded,
// junction-safe, never inside DexNest's data); nothing in a folder changes.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FolderOpen, FolderSearch, History } from "lucide-react";

import type { AddManyResult, FolderScanResult, ImportCandidate } from "@dexnest/projects";
import { Badge, Button, Dialog, InlineError, LoadingState, Technical } from "../../components/ui/kit";
import type { ProjectsBridge } from "./projectsBridge";

export type ImportStep =
  | { kind: "choose"; error?: string }
  | { kind: "scanning"; roots: string[] }
  | { kind: "results"; scan: FolderScanResult }
  | { kind: "importing"; count: number }
  | { kind: "done"; result: AddManyResult };

/** Everything new starts ticked; what is already a project never is. */
export function initialSelection(candidates: readonly ImportCandidate[]): Set<string> {
  return new Set(candidates.filter((c) => c.existing === null).map((c) => c.path));
}

export function importButtonLabel(count: number): string {
  return count === 0 ? "Import" : `Import ${count} project${count === 1 ? "" : "s"}`;
}

/**
 * Where a repository sits inside the folder that was searched, so the list
 * isn't the same long prefix repeated. The full path stays in the tooltip.
 */
export function pathWithinRoots(path: string, roots: readonly string[]): string {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
  const target = norm(path);
  for (const root of roots) {
    const base = norm(root);
    if (target.toLowerCase() === base.toLowerCase()) return "(the folder itself)";
    if (target.toLowerCase().startsWith(`${base.toLowerCase()}/`)) {
      const rest = target.slice(base.length + 1);
      return path.includes("\\") ? rest.replace(/\//g, "\\") : rest;
    }
  }
  return path;
}

export function doneSummary(result: AddManyResult): string {
  const added = `Imported ${result.added.length} project${result.added.length === 1 ? "" : "s"}.`;
  return result.skipped.length === 0 ? added : `${added} ${result.skipped.length} skipped.`;
}

/** One step of the dialog. Pure: no bridge calls, so it renders the same in tests. */
export function ImportBody({
  step,
  rememberedRoots,
  pasted,
  onPasted,
  onPick,
  onScan,
  selected,
  onToggle,
  onToggleAll,
  dragging
}: {
  step: ImportStep;
  rememberedRoots: readonly string[];
  pasted: string;
  onPasted(value: string): void;
  onPick(): void;
  onScan(roots: string[]): void;
  selected: ReadonlySet<string>;
  onToggle(path: string): void;
  onToggleAll(on: boolean): void;
  dragging?: boolean;
}) {
  if (step.kind === "choose") {
    return (
      <div className="projects-import">
        {step.error && <InlineError>{step.error}</InlineError>}
        <div className="projects-wizard__choose">
          <Button variant="primary" icon={<FolderOpen />} onClick={onPick}>
            Choose a folder…
          </Button>
          <form
            className="projects-wizard__paste"
            onSubmit={(e) => {
              e.preventDefault();
              if (pasted.trim()) onScan([pasted.trim()]);
            }}
          >
            <label htmlFor="projects-import-path">or paste a path</label>
            <div className="projects-wizard__paste-row">
              <input id="projects-import-path" className="kit-tech" value={pasted} placeholder="D:\code" onChange={(e) => onPasted(e.target.value)} />
              <Button type="submit" disabledReason={pasted.trim() ? null : "Paste a folder path first."}>
                Look inside
              </Button>
            </div>
          </form>
          <div className={`projects-wizard__drop${dragging ? " projects-wizard__drop--on" : ""}`} aria-hidden="true">
            …or drop one or more folders anywhere on this window
          </div>
        </div>
        {rememberedRoots.length > 0 && (
          <section className="projects-wizard__section" aria-labelledby="projects-import-recent">
            <h3 id="projects-import-recent">
              <History aria-hidden="true" /> Check again for new projects
            </h3>
            <div className="projects-import__recent">
              {rememberedRoots.map((root) => (
                <Button key={root} size="sm" variant="secondary" onClick={() => onScan([root])} title={`Look inside ${root} again`} aria-label={`Check ${root} again`}>
                  <Technical>{root}</Technical>
                </Button>
              ))}
              {rememberedRoots.length > 1 && (
                <Button size="sm" variant="ghost" onClick={() => onScan([...rememberedRoots])}>
                  All of them
                </Button>
              )}
            </div>
          </section>
        )}
        <p className="projects-wizard__muted">
          DexNest finds every Git repository inside the folder (up to four levels deep), skipping <Technical>node_modules</Technical>, hidden folders and DexNest's own data. Nothing in the folders is changed.
        </p>
      </div>
    );
  }

  if (step.kind === "scanning") {
    return <LoadingState label={`Looking inside ${step.roots.length === 1 ? step.roots[0] : `${step.roots.length} folders`}`} />;
  }

  if (step.kind === "importing") {
    return <LoadingState label={`Importing ${step.count} project${step.count === 1 ? "" : "s"}`} />;
  }

  if (step.kind === "done") {
    const { result } = step;
    return (
      <div className="projects-import" role="status">
        <p className="projects-import__done">{doneSummary(result)}</p>
        {result.skipped.length > 0 && (
          <ul className="projects-import__skipped" aria-label="Skipped">
            {result.skipped.map((s) => (
              <li key={s.path}>
                <Technical title={s.path}>{s.path}</Technical>
                <span>{s.reason}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  const { scan } = step;
  const fresh = scan.candidates.filter((c) => c.existing === null);
  const allOn = fresh.length > 0 && fresh.every((c) => selected.has(c.path));
  return (
    <div className="projects-import">
      {scan.refused.map((r) => (
        <InlineError key={r.path}>
          <Technical>{r.path}</Technical>: {r.reason}
        </InlineError>
      ))}
      {scan.roots.length > 0 && (
        <p className="projects-import__summary">
          Found {scan.candidates.length} repositor{scan.candidates.length === 1 ? "y" : "ies"} in{" "}
          <Technical>{scan.roots.join(", ")}</Technical>
          {fresh.length < scan.candidates.length && ` · ${scan.candidates.length - fresh.length} already added`}
        </p>
      )}
      {scan.truncated && (
        <p className="projects-wizard__muted" role="note">
          The search stopped early - that folder is very large. Choose a narrower folder to be sure nothing is missed.
        </p>
      )}
      {scan.unreadable > 0 && (
        <p className="projects-wizard__muted" role="note">
          {scan.unreadable} folder{scan.unreadable === 1 ? "" : "s"} couldn't be read and {scan.unreadable === 1 ? "was" : "were"} skipped.
        </p>
      )}
      {scan.roots.length > 0 && scan.candidates.length === 0 && <p className="projects-wizard__muted">No Git repositories in there.</p>}
      {fresh.length > 1 && (
        <label className="projects-check projects-import__all">
          <input type="checkbox" checked={allOn} onChange={() => onToggleAll(!allOn)} />
          <span>Select all new ({fresh.length})</span>
        </label>
      )}
      {scan.candidates.length > 0 && (
        <ul className="projects-wizard__suggestions projects-import__list" aria-label="Repositories found">
          {scan.candidates.map((c) => {
            const where = pathWithinRoots(c.path, scan.roots);
            return (
            <li key={c.path} className={c.existing ? "projects-import__item--added" : undefined} title={c.path}>
              <label className="projects-check">
                <input type="checkbox" checked={c.existing === null && selected.has(c.path)} disabled={c.existing !== null} onChange={() => onToggle(c.path)} />
                <span className="projects-wizard__suggestion-name">{c.name}</span>
                {/* A top-level repository's path is just its name again. */}
                {where !== c.name && (
                  <Technical className="projects-wizard__suggestion-path" title={c.path}>
                    {where}
                  </Technical>
                )}
                {c.existing && <Badge tone="neutral" title={`Already a project: ${c.existing.name}`}>{c.existing.archived ? "archived" : "added"}</Badge>}
              </label>
            </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function ImportProjectsDialog({
  bridge,
  initialRoots,
  rememberedRoots,
  dragging,
  onClose,
  onImported
}: {
  bridge: ProjectsBridge;
  /** Folders dropped on the window: scanned straight away. */
  initialRoots?: readonly string[] | null;
  rememberedRoots: readonly string[];
  dragging?: boolean;
  onClose(): void;
  onImported(message: string): void;
}) {
  const [step, setStep] = useState<ImportStep>({ kind: "choose" });
  const [pasted, setPasted] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const scan = useCallback(
    async (roots: string[]) => {
      setStep({ kind: "scanning", roots });
      try {
        const result = await bridge.projectsScanFolders(roots);
        if (result.roots.length === 0 && result.refused.length > 0) {
          setStep({ kind: "choose", error: result.refused.map((r) => `${r.path}: ${r.reason}`).join(" ") });
          return;
        }
        setSelected(initialSelection(result.candidates));
        setStep({ kind: "results", scan: result });
      } catch (error) {
        setStep({ kind: "choose", error: (error as Error).message });
      }
    },
    [bridge]
  );

  const initialKey = initialRoots?.join("\n") ?? "";
  useEffect(() => {
    if (initialRoots && initialRoots.length > 0) void scan([...initialRoots]);
    // Only for the folders the dialog was opened (or re-dropped) with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialKey]);

  const chosen = useMemo(() => (step.kind === "results" ? step.scan.candidates.filter((c) => c.existing === null && selected.has(c.path)).map((c) => c.path) : []), [step, selected]);

  const runImport = async () => {
    if (chosen.length === 0) return;
    setStep({ kind: "importing", count: chosen.length });
    try {
      const result = await bridge.projectsImportFolders(chosen);
      setStep({ kind: "done", result });
      onImported(doneSummary(result));
    } catch (error) {
      setStep({ kind: "choose", error: (error as Error).message });
    }
  };

  const footer = (
    <>
      {(step.kind === "results" || step.kind === "done") && (
        <Button variant="ghost" onClick={() => setStep({ kind: "choose" })}>
          {step.kind === "done" ? "Import more" : "Back"}
        </Button>
      )}
      <Button variant={step.kind === "done" ? "primary" : "ghost"} onClick={onClose}>
        {step.kind === "done" ? "Done" : "Cancel"}
      </Button>
      {step.kind === "results" && (
        <Button variant="primary" icon={<FolderSearch />} disabledReason={chosen.length > 0 ? null : "Tick at least one new repository."} onClick={() => void runImport()}>
          {importButtonLabel(chosen.length)}
        </Button>
      )}
    </>
  );

  return (
    <Dialog
      title="Import projects"
      description="Choose a folder and DexNest adds every Git repository inside it, filled in automatically. You can edit any project afterwards."
      onClose={onClose}
      footer={footer}
      wide
      accent="dev"
    >
      <ImportBody
        step={step}
        rememberedRoots={rememberedRoots}
        pasted={pasted}
        onPasted={setPasted}
        onPick={async () => {
          const path = await bridge.projectsPickFolder("Import projects from which folder?");
          if (path) await scan([path]);
        }}
        onScan={(roots) => void scan(roots)}
        selected={selected}
        onToggle={(path) =>
          setSelected((current) => {
            const next = new Set(current);
            if (next.has(path)) next.delete(path);
            else next.add(path);
            return next;
          })
        }
        onToggleAll={(on) => setSelected(on && step.kind === "results" ? initialSelection(step.scan.candidates) : new Set())}
        dragging={dragging}
      />
    </Dialog>
  );
}
