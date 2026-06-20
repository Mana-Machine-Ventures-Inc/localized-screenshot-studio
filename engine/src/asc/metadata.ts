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

  if (opts.versionString) {
    const match = versions.find(
      (v) => v.attributes?.versionString === opts.versionString,
    );
    if (match) return match.id;
  }
  const editable = versions.find((v) =>
    EDITABLE_STATES.has(v.attributes?.appStoreState ?? ""),
  );
  if (editable) return editable.id;
  if (versions[0]) return versions[0].id;
  throw new Error(
    `No App Store version found for app${opts.platform ? ` (${opts.platform})` : ""}`,
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
}

export interface LocalizationFields {
  whatsNew?: string;
  description?: string;
  keywords?: string;
  promotionalText?: string;
  marketingUrl?: string;
  supportUrl?: string;
}

export async function patchVersionLocalization(
  token: string,
  localizationId: string,
  fields: LocalizationFields,
): Promise<void> {
  await ascRequest(
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
}
