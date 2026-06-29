import fs from "node:fs";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { store } from "../store.js";
import { getPreset } from "../capture/presets.js";
import { createAscToken } from "./jwt.js";
import { loadCredentials } from "./credentials.js";
import { localeToAsc } from "./locales.js";
import {
  ensureVersionLocalization,
  getVersionLocalization,
  listVersionLocalizations,
  patchVersionLocalization,
  resolveVersionId,
  type AscPlatform,
} from "./metadata.js";
import {
  commitScreenshot,
  deleteScreenshot,
  ensureScreenshotSet,
  listScreenshotsInSet,
  pollScreenshot,
  reserveScreenshot,
  uploadScreenshotParts,
} from "./screenshots.js";
import type {
  AssetCell,
  PlatformMetadata,
  StorePlatform,
  UploadJob,
  UploadJobItem,
  UploadKind,
} from "../types.js";

/** Studio platform group for a device preset (iPhone+iPad => iOS). */
function storePlatformForPreset(presetId: string): StorePlatform {
  return getPreset(presetId).platform === "macos" ? "macos" : "ios";
}

function ascPlatform(group: StorePlatform): AscPlatform {
  return group === "macos" ? "MAC_OS" : "IOS";
}

/** Resolve the description + what's-new copy for a platform/locale from config. */
function resolveMetaFields(
  platform: StorePlatform,
  locale: string,
): { description?: string; whatsNew?: string } {
  const cfg = store.getConfig();
  const data = store.getData();
  const base = cfg.baseLocale;
  const m: PlatformMetadata | undefined = cfg.metadata?.[platform];
  const resolve = (key?: string) =>
    key
      ? store.resolveString(key, locale) ?? store.resolveString(key, base)
      : undefined;
  const description = resolve(m?.descriptionKey);
  let whatsNew = resolve(m?.whatsNewKey);
  if (!whatsNew) {
    whatsNew = data?.releaseNotes?.[locale] ?? data?.releaseNotes?.[base];
  }
  return {
    description: description?.trim() || undefined,
    whatsNew: whatsNew?.trim() || undefined,
  };
}

/** Which platforms should receive metadata: configured ones, else inferred. */
function metadataPlatforms(): StorePlatform[] {
  const cfg = store.getConfig();
  const md = cfg.metadata ?? {};
  const hasKeys = (m?: PlatformMetadata) =>
    Boolean(m?.descriptionKey || m?.whatsNewKey);
  const configured: StorePlatform[] = [];
  if (hasKeys(md.ios)) configured.push("ios");
  if (hasKeys(md.macos)) configured.push("macos");
  if (configured.length) return configured;

  const inferred = new Set<StorePlatform>();
  for (const screen of cfg.screens) {
    const presetIds = screen.presetIds.length ? screen.presetIds : cfg.presetIds;
    for (const pid of presetIds) inferred.add(storePlatformForPreset(pid));
  }
  return inferred.size ? [...inferred] : ["ios"];
}

const jobs = new Map<string, UploadJob>();
const emitters = new Map<string, EventEmitter>();

export function getJob(id: string): UploadJob | undefined {
  return jobs.get(id);
}

export function jobEmitter(id: string): EventEmitter | undefined {
  return emitters.get(id);
}

/**
 * Request cancellation of a running job. The current in-flight item finishes
 * (network calls can't be aborted mid-stream), then the run stops and any
 * remaining items are left pending.
 */
export function cancelUploadJob(id: string): UploadJob | undefined {
  const job = jobs.get(id);
  if (!job || job.done) return job;
  job.cancelled = true;
  emit(job, "cancelling", { id });
  return job;
}

