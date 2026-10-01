// The node side of the add-project inspector: read-only, top-level, small.

import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";

import type { InspectFsPort } from "../inspect/inspect.ts";

export function createNodeInspectFs(): InspectFsPort {
  return {
    realpath(path) {
      return realpathSync.native(path);
    },
    kind(path) {
      try {
        return statSync(path).isDirectory() ? "dir" : "file";
      } catch {
        return "missing";
      }
    },
    list(path, limit) {
      try {
        return readdirSync(path).slice(0, limit);
      } catch {
        return [];
      }
    },
    readText(path, maxBytes) {
      try {
        const stat = statSync(path);
        if (!stat.isFile() || stat.size > maxBytes) return null;
        return readFileSync(path, "utf8");
      } catch {
        return null;
      }
    }
  };
}
