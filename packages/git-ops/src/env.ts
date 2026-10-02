// The environment every mutating git command runs with, and how its failures
// are put into plain words.
//
// Nothing may prompt: no terminal prompt, no credential-manager window, no
// askpass helper, no editor, no ssh passphrase prompt. If git needs any of
// those, the command fails, and the failure is reported as "authentication
// needed - open a terminal here" so the owner can do it themselves.

import { redactCredentials, type FailureCode } from "@dexnest/projects";

export type { FailureCode };

export function mutatingEnv(options: { overrideSsh: boolean }): Record<string, string> {
  const env: Record<string, string> = {
    GIT_TERMINAL_PROMPT: "0",
    GCM_INTERACTIVE: "never",
    GIT_ASKPASS: "",
    SSH_ASKPASS: "",
    SSH_ASKPASS_REQUIRE: "never",
    GIT_EDITOR: ":",
    GIT_SEQUENCE_EDITOR: ":",
    GIT_MERGE_AUTOEDIT: "no",
    GIT_PAGER: "cat",
    PAGER: "cat",
    LC_ALL: "C",
    GIT_ALLOW_PROTOCOL: "https:ssh:git:file"
  };
  // Only when the owner hasn't configured ssh themselves (core.sshCommand, GIT_SSH, GIT_SSH_COMMAND).
  if (options.overrideSsh) env.GIT_SSH_COMMAND = "ssh -o BatchMode=yes";
  return env;
}

export interface Failure {
  code: FailureCode;
  message: string;
}

const RULES: ReadonlyArray<[RegExp, FailureCode, string]> = [
  [
    /authentication failed|could not read (username|password)|terminal prompts disabled|permission denied \(publickey|host key verification failed|user cancelled|missing or invalid credentials|returned error: 40[13]|invalid username or password|support for password authentication was removed/i,
    "auth_needed",
    "Authentication needed - open a terminal here and run the command once yourself."
  ],
  [
    /could not resolve host|connection timed out|connection refused|network is unreachable|failed to connect|could not read from remote repository/i,
    "offline",
    "Couldn't reach the remote. Check the connection and try again."
  ],
  [
    /not possible to fast-forward|diverging branches can't be fast-forwarded/i,
    "not_fast_forward",
    "Can't fast-forward: your branch and the remote have diverged. Nothing was changed - open a terminal to reconcile them."
  ],
  [
    /\[rejected\]|non-fast-forward|fetch first|updates were rejected/i,
    "rejected",
    "The remote has commits you don't have. Nothing was overwritten - pull first."
  ],
  [
    /would be overwritten|please commit your changes or stash them/i,
    "local_changes",
    "Your uncommitted changes touch the same files. Nothing was changed - commit or stash them first."
  ],
  [
    /index\.lock|unable to create '.*\.lock'|another git process seems to be running/i,
    "locked",
    "Another git process is using this repository (index.lock). If none is running, the lock was left by a crash; DexNest won't delete it - remove it yourself once you're sure."
  ],
  [/hook (declined|failed)|pre-commit|pre-push|commit-msg/i, "hook_failed", "A git hook in this repository stopped the operation. Its output is below."],
  [/conflict/i, "conflict", "Stopped with conflicts. Resolve them in your editor; nothing was lost."],
  [/nothing to commit|no changes added to commit/i, "nothing_to_commit", "There was nothing to commit."]
];

export function classifyFailure(stderr: string, stdout = ""): Failure {
  const text = `${stderr}\n${stdout}`;
  for (const [pattern, code, message] of RULES) if (pattern.test(text)) return { code, message };
  const first = redactCredentials(stderr).split(/\r?\n/).map((l) => l.replace(/^(fatal|error):\s*/i, "").trim()).find(Boolean);
  return { code: "failed", message: first ? `Git said: ${first}` : "Git failed without saying why." };
}
