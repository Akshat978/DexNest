// "Add project": choose (dialog, drop, paste, a suggestion or a clone) ->
// DexNest inspects -> review the pre-filled form -> save.

import React, { useEffect, useState } from "react";
import { FolderOpen, GitBranch, Sparkles } from "lucide-react";

import type { InspectResult, ProjectGroup, Suggestion } from "@dexnest/projects";
import { Badge, Button, Dialog, Technical } from "../../components/ui/kit";
import { ProjectFormFields } from "./ProjectForm";
import type { ProjectsBridge } from "./projectsBridge";
import { formFromInput, formProblems, inputFromForm, type ProjectForm } from "./projectsModel";

export type WizardStep =
  | { kind: "choose"; error?: string }
  | { kind: "inspecting"; path: string }
  | { kind: "refused"; reason: string }
  | { kind: "duplicate"; reason: string; existingId: string; existingName: string }
  | { kind: "review"; inspection: Extract<InspectResult, { kind: "ok" }>; form: ProjectForm; saveError?: string }
  | { kind: "saving" }
  | { kind: "cloning"; url: string };

export function stepFromInspection(result: InspectResult): WizardStep {
  if (result.kind === "refused") return { kind: "refused", reason: result.reason };
  if (result.kind === "duplicate") return { kind: "duplicate", reason: result.reason, existingId: result.existing.id, existingName: result.existing.name };
  return { kind: "review", inspection: result, form: formFromInput(result.draft) };
}

const STEPS = ["Choose", "Inspect", "Review"] as const;

function stepIndex(step: WizardStep): number {
  return step.kind === "choose" ? 0 : step.kind === "review" || step.kind === "saving" ? 2 : 1;
}

