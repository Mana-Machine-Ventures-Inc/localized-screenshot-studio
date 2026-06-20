import fs from "node:fs";

/**
 * Surgical, structure-preserving editor for Xcode String Catalogs
 * (`.xcstrings`). We load the raw JSON, mutate only the units we touch, and
 * re-serialize using Xcode's own formatting so diffs stay minimal and the
 * catalog keeps working when reopened in Xcode.
 *
 * Plural / device variations and comments are preserved untouched; we only
 * ever read/write the simple `stringUnit` for a given (key, locale).
 */

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
  [k: string]: unknown;
}

interface XcStringEntry {
  comment?: string;
  extractionState?: string;
  localizations?: Record<string, XcLocalization>;
  [k: string]: unknown;
}

export interface XcStringCatalog {
  sourceLanguage?: string;
  strings?: Record<string, XcStringEntry>;
  version?: string;
  [k: string]: unknown;
}

export function readCatalog(file: string): XcStringCatalog {
  const raw = fs.readFileSync(file, "utf8");
  return JSON.parse(raw) as XcStringCatalog;
}

export function writeCatalog(file: string, catalog: XcStringCatalog): void {
  fs.writeFileSync(file, serializeCatalog(catalog), "utf8");
}

/**
 * Set the simple string value for one (key, locale) pair, creating the entry
 * and localization as needed. Marks the unit `translated` (Xcode's state for
 * a human-provided value). Existing plural/device variations are left intact;
 * if a unit only had variations, we additionally add a flat stringUnit.
 */
export function setValue(
  file: string,
  key: string,
  locale: string,
  value: string,
): void {
  const cat = readCatalog(file);
  cat.strings = cat.strings ?? {};
  const entry = (cat.strings[key] = cat.strings[key] ?? {});
  entry.localizations = entry.localizations ?? {};
  const loc = (entry.localizations[locale] = entry.localizations[locale] ?? {});
  loc.stringUnit = { state: "translated", value };
  writeCatalog(file, cat);
}

/** Add a brand-new key with a source-language value. No-op if key exists. */
export function addKey(
  file: string,
  key: string,
  sourceLanguage: string,
  value: string,
  comment?: string,
): void {
  const cat = readCatalog(file);
  cat.strings = cat.strings ?? {};
  if (cat.strings[key]) {
    // Already present — just update the source value.
    setValue(file, key, sourceLanguage, value);
    return;
  }
  cat.strings[key] = {
    ...(comment ? { comment } : {}),
    extractionState: "manual",
    localizations: {
      [sourceLanguage]: { stringUnit: { state: "translated", value } },
    },
  };
  writeCatalog(file, cat);
}

/** Remove a key entirely from the catalog. */
export function removeKey(file: string, key: string): void {
  const cat = readCatalog(file);
  if (cat.strings && key in cat.strings) {
    delete cat.strings[key];
    writeCatalog(file, cat);
  }
}

/**
 * Drop a single locale's translation for a key (used to invalidate stale
 * translations so Xcode flags them as missing). Leaves the key + source intact.
 */
export function clearLocale(file: string, key: string, locale: string): void {
  const cat = readCatalog(file);
  const loc = cat.strings?.[key]?.localizations;
  if (loc && locale in loc) {
    delete loc[locale];
    writeCatalog(file, cat);
  }
}

// ---------------------------------------------------------------------------
// Xcode-style serializer: sorted keys, `"k" : v`, 2-space indent. This mirrors
// what Xcode emits, so our writes look native and re-saving in Xcode is a no-op.
// ---------------------------------------------------------------------------

export function serializeCatalog(catalog: XcStringCatalog): string {
  return serialize(catalog, 0) + "\n";
}

function serialize(value: unknown, indent: number): string {
  const pad = "  ".repeat(indent);
  const padIn = "  ".repeat(indent + 1);

  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return "[\n\n" + pad + "]";
    const items = value.map((v) => padIn + serialize(v, indent + 1));
    return "[\n" + items.join(",\n") + "\n" + pad + "]";
  }

  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  if (keys.length === 0) return "{\n\n" + pad + "}";
  const items = keys.map(
    (k) => `${padIn}${JSON.stringify(k)} : ${serialize(obj[k], indent + 1)}`,
  );
  return "{\n" + items.join(",\n") + "\n" + pad + "}";
}
