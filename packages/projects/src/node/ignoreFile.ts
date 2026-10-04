// The node side of "Add to .gitignore": one file, read and written whole.
// It refuses any path that is not a file called .gitignore, so nothing that
// reaches it by mistake can be read or overwritten.

import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

import type { IgnoreFilePort } from "../module/runtime.ts";

function assertIgnoreFile(file: string): void {
  if (basename(file) !== ".gitignore") throw new Error("Not a .gitignore file.");
}

export function createNodeIgnoreFile(): IgnoreFilePort {
  return {
    read(file) {
      assertIgnoreFile(file);
      try {
        return readFileSync(file, "utf8");
      } catch {
        return null;
      }
    },
    write(file, content) {
      assertIgnoreFile(file);
      writeFileSync(file, content, "utf8");
    }
  };
}
