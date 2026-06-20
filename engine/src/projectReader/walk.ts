import fs from "node:fs";
import path from "node:path";

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".lss",
  "Pods",
  "Carthage",
  "build",
  "Build",
  "DerivedData",
  ".build",
  "dist",
  "vendor",
]);

export interface WalkOptions {
  maxDepth?: number;
  /** match a file (full path) -> include in results */
  match: (fullPath: string) => boolean;
  /** match a directory name -> treat the whole dir as a single result (don't recurse) */
  matchDir?: (fullPath: string) => boolean;
}

/** Bounded recursive walk that skips build artefacts and dependency dirs. */
export function walk(root: string, opts: WalkOptions): string[] {
  const results: string[] = [];
  const maxDepth = opts.maxDepth ?? 8;

  const visit = (dir: string, depth: number) => {
    if (depth > maxDepth) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        if (opts.matchDir?.(full)) {
          results.push(full);
          continue;
        }
        visit(full, depth + 1);
      } else if (entry.isFile()) {
        if (opts.match(full)) results.push(full);
      }
    }
  };

  visit(root, 0);
  return results;
}
