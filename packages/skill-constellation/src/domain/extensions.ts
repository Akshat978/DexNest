/**
 * File extension -> language skill id.
 *
 * The same table Developer Intelligence's detector uses (it is not exported
 * there), expressed as catalogue ids. Used to say which language a TODO sits in.
 */

const EXTENSION_SKILL: Readonly<Record<string, string>> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.kt': 'kotlin',
  '.cs': 'csharp',
  '.rb': 'ruby',
  '.php': 'php',
  '.swift': 'swift',
  '.c': 'c',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.h': 'c',
  '.hpp': 'cpp',
};

export function languageForPath(path: string): string | undefined {
  const base = path.split('/').pop() ?? '';
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return undefined;
  return EXTENSION_SKILL[base.slice(dot).toLowerCase()];
}
