import fs from "node:fs";
import path from "node:path";

/**
 * Surgical editor for legacy `.strings` files. We edit the specific
 * `"key" = "value";` line in place (preserving comments / ordering) and append
 * when the key is absent. One file holds a single locale, so callers resolve
 * the per-locale path with {@link localeFile}.
 */

function escapeValue(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Derive the file path for another locale from a representative `.strings` path. */
export function localeFile(representative: string, locale: string): string {
  const parts = representative.split(path.sep);
  for (let i = 0; i < parts.length; i++) {
    if (/\.lproj$/.test(parts[i])) {
      parts[i] = `${locale}.lproj`;
      return parts.join(path.sep);
    }
  }
  return representative;
}

export function setValue(file: string, key: string, value: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let raw = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const ek = escapeValue(key);
  const re = new RegExp(
    `("${escapeRegExp(ek)}"\\s*=\\s*")(?:[^"\\\\]|\\\\.)*("\\s*;)`,
  );
  if (re.test(raw)) {
    raw = raw.replace(re, (_m, p1: string, p3: string) => p1 + escapeValue(value) + p3);
  } else {
    if (raw.length && !raw.endsWith("\n")) raw += "\n";
    raw += `"${ek}" = "${escapeValue(value)}";\n`;
  }
  fs.writeFileSync(file, raw, "utf8");
}

export function removeKey(file: string, key: string): void {
  if (!fs.existsSync(file)) return;
  let raw = fs.readFileSync(file, "utf8");
  const ek = escapeValue(key);
  const re = new RegExp(
    `^[ \\t]*"${escapeRegExp(ek)}"\\s*=\\s*"(?:[^"\\\\]|\\\\.)*"\\s*;[ \\t]*\\r?\\n?`,
    "m",
  );
  const next = raw.replace(re, "");
  if (next !== raw) fs.writeFileSync(file, next, "utf8");
}