async function withRetry<T>(
  fn: () => Promise<T>,
  attempts: number,
  onAttempt?: (n: number, err: unknown) => void,
  shouldAbort?: () => boolean,
): Promise<T> {
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      onAttempt?.(i, err);
      // Stop burning retries (and their backoff) once cancellation is asked for.
      if (shouldAbort?.()) break;
      if (i < attempts) {
        const delay = Math.min(15000, 500 * 2 ** (i - 1));
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}

export interface CreateJobOptions {
  kind: UploadKind;
  /** force dry-run even if credentials exist (preview the pipeline safely). */
  dryRun?: boolean;
  /** restrict to a subset of cells (e.g. retry only failed). */
  cellIds?: string[];
  /** restrict to specific locales (per-language uploads). */
  locales?: string[];
  /** restrict to specific device presets (per-device uploads). */
  presetIds?: string[];
  /** delete a set's existing screenshots before uploading (default true). */
  replace?: boolean;
  /** only clear sets — delete existing screenshots and upload nothing. */
  clearOnly?: boolean;
}

function buildItems(opts: CreateJobOptions): UploadJobItem[] {
  const cfg = store.getConfig();
  const data = store.getData();
  const items: UploadJobItem[] = [];

  if (opts.kind === "screenshots" || opts.kind === "both") {
    const replace = opts.clearOnly ? true : opts.replace !== false;
    const screenOrder = new Map(cfg.screens.map((s, i) => [s.id, i]));

    const cells = cfg.cells.filter((c) => {
      if (opts.cellIds && !opts.cellIds.includes(c.id)) return false;
      if (opts.locales && !opts.locales.includes(c.locale)) return false;
      if (opts.presetIds && !opts.presetIds.includes(c.presetId)) return false;
      return Boolean(c.composedPath) && fsExists(c.composedPath);
    });

    // One App Store Connect set = (locale × display type). Group cells into
    // sets so we can delete the set's existing screenshots, then upload its
    // screens in screen order — per device, in isolation.
    type SetGroup = {
      locale: string;
      platform: StorePlatform;
      displayType: string;
      presetId: string;
      cells: AssetCell[];
    };
    const groups = new Map<string, SetGroup>();
    for (const c of cells) {
      const preset = getPreset(c.presetId);
      const key = `${c.locale}::${preset.ascDisplayType}`;
      let g = groups.get(key);
      if (!g) {
        g = {
          locale: c.locale,
          platform: storePlatformForPreset(c.presetId),
          displayType: preset.ascDisplayType,
          presetId: c.presetId,
          cells: [],
        };
        groups.set(key, g);
      }
      g.cells.push(c);
    }

    for (const g of groups.values()) {
      g.cells.sort(
        (a, b) =>
          (screenOrder.get(a.screenId) ?? 0) - (screenOrder.get(b.screenId) ?? 0),
      );
      if (replace) {
        items.push({
          locale: g.locale,
          platform: g.platform,
          presetId: g.presetId,
          displayType: g.displayType,
          kind: "clear",
          state: "pending",
          attempts: 0,
        });
      }
      if (opts.clearOnly) continue;
      for (const c of g.cells) {
        items.push({
          cellId: c.id,
          locale: c.locale,
          presetId: c.presetId,
          platform: g.platform,
          displayType: g.displayType,
          kind: "screenshot",
          state: "pending",
          attempts: 0,
        });
      }
    }
  }

  if (!opts.clearOnly && (opts.kind === "metadata" || opts.kind === "both")) {
    const locales = opts.locales ?? data?.locales ?? [cfg.baseLocale];
    // When the caller targets specific locales (the per-language button), emit
    // an item even if nothing resolves, so the readout explains *why* it was
    // empty. For a broad "all languages" run, skip locales with no metadata.
    const targeted = Boolean(opts.locales);
    for (const platform of metadataPlatforms()) {
      for (const locale of locales) {
        if (!targeted) {
          const fields = resolveMetaFields(platform, locale);
          if (!fields.description && !fields.whatsNew) continue;
        }
        items.push({
          locale,
          platform,
          kind: "metadata",
          state: "pending",
          attempts: 0,
        });
      }
    }
  }

  return items;
}

function fsExists(p?: string): boolean {
  return Boolean(p && fs.existsSync(p));
}

export function createUploadJob(opts: CreateJobOptions): UploadJob {
  const hasCreds = loadCredentials() !== null;
  const dryRun = opts.dryRun ?? !hasCreds;
  const job: UploadJob = {
    id: randomUUID(),
    kind: opts.kind,
    dryRun,
    createdAt: new Date().toISOString(),
    items: buildItems(opts),
    done: false,
  };
  jobs.set(job.id, job);
  emitters.set(job.id, new EventEmitter());
  return job;
}

function emit(job: UploadJob, event: string, payload: unknown): void {
  emitters.get(job.id)?.emit("event", { event, payload });
}

function setItem(job: UploadJob, item: UploadJobItem): void {
  emit(job, "item", item);
}

function updateCell(cellId: string, patch: Partial<AssetCell>): void {
  const cell = store.getCell(cellId);
  if (!cell) return;
  store.upsertCell({ ...cell, ...patch, updatedAt: new Date().toISOString() });
}

/** Human-readable message from any thrown value (drops the "Error:" prefix). */
function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/** Run an upload job to completion. Resolves when all items are done. */
export async function runUploadJob(jobId: string): Promise<UploadJob> {
  const job = jobs.get(jobId);
  if (!job) throw new Error(`Unknown job: ${jobId}`);

  try {
    if (job.dryRun) {
      await runDryRun(job);
      finishJob(job);
      return job;
    }
    await runRealUpload(job);
    finishJob(job);
    return job;
  } catch (err) {
    // Top-level failure (auth, version lookup, etc.) — record it on the job so
    // the UI can explain why nothing uploaded, instead of hanging silently.
    job.error = errMsg(err);
    finishJob(job);
    return job;
  }
}

async function runRealUpload(job: UploadJob): Promise<void> {
  const creds = loadCredentials();
  if (!creds) throw new Error("No App Store Connect credentials configured");

  const token = await createAscToken(creds);
  const setCache = new Map<string, string>();

  // App Store versions are per-platform, so resolve + cache one context each.
  const ctxCache = new Map<AscPlatform, PlatformCtx>();
  const ctxFor = async (platform: AscPlatform): Promise<PlatformCtx> => {
    let ctx = ctxCache.get(platform);
    if (!ctx) {
      const versionId = await resolveVersionId(token, creds.appId, {
        versionString: creds.versionString,
        platform,
      });
      const locIds = await listVersionLocalizations(token, versionId);
      ctx = { versionId, locIds };
      ctxCache.set(platform, ctx);
    }
    return ctx;
  };

  const aborted = () => job.cancelled === true;

  for (const item of job.items) {
    if (aborted()) break;
    item.state = "uploading";
    item.attempts += 1;
    item.error = undefined;
    setItem(job, item);
    if (item.cellId) updateCell(item.cellId, { state: "uploading" });

    try {
      if (item.kind === "clear") {
        const group = item.platform ?? "ios";
        const ctx = await ctxFor(ascPlatform(group));
        await withRetry(
          () =>
            clearScreenshotSet(token, ctx, setCache, item.locale, item.displayType ?? ""),
          3,
          (n, err) => emit(job, "retry", { item, n, error: errMsg(err) }),
          aborted,
        );
        // The set's screens are gone from App Store Connect — forget them.
        store.clearUploadsForSet(item.locale, item.displayType ?? "");
      } else if (item.kind === "metadata") {
        const group = item.platform ?? "ios";
        const ctx = await ctxFor(ascPlatform(group));
        const result = await withRetry(
          () => uploadMetadata(token, ctx, item.locale, group),
          3,
          (n, err) => emit(job, "retry", { item, n, error: errMsg(err) }),
          aborted,
        );
        item.note = result.note;
        item.log = result.log;
      } else if (item.cellId) {
        const group = item.platform ?? storePlatformForPreset(item.presetId ?? "");
        const ctx = await ctxFor(ascPlatform(group));
        await withRetry(
          () => uploadScreenshotCell(token, ctx, setCache, item.cellId!),
          3,
          (n, err) => emit(job, "retry", { item, n, error: errMsg(err) }),
          aborted,
        );
        recordCellUpload(item, group);
      }
      item.state = "verified";
      if (item.cellId) updateCell(item.cellId, { state: "verified", lastError: undefined });
    } catch (err) {
      item.state = "failed";
      item.error = errMsg(err);
      if (item.cellId) updateCell(item.cellId, { state: "failed", lastError: errMsg(err) });
    }
    setItem(job, item);
  }
}

/** Record a verified screenshot upload in the ledger, tagged with the binary. */
function recordCellUpload(item: UploadJobItem, group: StorePlatform): void {
  if (!item.cellId) return;
  const data = store.getData();
  const cell = store.getCell(item.cellId);
  store.recordUpload({
    cellId: item.cellId,
    locale: item.locale,
    presetId: item.presetId ?? cell?.presetId ?? "",
    displayType: item.displayType ?? "",
    platform: group,
    version: data?.marketingVersion,
    build: data?.buildNumber,
    ascScreenshotId: cell?.ascScreenshotId,
    uploadedAt: new Date().toISOString(),
  });
}

/** Mark a job complete and notify listeners with the final state. */
function finishJob(job: UploadJob): void {
  job.done = true;
  // Send a full snapshot so the UI reflects final item states + cancelled flag,
  // then a terminal "done" event to close the stream.
  emit(job, "snapshot", job);
  emit(job, "done", { id: job.id, cancelled: job.cancelled === true });
}

interface PlatformCtx {
  versionId: string;
  locIds: Map<string, string>;
}

interface MetaResult {
  note?: string;
  log: string[];
}

/** Short, log-safe preview of a possibly-long string value. */
function preview(s?: string): string {
  if (s == null) return "(empty)";
  const flat = s.replace(/\r\n/g, "\n");
  const shown = flat.length > 160 ? `${flat.slice(0, 160)}…` : flat;
  return `${flat.length} chars ${JSON.stringify(shown)}`;
}

/**
 * Push description + What's New for one (platform, locale) and verify the
 * change actually stuck. Returns a non-fatal warning plus a full trace of what
 * we resolved, posted, and received — so a "doesn't take" can be diagnosed.
 */
async function uploadMetadata(
  token: string,
  ctx: PlatformCtx,
  locale: string,
  platform: StorePlatform,
): Promise<MetaResult> {
  const log: string[] = [];
  const cfg = store.getConfig();
  const m = cfg.metadata?.[platform];
  const base = cfg.baseLocale;
  const ascLoc = localeToAsc(locale);

  log.push(`platform=${platform} · version=${ctx.versionId}`);
  log.push(`locale=${locale}${ascLoc !== locale ? ` → ASC ${ascLoc}` : ""}`);
  log.push(
    `mapped keys: description=${m?.descriptionKey ?? "(none)"}, whatsNew=${m?.whatsNewKey ?? "(none)"}`,
  );

  const before = ctx.locIds.size;
  const locId = await ensureVersionLocalization(
    token,
    ctx.versionId,
    locale,
    ctx.locIds,
  );
  const created = ctx.locIds.size > before;
  log.push(`localization id=${locId}${created ? " (created)" : " (existing)"}`);

  const { description, whatsNew } = resolveMetaFields(platform, locale);
  log.push(`resolved description: ${preview(description)}`);
  log.push(`resolved whatsNew: ${preview(whatsNew)}`);

  const warnings: string[] = [];
  if (m?.whatsNewKey && !whatsNew) {
    warnings.push(
      `What's New not sent for ${locale}: string "${m.whatsNewKey}" is empty for ${locale} and ${base} (and no release notes found).`,
    );
  }
  if (m?.descriptionKey && !description) {
    warnings.push(
      `Description not sent for ${locale}: string "${m.descriptionKey}" is empty for ${locale} and ${base}.`,
    );
  }

  if (!description && !whatsNew) {
    log.push("PATCH skipped: nothing resolved to send.");
    return { note: warnings.join(" ") || "Nothing to upload.", log };
  }

  const reqAttrs = {
    description: description || undefined,
    whatsNew: whatsNew || undefined,
  };
  log.push(
    `PATCH /v1/appStoreVersionLocalizations/${locId} → ${JSON.stringify({
      description: reqAttrs.description ? `${reqAttrs.description.length} chars` : undefined,
      whatsNew: reqAttrs.whatsNew ? `${reqAttrs.whatsNew.length} chars` : undefined,
    })}`,
  );

  const resp = await patchVersionLocalization(token, locId, reqAttrs);
  log.push(`PATCH response whatsNew: ${preview(resp.whatsNew)}`);
  log.push(`PATCH response description: ${preview(resp.description)}`);

  // Read the localization back independently. ASC returns 200 for an
  // accepted-but-ignored What's New, so a successful PATCH isn't proof.
  const norm = (s?: string) => (s ?? "").replace(/\r\n/g, "\n").trim();
  try {
    const after = await getVersionLocalization(token, locId);
    log.push(`GET read-back whatsNew: ${preview(after.whatsNew)}`);
    log.push(`GET read-back description: ${preview(after.description)}`);
    if (whatsNew && norm(after.whatsNew) !== norm(whatsNew)) {
      warnings.push(
        `App Store Connect accepted the update but What's New for ${locale} is unchanged. ` +
          `This happens when the version isn't an update (e.g. the app's first version) ` +
          `or What's New isn't editable in the version's current state.`,
      );
    }
    if (description && norm(after.description) !== norm(description)) {
      warnings.push(`App Store Connect did not apply the Description for ${locale}.`);
    }
  } catch (err) {
    log.push(`read-back GET failed: ${errMsg(err)}`);
  }

  return { note: warnings.length ? warnings.join(" ") : undefined, log };
}

/** Find-or-create the set for (locale × displayType), cached per run. */
async function resolveSetId(
  token: string,
  ctx: PlatformCtx,
  setCache: Map<string, string>,
  locale: string,
  displayType: string,
): Promise<string> {
  const locId = await ensureVersionLocalization(
    token,
    ctx.versionId,
    locale,
    ctx.locIds,
  );
  const setKey = `${locId}:${displayType}`;
  let setId = setCache.get(setKey);
  if (!setId) {
    setId = await ensureScreenshotSet(token, locId, displayType);
    setCache.set(setKey, setId);
  }
  return setId;
}

/** Delete every screenshot currently in a set, so it can be re-uploaded clean. */
async function clearScreenshotSet(
  token: string,
  ctx: PlatformCtx,
  setCache: Map<string, string>,
  locale: string,
  displayType: string,
): Promise<void> {
  const setId = await resolveSetId(token, ctx, setCache, locale, displayType);
  const existing = await listScreenshotsInSet(token, setId);
  for (const s of existing) {
    await deleteScreenshot(token, s.id);
  }
}

async function uploadScreenshotCell(
  token: string,
  ctx: PlatformCtx,
  setCache: Map<string, string>,
  cellId: string,
): Promise<void> {
  const cell = store.getCell(cellId);
  if (!cell?.composedPath) throw new Error(`Cell ${cellId} not composed`);
  const preset = getPreset(cell.presetId);
  const ascLocale = localeToAsc(cell.locale);

  const setId = await resolveSetId(
    token,
    ctx,
    setCache,
    cell.locale,
    preset.ascDisplayType,
  );

  const buffer = fs.readFileSync(cell.composedPath);
  const fileName = `${cell.screenId}_${ascLocale}_${preset.id}.png`;
  const reserved = await reserveScreenshot(
    token,
    setId,
    fileName,
    buffer.byteLength,
  );
  await uploadScreenshotParts(reserved.operations, buffer);
  await commitScreenshot(token, reserved.id, buffer);
  updateCell(cellId, { state: "committed", ascScreenshotId: reserved.id });
  await pollScreenshot(token, reserved.id);
}

/** Simulate the full pipeline (used without credentials or to preview safely). */
async function runDryRun(job: UploadJob): Promise<void> {
  for (const item of job.items) {
    if (job.cancelled) break;
    item.state = "uploading";
    item.attempts += 1;
    setItem(job, item);
    if (item.cellId) updateCell(item.cellId, { state: "uploading" });
    await new Promise((r) => setTimeout(r, 250));
    item.state = "verified";
    if (item.cellId) updateCell(item.cellId, { state: "verified", lastError: undefined });
    setItem(job, item);
  }
}
