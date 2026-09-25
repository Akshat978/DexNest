/** Synthetic Developer Intelligence facts. Nothing here comes from a real disk. */
import type { ConstellationInput, InputCommit, InputTechnology, InputTodo } from '../domain/types.ts';

export const T0 = '2026-06-01T10:00:00.000Z';

export function tech(overrides: Partial<InputTechnology> & Pick<InputTechnology, 'repositoryId' | 'name'>): InputTechnology {
  return {
    id: `tech_${overrides.repositoryId}_${overrides.name}_${overrides.evidencePath ?? 'package.json'}`,
    category: 'library',
    evidencePath: 'package.json',
    evidenceKind: 'package.json#dependencies',
    status: 'observed',
    lastObservedAt: T0,
    ...overrides,
  };
}

export function todo(overrides: Partial<InputTodo> & Pick<InputTodo, 'repositoryId' | 'filePath'>): InputTodo {
  return {
    id: `todo_${overrides.repositoryId}_${overrides.filePath}_${overrides.line ?? 1}`,
    kind: 'TODO',
    status: 'open',
    line: 1,
    firstObservedAt: T0,
    ...overrides,
  };
}

export function commit(overrides: Partial<InputCommit> & Pick<InputCommit, 'repositoryId' | 'sha'>): InputCommit {
  return { authorDate: T0, ...overrides };
}

export function input(parts: Partial<ConstellationInput>): ConstellationInput {
  return {
    repositories: parts.repositories ?? [
      { id: 'r-app', displayName: 'app' },
      { id: 'r-api', displayName: 'api' },
      { id: 'r-cli', displayName: 'cli' },
    ],
    technologies: parts.technologies ?? [],
    todos: parts.todos ?? [],
    commits: parts.commits ?? [],
  };
}

export const OPEN = { includeUnmappedLibraries: false, myEmails: [] as string[] };
