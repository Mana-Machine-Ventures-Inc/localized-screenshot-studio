import fs from "node:fs";
import path from "node:path";
import { walk } from "./walk.js";
import { parseXcStrings } from "./xcstrings.js";
import { localeFromLprojPath, parseStringsFile } from "./legacyStrings.js";
import { readDesignTokens } from "./assets.js";
import type { LocalizedString, ProjectData } from "../types.js";

/** Resolve the directory that contains the actual sources for an .xcodeproj/.xcworkspace. */
export function resolveProjectRoot(input: string): string {
  let p = input;
  if (p.endsWith(".xcodeproj") || p.endsWith(".xcworkspace")) {
    p = path.dirname(p);
  }
  const stat = fs.statSync(p);
  return stat.isDirectory() ? p : path.dirname(p);
}

interface ProjectMeta {
  appName: string;
  bundleId?: string;
  marketingVersion?: string;
  buildNumber?: string;
}

function readAppName(root: string): ProjectMeta {
  // Try project.pbxproj for PRODUCT_NAME / PRODUCT_BUNDLE_IDENTIFIER and the
  // marketing version (CFBundleShortVersionString) + build (CFBundleVersion).
  const pbxprojs = walk(root, {
    match: (p) => p.endsWith("project.pbxproj"),
    maxDepth: 3,
  });
  let appName = path.basename(root);
  let bundleId: string | undefined;
  let marketingVersion: string | undefined;
  let buildNumber: string | undefined;
  const literal = (v?: string) =>
    v && !v.includes("$(") ? v.trim() : undefined;
  for (const file of pbxprojs) {
    try {
      const text = fs.readFileSync(file, "utf8");
      const nameMatch = text.match(/PRODUCT_NAME\s*=\s*"?([^";]+)"?;/);
      if (nameMatch && nameMatch[1] !== "$(TARGET_NAME)") {
        appName = nameMatch[1].trim();
      }
      const bundleMatch = text.match(
        /PRODUCT_BUNDLE_IDENTIFIER\s*=\s*"?([^";]+)"?;/,
      );
      if (bundleMatch) bundleId = bundleId ?? bundleMatch[1].trim();
      const verMatch = text.match(/MARKETING_VERSION\s*=\s*"?([^";]+)"?;/);
      marketingVersion = marketingVersion ?? literal(verMatch?.[1]);
      const buildMatch = text.match(
        /CURRENT_PROJECT_VERSION\s*=\s*"?([^";]+)"?;/,
      );
      buildNumber = buildNumber ?? literal(buildMatch?.[1]);
    } catch {
      // ignore
    }
  }
  return { appName, bundleId, marketingVersion, buildNumber };
}

function mergeLegacyStrings(
  root: string,
  strings: LocalizedString[],
  locales: Set<string>,
): void {
  const stringsFiles = walk(root, {
    match: (p) => /Localizable\.strings$/i.test(p),
    maxDepth: 8,
  });
  const byKey = new Map<string, LocalizedString>();
  for (const s of strings) byKey.set(s.key, s);

  for (const file of stringsFiles) {
    const locale = localeFromLprojPath(file);
    if (!locale) continue;
    locales.add(locale);
    const pairs = parseStringsFile(file);
    for (const [key, value] of Object.entries(pairs)) {
      let entry = byKey.get(key);
      if (!entry) {
        entry = { key, values: {} };
        byKey.set(key, entry);
        strings.push(entry);
      }
      if (entry.values[locale] === undefined) entry.values[locale] = value;
    }
  }
}

/**
 * Locate release notes across common conventions:
 *  - fastlane/metadata/<locale>/release_notes.txt
 *  - metadata/<locale>/release_notes.txt
 *  - ReleaseNotes/<locale>.txt | <locale>.md
 */
function readReleaseNotes(root: string): Record<string, string> {
  const notes: Record<string, string> = {};

  const metadataDirs = [
    path.join(root, "fastlane", "metadata"),
    path.join(root, "metadata"),
  ];
  for (const base of metadataDirs) {
    if (!fs.existsSync(base)) continue;
    for (const locale of safeReaddir(base)) {
      for (const name of ["release_notes.txt", "whats_new.txt"]) {
        const file = path.join(base, locale, name);
        if (fs.existsSync(file)) notes[locale] ??= read(file);
      }
    }
  }

  const rnDir = path.join(root, "ReleaseNotes");
  if (fs.existsSync(rnDir)) {
    for (const f of safeReaddir(rnDir)) {
      const m = f.match(/^([A-Za-z0-9_-]+)\.(txt|md)$/);
      if (m) notes[m[1]] ??= read(path.join(rnDir, f));
    }
  }

  return notes;
}

function safeReaddir(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function read(file: string): string {
  return fs.readFileSync(file, "utf8").trim();
}

/** Read everything we need from an Xcode project directory. */
export function readProject(input: string): ProjectData {
  const root = resolveProjectRoot(input);
  if (!fs.existsSync(root)) {
    throw new Error(`Project path does not exist: ${root}`);
  }

  const { appName, bundleId, marketingVersion, buildNumber } = readAppName(root);

  // String Catalogs first (preferred), then merge any legacy .strings.
  const xcstringsFiles = walk(root, {
    match: (p) => p.endsWith(".xcstrings"),
    maxDepth: 8,
  });

  const locales = new Set<string>();
  const strings: LocalizedString[] = [];
  let baseLocale = "en";

  for (const file of xcstringsFiles) {
    try {
      const parsed = parseXcStrings(file);
      baseLocale = parsed.sourceLanguage || baseLocale;
      for (const l of parsed.locales) locales.add(l);
      const byKey = new Map(strings.map((s) => [s.key, s]));
      for (const s of parsed.strings) {
        const existing = byKey.get(s.key);
        if (existing) Object.assign(existing.values, s.values);
        else strings.push(s);
      }
    } catch {
      // ignore malformed catalogs
    }
  }

  mergeLegacyStrings(root, strings, locales);

  if (locales.size === 0) locales.add(baseLocale);

  const tokens = readDesignTokens(root);
  const releaseNotes = readReleaseNotes(root);

  return {
    projectPath: root,
    appName,
    bundleId,
    marketingVersion,
    buildNumber,
    locales: [...locales].sort(),
    baseLocale,
    strings,
    releaseNotes,
    tokens,
  };
}
