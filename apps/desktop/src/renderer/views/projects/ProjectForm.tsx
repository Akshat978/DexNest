// The project form: the wizard's review step, and (Phase 8) the Settings tab.

import React from "react";

import type { ProjectGroup } from "@dexnest/projects";
import { Button } from "../../components/kit";
import { ACCENT_OPTIONS, TYPE_OPTIONS, type CommandRow, type ProjectForm as Form } from "./projectsModel";

const SLOT_LABELS = { start: "Start (dev)", build: "Build", test: "Test", typecheck: "Typecheck", custom: "Custom" } as const;

export function ProjectFormFields({
  form,
  onChange,
  groups,
  pathEditable = false,
  idPrefix = "project-form"
}: {
  form: Form;
  onChange(next: Form): void;
  groups: readonly ProjectGroup[];
  pathEditable?: boolean;
  idPrefix?: string;
}) {
  const set = <K extends keyof Form>(key: K, value: Form[K]) => onChange({ ...form, [key]: value });
  const setRow = (index: number, row: Partial<CommandRow>) => set("commandList", form.commandList.map((r, i) => (i === index ? { ...r, ...row } : r)));
  const id = (name: string) => `${idPrefix}-${name}`;
  const text = (name: keyof Form, label: string, options: { technical?: boolean; hint?: string; multiline?: boolean; required?: boolean; readOnly?: boolean } = {}) => (
    <div className="projects-field">
      <label htmlFor={id(String(name))}>
        {label}
        {options.required && <span className="projects-field__required"> (required)</span>}
      </label>
      {options.multiline ? (
        <textarea
          id={id(String(name))}
          className={options.technical ? "kit-tech" : undefined}
          value={String(form[name])}
          rows={3}
          onChange={(e) => set(name, e.target.value as Form[typeof name])}
          aria-describedby={options.hint ? id(`${String(name)}-hint`) : undefined}
        />
      ) : (
        <input
          id={id(String(name))}
          className={options.technical ? "kit-tech" : undefined}
          value={String(form[name])}
          readOnly={options.readOnly}
          required={options.required}
          onChange={(e) => set(name, e.target.value as Form[typeof name])}
          aria-describedby={options.hint ? id(`${String(name)}-hint`) : undefined}
        />
      )}
      {options.hint && (
        <p className="projects-field__hint" id={id(`${String(name)}-hint`)}>
          {options.hint}
        </p>
      )}
    </div>
  );

  return (
    <div className="projects-form">
      <fieldset className="projects-form__group">
        <legend>Project</legend>
        <div className="projects-form__grid">
          {text("name", "Name", { required: true })}
          {text("path", "Folder", { technical: true, required: true, readOnly: !pathEditable })}
          {text("description", "Description")}
          <div className="projects-field">
            <label htmlFor={id("group")}>Group</label>
            <select id={id("group")} value={form.groupId} onChange={(e) => set("groupId", e.target.value)}>
              <option value="">No group</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
          {text("tags", "Tags", { hint: "Separated by commas." })}
          <div className="projects-field">
            <label htmlFor={id("type")}>Type</label>
            <select id={id("type")} value={form.projectType} onChange={(e) => set("projectType", e.target.value)}>
              {TYPE_OPTIONS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <div className="projects-field">
            <label htmlFor={id("accent")}>Accent</label>
            <select id={id("accent")} value={form.accent} onChange={(e) => set("accent", e.target.value)}>
              {ACCENT_OPTIONS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
          <label className="projects-check">
            <input type="checkbox" checked={form.favourite} onChange={(e) => set("favourite", e.target.checked)} />
            Favourite (pinned near the top)
          </label>
        </div>
      </fieldset>

      <fieldset className="projects-form__group">
        <legend>Commands</legend>
        <div className="projects-form__grid">
          {(Object.keys(SLOT_LABELS) as Array<keyof typeof SLOT_LABELS>).map((slot) => (
            <div className="projects-field" key={slot}>
              <label htmlFor={id(`cmd-${slot}`)}>{SLOT_LABELS[slot]}</label>
              <input id={id(`cmd-${slot}`)} className="kit-tech" value={form.commands[slot]} onChange={(e) => set("commands", { ...form.commands, [slot]: e.target.value })} />
            </div>
          ))}
        </div>
        <div className="projects-form__list" role="group" aria-label="Extra commands">
          {form.commandList.map((row, index) => (
            <div className="projects-form__row" key={row.id ?? `new-${index}`}>
              <input aria-label={`Command ${index + 1} label`} value={row.label} placeholder="Label" onChange={(e) => setRow(index, { label: e.target.value })} />
              <input aria-label={`Command ${index + 1}`} className="kit-tech" value={row.command} placeholder="Command" onChange={(e) => setRow(index, { command: e.target.value })} />
              <label className="projects-check">
                <input type="checkbox" checked={row.requiresConfirmation} onChange={(e) => setRow(index, { requiresConfirmation: e.target.checked })} />
                Ask before running
              </label>
              <Button size="sm" variant="ghost" onClick={() => set("commandList", form.commandList.filter((_, i) => i !== index))} aria-label={`Remove command ${row.label || index + 1}`}>
                Remove
              </Button>
            </div>
          ))}
          <Button size="sm" variant="ghost" onClick={() => set("commandList", [...form.commandList, { label: "", command: "", requiresConfirmation: false }])}>
            Add command
          </Button>
        </div>
      </fieldset>

      <fieldset className="projects-form__group">
        <legend>Run, links and folders</legend>
        <div className="projects-form__grid">
          {text("ports", "Ports", { technical: true, hint: "Separated by commas." })}
          {text("healthUrl", "Health URL", { technical: true })}
          {text("localUrls", "Local URLs", { technical: true, multiline: true, hint: "One per line, http://localhost:..." })}
          {text("links", "Links", { technical: true, multiline: true, hint: "One per line: Label | https://..." })}
          {text("folders", "Folders", { technical: true, multiline: true, hint: "One per line: Label | D:\\path" })}
          {text("stopCommand", "Stop command", { technical: true })}
          {text("logPath", "Log file", { technical: true })}
          {text("logCommand", "Log command", { technical: true })}
          <label className="projects-check">
            <input type="checkbox" checked={form.dockerCompose} onChange={(e) => set("dockerCompose", e.target.checked)} />
            Uses Docker Compose
          </label>
        </div>
        {text("notes", "Notes", { multiline: true })}
      </fieldset>
    </div>
  );
}
