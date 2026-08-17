import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";

const execFileAsync = promisify(execFile);

function existing(paths: string[]): string[] {
  return [...new Set(paths.filter((p) => p && fs.existsSync(p)))];
}

/** Open a folder in Finder (the whole set of files). */
export async function openFolder(dir: string): Promise<void> {
  fs.mkdirSync(dir, { recursive: true });
  await execFileAsync("open", [dir]);
}

/** Select one or more files in Finder. */
export async function revealPaths(paths: string[]): Promise<void> {
  const found = existing(paths);
  if (!found.length) throw new Error("Nothing to reveal in Finder");
  if (found.length === 1) {
    await execFileAsync("open", ["-R", found[0]]);
    return;
  }
  const list = found.map((p) => `POSIX file ${JSON.stringify(p)}`).join(", ");
  const script = `tell application "Finder"\nreveal {${list}}\nactivate\nend tell`;
  await execFileAsync("osascript", ["-e", script]);
}
