import fs from "node:fs";
import type { LocalizedString } from "../types.js";

interface XcStringUnit {
  state?: string;
  value?: string;
}

interface XcLocalization {
  stringUnit?: XcStringUnit;
  variations?: {
    plural?: Record<string, { stringUnit?: XcStringUnit }>;
    device?: Record<string, { stringUnit?: XcStringUnit }>;
  };
}

interface XcStringEntry {
  comment?: string;
  extractionState?: string;
  localizations?: Record<string, XcLocalization>;
}

interface XcStringCatalog {
  sourceLanguage?: string;
  strings?: Record<string, XcStringEntry>;
  version?: string;
}

function resolveValue(
  loc: XcLocalization | undefined,
  key: string,
): string | undefined {
  if (!loc) return undefined;
  if (loc.stringUnit?.value !== undefined) return loc.stringUnit.value;
  // fall back to the "other" plural variation if present
  const other = loc.variations?.plural?.other?.stringUnit?.value;
  if (other !== undefined) return other;
  return undefined;
}

export interface XcStringsResult {
  sourceLanguage: string;
  locales: string[];
  strings: LocalizedString[];
}

/** Parse a `.xcstrings` String Catalog into our locale -> key -> value model. */
export function parseXcStrings(filePath: string): XcStringsResult {
  const raw = fs.readFileSync(filePath, "utf8");
  const catalog = JSON.parse(raw) as XcStringCatalog;
  const sourceLanguage = catalog.sourceLanguage ?? "en";
  const locales = new Set<string>([sourceLanguage]);
  const strings: LocalizedString[] = [];

  for (const [key, entry] of Object.entries(catalog.strings ?? {})) {
    const values: Record<string, string> = {};
    const localizations = entry.localizations ?? {};
    for (const [locale, loc] of Object.entries(localizations)) {
      const value = resolveValue(loc, key);
      if (value !== undefined) {
        values[locale] = value;
        locales.add(locale);
      }
    }
    // String Catalogs leave the source language implicit (the key IS the value).
    if (values[sourceLanguage] === undefined) values[sourceLanguage] = key;
    strings.push({ key, values, comment: entry.comment });
  }

  return { sourceLanguage, locales: [...locales], strings };
}
