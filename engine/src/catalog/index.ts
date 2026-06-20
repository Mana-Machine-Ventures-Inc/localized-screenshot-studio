import * as xc from "../projectReader/xcstringsWriter.js";
import * as legacy from "../projectReader/legacyWriter.js";
import type { CatalogRef, ProjectData } from "../types.js";

/**
 * Writes string edits back into the project's source-of-truth localization
 * files (`.xcstrings` / `.strings`), routing each key to the catalog it came
 * from. Provenance lives on {@link ProjectData.catalogIndex}, recomputed on
 * every project read.
 */

function refFor(data: ProjectData, key: string): CatalogRef | undefined {
  return data.catalogIndex?.[key];
}

/** Where a brand-new key should be created. Prefers a String Catalog. */
function homeForNewKey(data: ProjectData): CatalogRef | undefined {
  if (data.defaultCatalog) return { kind: "xcstrings", file: data.defaultCatalog };
  if (data.defaultStringsFile)
    return { kind: "strings", file: data.defaultStringsFile };
  return undefined;
}

/** True when this project exposes at least one writable catalog. */
export function canWrite(data: ProjectData | null): boolean {
  if (!data) return false;
  return Boolean(
    data.defaultCatalog ||
      data.defaultStringsFile ||
      (data.catalogIndex && Object.keys(data.catalogIndex).length > 0),
  );
}

/** Human-readable description of where edits are written. */
export function catalogLabel(data: ProjectData | null): string | undefined {
  if (!data) return undefined;
  const home = homeForNewKey(data);
  if (!home) return undefined;
  const name = home.file.split("/").pop();
  return name;
}

export function setValue(
  data: ProjectData,
  key: string,
  locale: string,
  value: string,
): boolean {
  const ref = refFor(data, key) ?? homeForNewKey(data);
  if (!ref) return false;
  if (ref.kind === "xcstrings") {
    xc.setValue(ref.file, key, locale, value);
  } else {
    legacy.setValue(legacy.localeFile(ref.file, locale), key, value);
  }
  // Remember provenance for keys we just created on the fly.
  data.catalogIndex ??= {};
  data.catalogIndex[key] ??= ref;
  return true;
}

export function clearLocale(
  data: ProjectData,
  key: string,
  locale: string,
): boolean {
  const ref = refFor(data, key);
  if (!ref) return false;
  if (ref.kind === "xcstrings") {
    xc.clearLocale(ref.file, key, locale);
  } else {
    legacy.removeKey(legacy.localeFile(ref.file, locale), key);
  }
  return true;
}

export function addKey(
  data: ProjectData,
  key: string,
  sourceLanguage: string,
  value: string,
  comment?: string,
): boolean {
  const ref = refFor(data, key) ?? homeForNewKey(data);
  if (!ref) return false;
  if (ref.kind === "xcstrings") {
    xc.addKey(ref.file, key, sourceLanguage, value, comment);
  } else {
    legacy.setValue(legacy.localeFile(ref.file, sourceLanguage), key, value);
  }
  data.catalogIndex ??= {};
  data.catalogIndex[key] = ref;
  return true;
}

export function removeKey(data: ProjectData, key: string): boolean {
  const ref = refFor(data, key);
  if (!ref) return false;
  if (ref.kind === "xcstrings") {
    xc.removeKey(ref.file, key);
  } else {
    // Remove from every known locale file.
    for (const locale of data.locales) {
      legacy.removeKey(legacy.localeFile(ref.file, locale), key);
    }
  }
  if (data.catalogIndex) delete data.catalogIndex[key];
  return true;
}