/** What the owner sees for one step. Pure: no bridge calls, so it renders the same in tests. */
export function WizardBody({
  step,
  pasted,
  onPasted,
  onPick,
  onInspect,
  suggestions,
  selected,
  onToggleSuggestion,
  onAddSelected,
  clone,
  onClone,
  onCloneChange,
  onPickParent,
  groups,
  onForm,
  dragging
}: {
  step: WizardStep;
  pasted: string;
  onPasted(value: string): void;
  onPick(): void;
  onInspect(path: string): void;
  suggestions: readonly Suggestion[];
  selected: ReadonlySet<string>;
  onToggleSuggestion(path: string): void;
  onAddSelected(): void;
  clone: { url: string; parentDir: string; folderName: string };
  onCloneChange(next: { url: string; parentDir: string; folderName: string }): void;
  onClone(): void;
  onPickParent(): void;
  groups: readonly ProjectGroup[];
  onForm(form: ProjectForm): void;
  dragging?: boolean;
}) {
  const current = stepIndex(step);
  const steps = (
    <ol className="projects-wizard__steps" aria-label="Steps">
      {STEPS.map((label, i) => (
        <li key={label} aria-current={i === current ? "step" : undefined} className={i === current ? "projects-wizard__step--on" : i < current ? "projects-wizard__step--done" : undefined}>
          <span className="projects-wizard__num">{i + 1}</span>
          {label}
        </li>
      ))}
    </ol>
  );
  if (step.kind === "choose") {
    return (
      <div className="projects-wizard">
        {steps}
        {step.error && (
          <p className="projects-wizard__error" role="alert">
            {step.error}
          </p>
        )}
        <div className="projects-wizard__choose">
          <Button variant="primary" icon={<FolderOpen />} onClick={onPick}>
            Choose folder…
          </Button>
          <form
            className="projects-wizard__paste"
            onSubmit={(e) => {
              e.preventDefault();
              if (pasted.trim()) onInspect(pasted.trim());
            }}
          >
            <label htmlFor="projects-wizard-path">or paste a path</label>
            <div className="projects-wizard__paste-row">
              <input id="projects-wizard-path" className="kit-tech" value={pasted} placeholder="D:\code\my-app" onChange={(e) => onPasted(e.target.value)} />
              <Button type="submit" disabledReason={pasted.trim() ? null : "Paste a folder path first."}>
                Inspect
              </Button>
            </div>
          </form>
          <div className={`projects-wizard__drop${dragging ? " projects-wizard__drop--on" : ""}`} aria-hidden="true">
            …or drop a folder anywhere on this window
          </div>
        </div>

        <section className="projects-wizard__section" aria-labelledby="projects-wizard-suggestions">
          <h3 id="projects-wizard-suggestions">
            <Sparkles aria-hidden="true" /> Suggestions from the repository scan
          </h3>
          {suggestions.length === 0 ? (
            <p className="projects-wizard__muted">Nothing new found. The repository scan suggests repositories it has discovered that aren't projects yet.</p>
          ) : (
            <>
              <ul className="projects-wizard__suggestions">
                {suggestions.map((s) => (
                  <li key={s.path}>
                    <label className="projects-check">
                      <input type="checkbox" checked={selected.has(s.path)} onChange={() => onToggleSuggestion(s.path)} />
                      <span className="projects-wizard__suggestion-name">{s.name}</span>
                      <Technical className="projects-wizard__suggestion-path" title={s.path}>
                        {s.path}
                      </Technical>
                    </label>
                  </li>
                ))}
              </ul>
              <Button variant="secondary" disabledReason={selected.size > 0 ? null : "Tick at least one repository."} onClick={onAddSelected}>
                Add selected ({selected.size})
              </Button>
            </>
          )}
        </section>

        <section className="projects-wizard__section" aria-labelledby="projects-wizard-clone">
          <h3 id="projects-wizard-clone">
            <GitBranch aria-hidden="true" /> Clone from GitHub
          </h3>
          <div className="projects-wizard__clone">
            <div className="projects-field">
              <label htmlFor="projects-clone-url">Repository URL</label>
              <input id="projects-clone-url" className="kit-tech" value={clone.url} placeholder="https://github.com/owner/repo" onChange={(e) => onCloneChange({ ...clone, url: e.target.value })} />
            </div>
            <div className="projects-field">
              <label htmlFor="projects-clone-parent">Into folder</label>
              <div className="projects-wizard__paste-row">
                <input id="projects-clone-parent" className="kit-tech" value={clone.parentDir} placeholder="D:\code" onChange={(e) => onCloneChange({ ...clone, parentDir: e.target.value })} />
                <Button variant="ghost" onClick={onPickParent}>
                  Browse…
                </Button>
              </div>
            </div>
            <div className="projects-field">
              <label htmlFor="projects-clone-name">Folder name</label>
              <input id="projects-clone-name" className="kit-tech" value={clone.folderName} placeholder="(the repository's name)" onChange={(e) => onCloneChange({ ...clone, folderName: e.target.value })} />
            </div>
            <p className="projects-wizard__muted">Uses the network, only when you click Clone.</p>
            <Button variant="secondary" disabledReason={clone.url.trim() && clone.parentDir.trim() ? null : "Enter a URL and a folder first."} onClick={onClone}>
              Clone
            </Button>
          </div>
        </section>
      </div>
    );
  }
  if (step.kind === "inspecting" || step.kind === "cloning") {
    return (
      <div className="projects-wizard">
        {steps}
        <p role="status" className="projects-wizard__muted">
          {step.kind === "inspecting" ? (
            <>
              Inspecting <Technical>{step.path}</Technical>…
            </>
          ) : (
            <>
              Cloning <Technical>{step.url}</Technical>…
            </>
          )}
        </p>
      </div>
    );
  }
  if (step.kind === "refused") {
    return (
      <div className="projects-wizard">
        {steps}
        <p className="projects-wizard__error" role="alert">
          {step.reason}
        </p>
      </div>
    );
  }
  if (step.kind === "duplicate") {
    return (
      <div className="projects-wizard">
        {steps}
        <p className="projects-wizard__error" role="alert">
          {step.reason}
        </p>
      </div>
    );
  }
  if (step.kind === "saving") {
    return (
      <div className="projects-wizard">
        {steps}
        <p role="status">Saving…</p>
      </div>
    );
  }
  const facts = step.inspection.facts;
  const problems = formProblems(step.form);
  return (
    <div className="projects-wizard">
      {steps}
      <ul className="projects-wizard__facts" aria-label="What DexNest found">
        <li>
          <Badge tone={facts.isRepo ? "success" : "neutral"}>{facts.isRepo ? "git repo" : "not a git repo"}</Badge>
        </li>
        {facts.hosting && (
          <li>
            <Badge tone="info">
              github.com/{facts.hosting.owner}/{facts.hosting.repo}
            </Badge>
          </li>
        )}
        {facts.defaultBranch && (
          <li>
            <Badge tone="neutral">default {facts.defaultBranch}</Badge>
          </li>
        )}
        {facts.framework && (
          <li>
            <Badge tone="accent">{facts.framework}</Badge>
          </li>
        )}
        {facts.packageManager && (
          <li>
            <Badge tone="neutral">{facts.packageManager}</Badge>
          </li>
        )}
        {facts.workspaceFile && (
          <li>
            <Badge tone="neutral">{facts.workspaceFile}</Badge>
          </li>
        )}
      </ul>
      {step.inspection.warnings.map((w) => (
        <p key={w} className="projects-wizard__warning">
          {w}
        </p>
      ))}
      <ProjectFormFields form={step.form} onChange={onForm} groups={groups} />
      {(problems.length > 0 || step.saveError) && (
        <ul className="projects-wizard__problems" role="alert">
          {step.saveError && <li>{step.saveError}</li>}
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function AddProjectWizard({
  bridge,
  groups,
  initialPath,
  dragging,
  onClose,
  onAdded,
  onOpenExisting
}: {
  bridge: ProjectsBridge;
  groups: readonly ProjectGroup[];
  initialPath?: string | null;
  dragging?: boolean;
  onClose(): void;
  onAdded(message: string): void;
  onOpenExisting(projectId: string): void;
}) {
  const [step, setStep] = useState<WizardStep>({ kind: "choose" });
  const [pasted, setPasted] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [clone, setClone] = useState({ url: "", parentDir: "", folderName: "" });

  const inspect = async (path: string) => {
    setStep({ kind: "inspecting", path });
    try {
      setStep(stepFromInspection(await bridge.projectsInspect(path)));
    } catch (error) {
      setStep({ kind: "choose", error: (error as Error).message });
    }
  };

  useEffect(() => {
    void bridge.projectsSuggestions().then(setSuggestions, () => setSuggestions([]));
  }, [bridge]);
  useEffect(() => {
    if (initialPath) void inspect(initialPath);
    // Only for the path the wizard was opened with (a dropped folder).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPath]);

  const save = async () => {
    if (step.kind !== "review" || formProblems(step.form).length > 0) return;
    const reviewed = step;
    setStep({ kind: "saving" });
    const result = await bridge.projectsAdd(inputFromForm(reviewed.form), "wizard");
    if (result.ok) onAdded(`Added ${result.project.name}.`);
    else setStep({ ...reviewed, saveError: result.reason });
  };

  const footer = (
    <>
      {step.kind !== "choose" && step.kind !== "saving" && (
        <Button variant="ghost" onClick={() => setStep({ kind: "choose" })}>
          Back
        </Button>
      )}
      <Button variant="ghost" onClick={onClose}>
        Cancel
      </Button>
      {step.kind === "duplicate" && (
        <Button variant="primary" onClick={() => onOpenExisting(step.existingId)}>
          Open {step.existingName}
        </Button>
      )}
      {step.kind === "review" && (
        <Button variant="primary" disabledReason={formProblems(step.form)[0] ?? null} onClick={() => void save()}>
          Save project
        </Button>
      )}
    </>
  );

  return (
    <Dialog title="Add a project" description="DexNest looks at the folder and fills in what it can. Nothing is changed in the folder." onClose={onClose} footer={footer} wide>
      <WizardBody
        step={step}
        pasted={pasted}
        onPasted={setPasted}
        onPick={async () => {
          const path = await bridge.projectsPickFolder("Choose a project folder");
          if (path) await inspect(path);
        }}
        onInspect={(path) => void inspect(path)}
        suggestions={suggestions}
        selected={selected}
        onToggleSuggestion={(path) =>
          setSelected((current) => {
            const next = new Set(current);
            if (next.has(path)) next.delete(path);
            else next.add(path);
            return next;
          })
        }
        onAddSelected={async () => {
          const result = await bridge.projectsAddSuggestions([...selected]);
          const skipped = result.skipped.length > 0 ? ` ${result.skipped.length} skipped: ${result.skipped.map((s) => s.reason).join("; ")}` : "";
          onAdded(`Added ${result.added.length} project${result.added.length === 1 ? "" : "s"}.${skipped}`);
        }}
        clone={clone}
        onCloneChange={setClone}
        onPickParent={async () => {
          const path = await bridge.projectsPickFolder("Clone into which folder?");
          if (path) setClone((c) => ({ ...c, parentDir: path }));
        }}
        onClone={async () => {
          setStep({ kind: "cloning", url: clone.url });
          const result = await bridge.projectsClone({ url: clone.url, parentDir: clone.parentDir, folderName: clone.folderName.trim() || undefined });
          if (result.status === "refused") setStep({ kind: "choose", error: result.reason });
          else if (result.outcome !== "succeeded") setStep({ kind: "choose", error: result.message });
          else if (result.inspection) setStep(stepFromInspection(result.inspection));
          else await inspect(result.path);
        }}
        groups={groups}
        onForm={(form) => step.kind === "review" && setStep({ ...step, form, saveError: undefined })}
        dragging={dragging}
      />
    </Dialog>
  );
}
