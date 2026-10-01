// A hook, not a feature. GitHub API data (pull requests, CI status, issues)
// is out of scope for this build: nothing here is implemented and nothing in
// DexNest calls the GitHub API.
//
// If it is ever added, it is an explicit opt-in that goes through the
// locally logged-in `gh` CLI (argv allowlist, no tokens handled by DexNest),
// is off by default, runs only when the owner asks, and is logged like every
// other operation. The Branches table keeps a hidden "PR" column for it.

import type { Project } from "./project.ts";

export interface PullRequestSummary {
  number: number;
  title: string;
  state: "open" | "closed" | "merged" | "draft";
  url: string;
}

export interface RemoteHostingPort {
  /** Pull requests whose head is `branch`. */
  pullRequestsForBranch(project: Project, branch: string): Promise<PullRequestSummary[]>;
}
