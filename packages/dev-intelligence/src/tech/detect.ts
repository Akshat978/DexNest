/**
 * Technology facts with provenance — no skill/XP inference.
 * Sources: package.json, pyproject.toml, Cargo.toml, go.mod, Dockerfile, language extensions.
 */

import { readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { createHash } from 'node:crypto';
import {
  fingerprintTechnologyFact,
  type TechnologyFact,
} from '@dexnest/dev-intelligence-contracts';

export interface RawTechObservation {
  category: string;
  name: string;
  version?: string;
  evidencePath: string;
  evidenceKind: string;
}

const EXT_LANGUAGE: Record<string, string> = {
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript',
  '.js': 'JavaScript',
  '.jsx': 'JavaScript',
  '.mjs': 'JavaScript',
  '.cjs': 'JavaScript',
  '.py': 'Python',
  '.go': 'Go',
  '.rs': 'Rust',
  '.java': 'Java',
  '.kt': 'Kotlin',
  '.cs': 'C#',
  '.rb': 'Ruby',
  '.php': 'PHP',
  '.swift': 'Swift',
  '.c': 'C',
  '.cpp': 'C++',
  '.cc': 'C++',
  '.h': 'C',
  '.hpp': 'C++',
};

function parsePackageJson(content: string, evidencePath: string): RawTechObservation[] {
  const out: RawTechObservation[] = [];
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(content) as Record<string, unknown>;
  } catch {
    return out;
  }
  out.push({
    category: 'packageManager',
    name: 'npm',
    evidencePath,
    evidenceKind: 'package.json',
  });
  if (typeof json['engines'] === 'object' && json['engines']) {
    const engines = json['engines'] as Record<string, string>;
    if (engines['node']) {
      out.push({
        category: 'runtime',
        name: 'node',
        version: String(engines['node']),
        evidencePath,
        evidenceKind: 'package.json#engines',
      });
    }
  }
  const deps = {
    ...(typeof json['dependencies'] === 'object' && json['dependencies']
      ? (json['dependencies'] as Record<string, string>)
      : {}),
    ...(typeof json['devDependencies'] === 'object' && json['devDependencies']
      ? (json['devDependencies'] as Record<string, string>)
      : {}),
  };
  // Cap dependency facts — provenance retained, no XP
  const names = Object.keys(deps).sort().slice(0, 80);
  for (const name of names) {
    out.push({
      category: 'library',
      name,
      version: deps[name],
      evidencePath,
      evidenceKind: 'package.json#dependencies',
    });
  }
  if (json['packageManager'] && typeof json['packageManager'] === 'string') {
    const [pm, ver] = String(json['packageManager']).split('@');
    out.push({
      category: 'packageManager',
      name: pm || 'unknown',
      version: ver,
      evidencePath,
      evidenceKind: 'package.json#packageManager',
    });
  }
  return out;
}

function parsePyproject(content: string, evidencePath: string): RawTechObservation[] {
  const out: RawTechObservation[] = [
    {
      category: 'language',
      name: 'Python',
      evidencePath,
      evidenceKind: 'pyproject.toml',
    },
  ];
  const nameMatch = /^name\s*=\s*"([^"]+)"/m.exec(content);
  if (nameMatch) {
    out.push({
      category: 'project',
      name: nameMatch[1]!,
      evidencePath,
      evidenceKind: 'pyproject.toml#name',
    });
  }
  const requires = /^requires-python\s*=\s*"([^"]+)"/m.exec(content);
  if (requires) {
    out.push({
      category: 'runtime',
      name: 'python',
      version: requires[1],
      evidencePath,
      evidenceKind: 'pyproject.toml#requires-python',
    });
  }
  return out;
}

function parseCargo(content: string, evidencePath: string): RawTechObservation[] {
  const out: RawTechObservation[] = [
    {
      category: 'language',
      name: 'Rust',
      evidencePath,
      evidenceKind: 'Cargo.toml',
    },
  ];
  const nameMatch = /^name\s*=\s*"([^"]+)"/m.exec(content);
  if (nameMatch) {
    out.push({
      category: 'project',
      name: nameMatch[1]!,
      evidencePath,
      evidenceKind: 'Cargo.toml#package',
    });
  }
  const edition = /^edition\s*=\s*"([^"]+)"/m.exec(content);
  if (edition) {
    out.push({
      category: 'toolchain',
      name: 'rust-edition',
      version: edition[1],
      evidencePath,
      evidenceKind: 'Cargo.toml#edition',
    });
  }
  return out;
}

