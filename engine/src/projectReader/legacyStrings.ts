import fs from "node:fs";
import path from "node:path";

/** Parse a legacy `.strings` file into key -> value. */
export function parseStringsFile(filePath: string): Record<string, string> {
  const raw = fs.readFileSync(filePath, "utf8");
  const out: Record<string, string> = {};
  // Matches: "key" = "value"; with escaped quotes inside.
  const re = /"((?:[^"\\]|\\.)*)"\s*=\s*"((?:[^"\\]|\\.)*)"\s*;/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const key = unescape(m[1]);
    const value = unescape(m[2]);
    out[key] = value;
  }
  return out;
}

function unescape(s: string): string {
  return s
    .replace(/\\"/g, '"')
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\\\/g, "\\");
}

/** Derive the locale from a `<locale>.lproj` path component. */
export function localeFromLprojPath(filePath: string): string | undefined {
  const parts = filePath.split(path.sep);
  for (const part of parts) {
    const match = part.match(/^([A-Za-z0-9_-]+)\.lproj$/);
    if (match) return match[1] === "Base" ? undefined : match[1];
  }
  return undefined;
}
