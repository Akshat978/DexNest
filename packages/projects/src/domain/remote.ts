// Remote URLs: what is shown, logged and stored, what counts as the same
// repository, and which GitHub pages a project links to.
//
// A remote URL can carry a credential (`https://user:ghp_xxx@github.com/...`).
// Nothing that leaves git - the view, the event log, the journal, the database -
// ever holds one: every URL goes through stripUrlCredentials and every line of
// git output through redactCredentials.

export interface ParsedRemote {
  /** Lowercased host, e.g. `github.com`. */
  host: string;
  /** Path without leading slash and without `.git`, e.g. `owner/repo`. */
  path: string;
  hosting: "github" | "other";
  owner: string | null;
  repo: string | null;
}

const SCP_LIKE = /^([A-Za-z0-9._-]+@)?([A-Za-z0-9.-]+):(?!\/\/)(.+)$/;

/** Remove any user, password or token from a URL. Leaves scp-like `git@host:` alone (the user there is not a secret). */
export function stripUrlCredentials(url: string): string {
  const trimmed = url.trim();
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/?#]*)(.*)$/.exec(trimmed);
  if (!scheme) return trimmed;
  const [, protocol, authority, rest] = scheme;
  const at = authority.lastIndexOf("@");
  if (at < 0) return trimmed;
  const userinfo = authority.slice(0, at);
  const hostPart = authority.slice(at + 1);
  // ssh://git@host is a login name, not a secret; anything with a password, and
  // any userinfo on http(s), is treated as a credential.
  if (protocol.toLowerCase() === "ssh" && !userinfo.includes(":")) return trimmed;
  return `${protocol}://${hostPart}${rest}`;
}

/** Redact credentials inside free text, such as git's stderr. */
export function redactCredentials(text: string): string {
  return text
    .replace(/\b(https?|ftps?):\/\/[^\s/@'"]+@/gi, (_match, protocol: string) => `${protocol}://`)
    .replace(/\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, "[redacted]");
}

export function parseRemote(url: string): ParsedRemote | null {
  const clean = stripUrlCredentials(url);
  let host: string;
  let path: string;
  const withScheme = /^(https?|ssh|git):\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+)$/i.exec(clean);
  if (withScheme) {
    host = withScheme[2];
    path = withScheme[3];
  } else {
    // `D:\repos\x` is a Windows path, not `host:path`.
    if (/^[A-Za-z]:[\\/]/.test(clean)) return null;
    const scp = SCP_LIKE.exec(clean);
    if (!scp || clean.includes("://")) return null;
    host = scp[2];
    path = scp[3];
  }
  host = host.toLowerCase().replace(/^www\./, "");
  path = path.replace(/^\/+/, "").replace(/\/+$/, "").replace(/\.git$/i, "");
  if (!path || path.split("/").some((part) => part === "" || part === "." || part === "..")) return null;
  const parts = path.split("/");
  const isGithub = host === "github.com";
  return {
    host,
    path,
    hosting: isGithub ? "github" : "other",
    owner: isGithub && parts.length === 2 ? parts[0] : null,
    repo: isGithub && parts.length === 2 ? parts[1] : null
  };
}

/** A key under which two remotes are "the same repository" (case-insensitive host and path, no `.git`, any protocol). */
export function remoteIdentity(url: string): string | null {
  const parsed = parseRemote(url);
  if (parsed) return `${parsed.host}/${parsed.path.toLowerCase()}`;
  // A remote on this PC or a network share: a path, or file://path.
  const local = url.trim().replace(/^file:\/\//i, "");
  if (/^(\/|[A-Za-z]:[\\/]|\\\\)/.test(local)) {
    return `local:${local.replace(/\\/g, "/").replace(/\/+$/, "").replace(/\.git$/i, "").toLowerCase()}`;
  }
  return null;
}

function encodeRef(ref: string): string {
  return ref.split("/").map(encodeURIComponent).join("/");
}

export interface GithubLinks {
  repo: string;
  branch(branch: string): string;
  compare(base: string, head: string): string;
}

/** GitHub pages for a project, or null when the remote is not on github.com. */
export function githubLinks(remoteUrl: string | null): GithubLinks | null {
  if (!remoteUrl) return null;
  const parsed = parseRemote(remoteUrl);
  if (!parsed || parsed.hosting !== "github" || !parsed.owner || !parsed.repo) return null;
  const repo = `https://github.com/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}`;
  return {
    repo,
    branch: (branch) => `${repo}/tree/${encodeRef(branch)}`,
    compare: (base, head) => `${repo}/compare/${encodeRef(base)}...${encodeRef(head)}`
  };
}

export type CloneUrlCheck = { ok: true; url: string; parsed: ParsedRemote | null } | { ok: false; reason: string };

/**
 * Whether a pasted URL may be cloned. https and ssh (including `git@host:path`)
 * only - never git's `ext::`/`fd::` transports, never something that would read
 * as an option. Local paths are accepted only when the caller allows them
 * (tests clone from a local bare repository).
 */
export function checkCloneUrl(input: string, options: { allowLocal?: boolean } = {}): CloneUrlCheck {
  const url = input.trim();
  if (!url) return { ok: false, reason: "Paste a repository URL." };
  if (/[\s\x00-\x1f]/.test(url)) return { ok: false, reason: "That URL contains spaces or control characters." };
  if (url.startsWith("-")) return { ok: false, reason: "That is not a repository URL." };
  if (/^[A-Za-z0-9+.-]+::/.test(url)) return { ok: false, reason: "DexNest only clones over https or ssh." };
  if (/^https:\/\//i.test(url) || /^ssh:\/\//i.test(url)) {
    if (stripUrlCredentials(url) !== url) return { ok: false, reason: "Remove the username or token from the URL. Git will ask your credential manager instead." };
    const parsed = parseRemote(url);
    return parsed ? { ok: true, url, parsed } : { ok: false, reason: "That URL doesn't name a repository." };
  }
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(url)) {
    if (options.allowLocal && /^file:\/\//i.test(url)) return { ok: true, url, parsed: null };
    return { ok: false, reason: "DexNest only clones over https or ssh." };
  }
  const scp = SCP_LIKE.exec(url);
  if (scp && !/^[A-Za-z]:[\\/]/.test(url)) {
    const parsed = parseRemote(url);
    return parsed ? { ok: true, url, parsed } : { ok: false, reason: "That URL doesn't name a repository." };
  }
  if (options.allowLocal) return { ok: true, url, parsed: null };
  return { ok: false, reason: "That is not a repository URL DexNest can clone." };
}
