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
  listVersionLocalizations,
  patchVersionLocalization,
  resolveVersionId,
  type AscPlatform,
} from "./metadata.js";
import {
  commitScreenshot,
  ensureScreenshotSet,
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

async function withRetry<T>(
  fn: () => Promise<T>,
  attempts: number,
  onAttempt?: (n: number, err: unknown) => void,
): Promise<T> {
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      onAttempt?.(i, err);
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
  locales?: string[];
}

function buildItems(opts: CreateJobOptions): UploadJobItem[] {
  const cfg = store.getConfig();
  const data = store.getData();
  const items: UploadJobItem[] = [];

  if (opts.kind === "screenshots" || opts.kind === "both") {
    const cells = cfg.cells.filter((c) => {
      if (opts.cellIds && !opts.cellIds.includes(c.id)) return false;
      return Boolean(c.composedPath) && fsExists(c.composedPath);
    });
    for (const c of cells) {
      items.push({
        cellId: c.id,
        locale: c.locale,
        presetId: c.presetId,
        platform: storePlatformForPreset(c.presetId),
        kind: "screenshot",
        state: "pending",
        attempts: 0,
      });
    }
  }

  if (opts.kind === "metadata" || opts.kind === "both") {
    const locales = opts.locales ?? data?.locales ?? [cfg.baseLocale];
    for (const platform of metadataPlatforms()) {
      for (const locale of locales) {
        const fields = resolveMetaFields(platform, locale);
        if (!fields.description && !fields.whatsNew) continue;
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

/** Run an upload job to completion. Resolves when all items are done. */
export async function runUploadJob(jobId: string): Promise<UploadJob> {
  const job = jobs.get(jobId);
  if (!job) throw new Error(`Unknown job: ${jobId}`);

  if (job.dryRun) {
    await runDryRun(job);
    job.done = true;
    emit(job, "done", { id: job.id });
    return job;
  }

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

  for (const item of job.items) {
    item.state = "uploading";
    item.attempts += 1;
    setItem(job, item);
    if (item.cellId) updateCell(item.cellId, { state: "uploading" });

    try {
      if (item.kind === "metadata") {
        const group = item.platform ?? "ios";
        const ctx = await ctxFor(ascPlatform(group));
        await withRetry(
          () => uploadMetadata(token, ctx, item.locale, group),
          3,
          (n, err) => emit(job, "retry", { item, n, error: String(err) }),
        );
      } else if (item.cellId) {
        const group = item.platform ?? storePlatformForPreset(item.presetId ?? "");
        const ctx = await ctxFor(ascPlatform(group));
        await withRetry(
          () => uploadScreenshotCell(token, ctx, setCache, item.cellId!),
          3,
          (n, err) => emit(job, "retry", { item, n, error: String(err) }),
        );
      }
      item.state = "verified";
      if (item.cellId) updateCell(item.cellId, { state: "verified", lastError: undefined });
    } catch (err) {
      item.state = "failed";
      item.error = String(err);
      if (item.cellId) updateCell(item.cellId, { state: "failed", lastError: String(err) });
    }
    setItem(job, item);
  }

  job.done = true;
  emit(job, "done", { id: job.id });
  return job;
}

interface PlatformCtx {
  versionId: string;
  locIds: Map<string, string>;
}

async function uploadMetadata(
  token: string,
  ctx: PlatformCtx,
  locale: string,
  platform: StorePlatform,
): Promise<void> {
  const locId = await ensureVersionLocalization(
    token,
    ctx.versionId,
    locale,
    ctx.locIds,
  );
  const { description, whatsNew } = resolveMetaFields(platform, locale);
  if (!description && !whatsNew) return;
  await patchVersionLocalization(token, locId, {
    description: description || undefined,
    whatsNew: whatsNew || undefined,
  });
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

  const locId = await ensureVersionLocalization(
    token,
    ctx.versionId,
    cell.locale,
    ctx.locIds,
  );
  const setKey = `${locId}:${preset.ascDisplayType}`;
  let setId = setCache.get(setKey);
  if (!setId) {
    setId = await ensureScreenshotSet(token, locId, preset.ascDisplayType);
    setCache.set(setKey, setId);
  }

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
