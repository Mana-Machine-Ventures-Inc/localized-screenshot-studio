import { ascRequest, type JsonApiResource } from "./client.js";
import { localeToAsc } from "./locales.js";

const EDITABLE_STATES = new Set([
  "PREPARE_FOR_SUBMISSION",
  "DEVELOPER_REJECTED",
  "REJECTED",
  "METADATA_REJECTED",
  "INVALID_BINARY",
  "WAITING_FOR_REVIEW",
  "PROCESSING_FOR_DISTRIBUTION",
]);

/** ASC platform enum we target per studio platform group. */
export type AscPlatform = "IOS" | "MAC_OS";

export interface ResolveVersionOptions {
  versionString?: string;
  platform?: AscPlatform;
}

/** Find an editable App Store version for the app (optionally by version/platform). */
export async function resolveVersionId(
  token: string,
  appId: string,
  opts: ResolveVersionOptions = {},
): Promise<string> {
  const query = opts.platform
    ? `?filter[platform]=${opts.platform}&limit=20`
    : `?limit=20`;
  const res = await ascRequest(
    token,
    "GET",
    `/v1/apps/${appId}/appStoreVersions${query}`,
  );
  const versions = (Array.isArray(res.data) ? res.data : [res.data]) as JsonApiResource<{
    versionString?: string;
    appStoreState?: string;
    platform?: string;
  }>[];

  const platformLabel = opts.platform ? ` (${opts.platform})` : "";

  if (opts.versionString) {
    const match = versions.find(
      (v) => v.attributes?.versionString === opts.versionString,
    );
    if (!match) {
      const seen = versions
        .map((v) => v.attributes?.versionString)
        .filter(Boolean)
        .join(", ");
      throw new Error(
        `Version "${opts.versionString}" not found${platformLabel}. ` +
          `Create it in App Store Connect first. Existing versions: ${seen || "none"}.`,
      );
    }
    const state = match.attributes?.appStoreState ?? "";
    if (!EDITABLE_STATES.has(state)) {
      throw new Error(
        `Version "${opts.versionString}"${platformLabel} is "${state}", which can't be edited. ` +
          `Screenshots/metadata can only be uploaded to an editable version ` +
          `(e.g. PREPARE_FOR_SUBMISSION).`,
      );
    }
    return match.id;
  }

  const editable = versions.find((v) =>
    EDITABLE_STATES.has(v.attributes?.appStoreState ?? ""),
  );
  if (editable) return editable.id;

  // No safe fallback: attaching to a live/non-editable version is exactly what
  // produces the cryptic 409 "not acceptable for the current resource state".
  const states = versions
    .map((v) => `${v.attributes?.versionString ?? "?"}=${v.attributes?.appStoreState ?? "?"}`)
    .join(", ");
  throw new Error(
    `No editable App Store version found${platformLabel}. ` +
      `Create a new version in App Store Connect (it must be in a state like ` +
      `PREPARE_FOR_SUBMISSION). Versions seen: ${states || "none"}.`,
  );
}

/** Map ASC locale -> appStoreVersionLocalization id. */
export async function listVersionLocalizations(
  token: string,
  versionId: string,
): Promise<Map<string, string>> {
  const res = await ascRequest(
    token,
    "GET",
    `/v1/appStoreVersions/${versionId}/appStoreVersionLocalizations?limit=200`,
  );
  const list = (Array.isArray(res.data) ? res.data : [res.data]) as JsonApiResource<{
    locale?: string;
  }>[];
  const map = new Map<string, string>();
  for (const loc of list) {
    if (loc.attributes?.locale) map.set(loc.attributes.locale, loc.id);
  }
  return map;
}

export async function ensureVersionLocalization(
  token: string,
  versionId: string,
  locale: string,
  existing: Map<string, string>,
): Promise<string> {
  const ascLocale = localeToAsc(locale);
  const found = existing.get(ascLocale);
  if (found) return found;

  try {
    const res = await ascRequest(token, "POST", `/v1/appStoreVersionLocalizations`, {
      data: {
        type: "appStoreVersionLocalizations",
        attributes: { locale: ascLocale },
        relationships: {
          appStoreVersion: {
            data: { type: "appStoreVersions", id: versionId },
          },
        },
      },
    });
    const created = res.data as JsonApiResource;
    existing.set(ascLocale, created.id);
    return created.id;
  } catch (err) {
    // ASC rejects locales that aren't enabled for this app/platform with a
    // cryptic 409. Translate it into something actionable.
    const msg = err instanceof Error ? err.message : String(err);
    if (/not listed for localization/i.test(msg)) {
      const note =
        ascLocale === locale ? ascLocale : `${locale} → ${ascLocale}`;
      throw new Error(
        `App Store Connect won't accept locale "${note}" for this version. ` +
          `Make sure that language is added to the app for this platform ` +
          `(App Store Connect → your app → the relevant platform → add the ` +
          `language under App Information / the version's localizations), then retry.`,
      );
    }
    throw err;
  }
}

export interface LocalizationFields {
  whatsNew?: string;
  description?: string;
  keywords?: string;
  promotionalText?: string;
  marketingUrl?: string;
  supportUrl?: string;
}

/** Read back a localization's current attributes (used to verify a PATCH). */
export async function getVersionLocalization(
  token: string,
  localizationId: string,
): Promise<LocalizationFields & { locale?: string }> {
  const res = await ascRequest(
    token,
    "GET",
    `/v1/appStoreVersionLocalizations/${localizationId}`,
  );
  const r = res.data as JsonApiResource<LocalizationFields & { locale?: string }>;
  return r.attributes ?? {};
}

export async function patchVersionLocalization(
  token: string,
  localizationId: string,
  fields: LocalizationFields,
): Promise<LocalizationFields> {
  const res = await ascRequest(
    token,
    "PATCH",
    `/v1/appStoreVersionLocalizations/${localizationId}`,
    {
      data: {
        type: "appStoreVersionLocalizations",
        id: localizationId,
        attributes: fields,
      },
    },
  );
  const r = res.data as JsonApiResource<LocalizationFields>;
  return r.attributes ?? {};
}