function parseGoMod(content: string, evidencePath: string): RawTechObservation[] {
  const out: RawTechObservation[] = [
    {
      category: 'language',
      name: 'Go',
      evidencePath,
      evidenceKind: 'go.mod',
    },
  ];
  const mod = /^module\s+(\S+)/m.exec(content);
  if (mod) {
    out.push({
      category: 'project',
      name: mod[1]!,
      evidencePath,
      evidenceKind: 'go.mod#module',
    });
  }
  const goVer = /^go\s+(\S+)/m.exec(content);
  if (goVer) {
    out.push({
      category: 'runtime',
      name: 'go',
      version: goVer[1],
      evidencePath,
      evidenceKind: 'go.mod#go',
    });
  }
  return out;
}

function parseDockerfile(content: string, evidencePath: string): RawTechObservation[] {
  const out: RawTechObservation[] = [
    {
      category: 'tooling',
      name: 'Docker',
      evidencePath,
      evidenceKind: 'Dockerfile',
    },
  ];
  const from = /^FROM\s+(\S+)/im.exec(content);
  if (from) {
    out.push({
      category: 'baseImage',
      name: from[1]!,
      evidencePath,
      evidenceKind: 'Dockerfile#FROM',
    });
  }
  return out;
}

const MANIFEST_NAMES = new Set(['package.json', 'pyproject.toml', 'cargo.toml', 'go.mod', 'dockerfile']);

function isManifest(relPath: string): boolean {
  const base = relPath.split('/').pop()?.toLowerCase() ?? '';
  return MANIFEST_NAMES.has(base) || base.startsWith('dockerfile.');
}

function sampleLanguageExtensions(files: readonly string[]): RawTechObservation[] {
  const counts = new Map<string, { count: number; sample: string }>();
  for (const rel of files) {
    const lang = EXT_LANGUAGE[extname(rel).toLowerCase()];
    if (!lang) continue;
    const cur = counts.get(lang);
    if (!cur) counts.set(lang, { count: 1, sample: rel });
    else cur.count += 1;
  }
  const out: RawTechObservation[] = [];
  for (const [name, info] of counts) {
    out.push({
      category: 'language',
      name,
      evidencePath: info.sample,
      evidenceKind: 'file-extension',
    });
  }
  return out;
}

/**
 * Technologies evidenced by `files`: repository-relative paths that have
 * already been vetted - listed by Git, outside the data boundary, really inside
 * the repository, regular files (see scanTodoCandidates' `safeFiles`).
 *
 * This used to walk the directory itself with a short list of names to skip,
 * and pointed at DexNest it reached local-data and recorded a file there as
 * evidence. It reads nothing it was not handed.
 */
export async function detectTechnologies(
  rootPath: string,
  files: readonly string[],
): Promise<RawTechObservation[]> {
  const relFiles = [...new Set(files.map((f) => f.replace(/\\/g, '/')))].sort();
  const observed: RawTechObservation[] = [];

  for (const rel of relFiles.filter(isManifest)) {
    const abs = join(rootPath, rel);
    let content: string;
    try {
      const st = await stat(abs);
      if (st.size > 512 * 1024) continue;
      content = await readFile(abs, 'utf8');
    } catch {
      continue;
    }
    const base = rel.split('/').pop()?.toLowerCase() ?? '';
    if (base === 'package.json') {
      observed.push(...parsePackageJson(content, rel));
    } else if (base === 'pyproject.toml') {
      observed.push(...parsePyproject(content, rel));
    } else if (base === 'cargo.toml') {
      observed.push(...parseCargo(content, rel));
    } else if (base === 'go.mod') {
      observed.push(...parseGoMod(content, rel));
    } else if (base === 'dockerfile' || base.startsWith('dockerfile.')) {
      observed.push(...parseDockerfile(content, rel));
    }
  }

  observed.push(...sampleLanguageExtensions(relFiles));
  return observed;
}

export function observationToFact(
  repositoryId: string,
  obs: RawTechObservation,
  now: string,
  existing?: TechnologyFact,
): TechnologyFact {
  const fingerprint = fingerprintTechnologyFact(
    obs.category,
    obs.name,
    obs.version,
    obs.evidencePath,
  );
  const id =
    existing?.id ??
    `tech_${createHash('sha256')
      .update(`${repositoryId}|${fingerprint}`)
      .digest('hex')
      .slice(0, 24)}`;
  return {
    schemaVersion: 1,
    id,
    repositoryId,
    category: obs.category,
    name: obs.name,
    version: obs.version,
    evidencePath: obs.evidencePath,
    evidenceKind: obs.evidenceKind,
    fingerprint,
    status: 'observed',
    firstObservedAt: existing?.firstObservedAt ?? now,
    lastObservedAt: now,
    observedAt: now,
    removedAt: undefined,
  };
}
