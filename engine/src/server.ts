import path from "node:path";
import fs from "node:fs";
import express, { type Request, type Response } from "express";
import cors from "cors";
import { store, cellId, readGlobalSettings, removeRecentProject } from "./store.js";
import { readProject } from "./projectReader/index.js";
import { PRESETS, getPreset } from "./capture/presets.js";
import { captureEngine, captureScreenLocale } from "./capture/capture.js";
import { composeCell, effectiveComposition } from "./compositor/compositor.js";
import { renderOverlayHtml, fontFaces } from "./overlay/render.js";
import {
  createOverlayScreen,
  updateOverlayScreen,
  rebuildPlate,
  overlayImagePath,
  sampleSlotColors,
  replaceOverlaySource,
  duplicateScreen,
  addScreenVariant,
  removeScreenVariant,
} from "./overlay/index.js";
import { ingestScreens } from "./overlay/ingest.js";
import { sampleFrameTheme } from "./overlay/themeColor.js";
import {
  primaryPresetId,
  setVariantComposition,
} from "./screens/variants.js";
import { localizeKey } from "./strings/localize.js";
import { saveCredentials, loadCredentials } from "./asc/credentials.js";
import {
  saveOpenAIConfig,
  clearOpenAIConfig,
  hasOpenAIConfig,
  resolveOpenAI,
} from "./openai/credentials.js";
import {
  cancelUploadJob,
  createUploadJob,
  getJob,
  jobEmitter,
  runUploadJob,
} from "./asc/uploadEngine.js";
import type { AppStoreMetadataConfig, AssetCell } from "./types.js";

export function createServer() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "30mb" }));

  const asyncRoute =
    (fn: (req: Request, res: Response) => Promise<void>) =>
    (req: Request, res: Response) => {
      fn(req, res).catch((err) => {
        res.status(400).json({ error: String(err?.message ?? err) });
      });
    };

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, open: store.isOpen() });
  });

  // The engine is an API, not the UI. If someone opens it in a browser,
  // point them at the actual studio instead of throwing favicon/CSP errors.
  app.get("/favicon.ico", (_req, res) => res.status(204).end());

  app.get("/", (_req, res) => {
    res.setHeader("content-type", "text/html");
    res.send(`<!doctype html><html><head><meta charset="utf-8" />
<title>LSS Engine</title>
<style>body{font:15px -apple-system,system-ui,sans-serif;background:#0c0e14;color:#e6e9f0;display:grid;place-items:center;height:100vh;margin:0}a{color:#5b8cff}</style>
</head><body><div style="text-align:center">
<h2>Localized Screenshot Studio &mdash; Engine</h2>
<p>This is the local API on port ${process.env.LSS_PORT ?? "8787"}. Open the app UI instead:</p>
<p><a href="http://localhost:5173">http://localhost:5173</a></p>
</div></body></html>`);
  });

  app.get("/api/presets", (_req, res) => {
    res.json(PRESETS);
  });

  // ---- Project ----------------------------------------------------------
  app.post(
    "/api/project/open",
    asyncRoute(async (req, res) => {
      const { path: projectPath } = req.body as { path: string };
      if (!projectPath) throw new Error("path is required");
      const data = readProject(projectPath);
      store.open(data.projectPath, { appName: data.appName });
      store.setData(data);
      const cfg = store.getConfig();
      cfg.baseLocale = data.baseLocale;
      store.reconcileCells(data.locales);
      res.json({ config: store.getConfig(), data: summarize() });
    }),
  );

  app.get("/api/project", (_req, res) => {
    if (!store.isOpen()) {
      res.json({ open: false });
      return;
    }
    res.json({ open: true, config: store.getConfig(), data: summarize() });
  });

  // Global machine settings (recent projects) — not per-Xcode-project.
  app.get("/api/settings", (_req, res) => {
    const s = readGlobalSettings();
    res.json({
      lastProjectPath: s.lastProjectPath,
      recentProjects: s.recentProjects ?? [],
    });
  });

  app.delete(
    "/api/settings/recent",
    asyncRoute(async (req, res) => {
      const { path: projectPath } = req.body as { path?: string };
      if (!projectPath) throw new Error("path is required");
      const s = removeRecentProject(projectPath);
      res.json({
        ok: true,
        recentProjects: s.recentProjects ?? [],
      });
    }),
  );

  app.put(
    "/api/project/settings",
    asyncRoute(async (req, res) => {
      const { baseLocale, presetIds } = req.body as {
        baseLocale?: string;
        presetIds?: string[];
      };
      if (baseLocale) store.setBaseLocale(baseLocale);
      if (Array.isArray(presetIds)) {
        const valid = presetIds.filter((id) => PRESETS.some((p) => p.id === id));
        if (valid.length) store.setPresetIds(valid);
      }
      res.json({ config: store.getConfig(), data: summarize() });
    }),
  );

  // Map localized string keys to App Store metadata fields, per platform.
  app.put(
    "/api/metadata",
    asyncRoute(async (req, res) => {
      if (!store.isOpen()) throw new Error("No project is open");
      const metadata = store.setMetadata(req.body as AppStoreMetadataConfig);
      res.json({ metadata });
    }),
  );

  // Toggle whether string edits are written straight into the Xcode catalogs.
  app.put(
    "/api/strings/catalog-write",
    asyncRoute(async (req, res) => {
      if (!store.isOpen()) throw new Error("No project is open");
      const { enabled } = req.body as { enabled: boolean };
      store.setCatalogWrite(enabled);
      res.json({
        catalogWrite: store.catalogWriteEnabled(),
        catalogFile: store.catalogLabel(),
      });
    }),
  );

  // ---- Strings ----------------------------------------------------------
  app.get("/api/strings", (_req, res) => {
    if (!store.isOpen()) {
      res.json({ open: false });
      return;
    }
    const cfg = store.getConfig();
    const data = store.getData();
    const addedKeys = new Set((cfg.addedStrings ?? []).map((s) => s.key));
    const editedKeys = new Set(Object.keys(cfg.stringEdits ?? {}));
    res.json({
      open: true,
      baseLocale: cfg.baseLocale,
      locales: data?.locales ?? [cfg.baseLocale],
      catalogWrite: store.catalogWriteEnabled(),
      catalogFile: store.catalogLabel(),
      strings: store.getMergedStrings().map((s) => ({
        key: s.key,
        comment: s.comment,
        values: s.values,
        added: addedKeys.has(s.key),
        edited: editedKeys.has(s.key),
      })),
    });
  });

  app.put(
    "/api/strings/:key",
    asyncRoute(async (req, res) => {
      const { locale, value } = req.body as { locale: string; value: string };
      if (!locale) throw new Error("locale is required");
      store.setStringValue(req.params.key, locale, value ?? "");
      res.json({ ok: true });
    }),
  );

  // Update the default-language value; clears every other locale so the
  // translations are flagged missing and must be re-localized.
  app.put(
    "/api/strings/:key/base",
    asyncRoute(async (req, res) => {
      const { value } = req.body as { value: string };
      store.setBaseStringValue(req.params.key, value ?? "");
      res.json({ ok: true });
    }),
  );

  app.delete(
    "/api/strings/:key",
    asyncRoute(async (req, res) => {
      store.deleteString(req.params.key);
      res.json({ ok: true });
    }),
  );

  // Translate a key's missing locales in one LLM pass, save the successes, and
  // report per-locale results so the user can verify the output.
  app.post(
    "/api/strings/:key/localize",
    asyncRoute(async (req, res) => {
      if (!store.isOpen()) throw new Error("No project is open");
      const cfg = store.getConfig();
      const key = req.params.key;
      const allLocales = store.getData()?.locales ?? [cfg.baseLocale];
      const entry = store.getMergedStrings().find((s) => s.key === key);
      const baseValue = entry?.values[cfg.baseLocale] ?? "";

      const requested = (req.body?.locales as string[] | undefined)?.filter(
        (l) => l && l !== cfg.baseLocale,
      );
      const targets =
        requested && requested.length
          ? requested
          : allLocales.filter(
              (l) =>
                l !== cfg.baseLocale && !(entry?.values[l]?.trim() ?? ""),
            );

      if (!targets.length) {
        res.json({
          key,
          baseLocale: cfg.baseLocale,
          baseValue,
          engine: "none",
          results: {},
          saved: [],
        });
        return;
      }

      const result = await localizeKey(key, targets);
      const saved: string[] = [];
      for (const [locale, r] of Object.entries(result.results)) {
        if (r.value) {
          store.setStringValue(key, locale, r.value);
          saved.push(locale);
        }
      }
      res.json({ ...result, saved });
    }),
  );

  app.post(
    "/api/strings",
    asyncRoute(async (req, res) => {
      const { key, value, comment } = req.body as {
        key: string;
        value: string;
        comment?: string;
      };
      if (!key?.trim()) throw new Error("key is required");
      const entry = store.addString(key.trim(), value ?? "", comment);
      res.json({ string: entry });
    }),
  );

  // ---- Overlay screens (screenshot + text slots) -----------------------
  app.post(
    "/api/overlay/screens",
    asyncRoute(async (req, res) => {
      const result = await createOverlayScreen(req.body);
      for (const c of store.getConfig().cells) {
        if (c.screenId === result.screen.id && c.state === "pending") {
          store.upsertCell({ ...c, state: "generated" });
        }
      }
      res.json(result);
    }),
  );

  /**
   * Bulk-import screenshots from a folder (or explicit file list). Samples each
   * image's theme colors for the promo frame + headline, and links headline
   * keys from filenames (`appstore.ios_2.png` or `ios/2.png`).
   */
  app.post(
    "/api/screens/ingest",
    asyncRoute(async (req, res) => {
      const result = await ingestScreens(req.body ?? {});
      for (const item of result.created) {
        for (const c of store.getConfig().cells) {
          if (c.screenId === item.screen.id && c.state === "pending") {
            store.upsertCell({ ...c, state: "generated" });
          }
        }
      }
      res.json({
        ...result,
        config: store.getConfig(),
        data: summarize(),
      });
    }),
  );

  /** Sample promo-frame theme colors from an existing overlay source image. */
  app.post(
    "/api/screens/:id/theme",
    asyncRoute(async (req, res) => {
      const screen = store.getScreen(req.params.id);
      if (!screen) throw new Error("Unknown screen");
      const { presetId, apply } = req.body as {
        presetId?: string;
        apply?: boolean;
      };
      const pid = presetId ?? primaryPresetId(screen);
      const abs = overlayImagePath(req.params.id, "source", pid);
      if (!abs) throw new Error("No source image for this screen/variant");
      const theme = await sampleFrameTheme(abs);
      if (apply) {
        const current = effectiveComposition(screen, pid);
        const next = setVariantComposition(screen, pid, {
          ...current,
          background: theme.background,
          headlineColor: theme.headlineColor,
        });
        next.updatedAt = new Date().toISOString();
        store.upsertScreen(next);
        res.json({ theme, screen: store.getScreen(req.params.id) });
        return;
      }
      res.json({ theme });
    }),
  );

  app.put(
    "/api/overlay/screens/:id",
    asyncRoute(async (req, res) => {
      const screen = await updateOverlayScreen(req.params.id, req.body);
      res.json({ screen });
    }),
  );

  app.post(
    "/api/overlay/screens/:id/plate",
    asyncRoute(async (req, res) => {
      const { presetId } = req.body as { presetId?: string };
      const screen = await rebuildPlate(req.params.id, presetId);
      res.json({ screen });
    }),
  );

  app.post(
    "/api/overlay/screens/:id/source",
    asyncRoute(async (req, res) => {
      const { imageDataUrl, reocr, presetId } = req.body as {
        imageDataUrl: string;
        reocr?: boolean;
        presetId?: string;
      };
      const screen = await replaceOverlaySource(
        req.params.id,
        imageDataUrl,
        Boolean(reocr),
        presetId,
      );
      res.json({ screen });
    }),
  );

  // ---- Composition ------------------------------------------------------
  app.put(
    "/api/screens/:id/composition",
    asyncRoute(async (req, res) => {
      const screen = store.getScreen(req.params.id);
      if (!screen) throw new Error("Unknown screen");
      const { composition, presetId } = req.body as {
        composition: import("./types.js").ScreenComposition;
        presetId?: string;
      };
      const pid = presetId ?? primaryPresetId(screen);
      const next = setVariantComposition(screen, pid, composition);
      next.updatedAt = new Date().toISOString();
      store.upsertScreen(next);
      res.json({ screen: store.getScreen(req.params.id) });
    }),
  );

  app.put(
    "/api/compositor",
    asyncRoute(async (req, res) => {
      const compositor = store.setCompositor(req.body ?? {});
      res.json({ compositor });
    }),
  );

  // Per-device-class headline overrides (size / area), keyed by device class.
  app.put(
    "/api/compositor/device/:deviceClass",
    asyncRoute(async (req, res) => {
      const compositor = store.setDeviceTypography(
        req.params.deviceClass,
        req.body ?? {},
      );
      res.json({ compositor });
    }),
  );

  app.delete(
    "/api/screens/:id",
    asyncRoute(async (req, res) => {
      store.removeScreen(req.params.id);
      res.json({ ok: true, config: store.getConfig() });
    }),
  );

  // Reorder screens — App Store upload follows this list order.
  app.put(
    "/api/screens/order",
    asyncRoute(async (req, res) => {
      const { screenIds } = req.body as { screenIds?: string[] };
      if (!Array.isArray(screenIds) || !screenIds.length) {
        throw new Error("screenIds is required");
      }
      store.reorderScreens(screenIds);
      res.json({ ok: true, config: store.getConfig() });
    }),
  );

  // Add a device variant to an existing screen (composition copied, no overlay).
  app.post(
    "/api/screens/:id/variants",
    asyncRoute(async (req, res) => {
      const { presetId, copyFromPresetId } = req.body as {
        presetId: string;
        copyFromPresetId?: string;
      };
      if (!presetId) throw new Error("presetId is required");
      const screen = addScreenVariant(req.params.id, {
        presetId,
        copyFromPresetId,
      });
      res.json({ screen, config: store.getConfig() });
    }),
  );

  app.delete(
    "/api/screens/:id/variants/:presetId",
    asyncRoute(async (req, res) => {
      const screen = removeScreenVariant(req.params.id, req.params.presetId);
      res.json({ screen, config: store.getConfig() });
    }),
  );

  // @deprecated — use POST /variants instead.
  app.post(
    "/api/screens/:id/duplicate",
    asyncRoute(async (req, res) => {
      const { presetIds } = req.body as { presetIds?: string[]; name?: string };
      const screen = duplicateScreen(req.params.id, { presetIds });
      res.json({ screen, config: store.getConfig() });
    }),
  );

  app.post(
    "/api/screens/:id/composition/headline",
    asyncRoute(async (req, res) => {
      const screen = store.getScreen(req.params.id);
      if (!screen) throw new Error("Unknown screen");
      const { text, key, presetId } = req.body as {
        text: string;
        key?: string;
        presetId?: string;
      };
      const pid = presetId ?? primaryPresetId(screen);
      const headlineKey =
        key?.trim() || `appstore.${screen.id.replace(/[^\w.]/g, "_")}.headline`;
      store.addString(headlineKey, text ?? "", "App Store screenshot headline");
      const comp = effectiveComposition(screen, pid);
      const next = setVariantComposition(screen, pid, {
        ...comp,
        headlineKey,
      });
      next.updatedAt = new Date().toISOString();
      store.upsertScreen(next);
      res.json({ screen: store.getScreen(req.params.id), key: headlineKey });
    }),
  );

  app.post(
    "/api/overlay/screens/:id/sample",
    asyncRoute(async (req, res) => {
      const { box, presetId } = req.body as {
        box: { x: number; y: number; w: number; h: number };
        presetId?: string;
      };
      res.json(await sampleSlotColors(req.params.id, box, presetId));
    }),
  );

  const sendOverlayImage = (which: "source" | "plate") =>
    asyncRoute(async (req, res) => {
      const presetId = req.query.preset as string | undefined;
      const abs = overlayImagePath(req.params.id, which, presetId);
      if (!abs) {
        res.status(404).end();
        return;
      }
      res.setHeader("cache-control", "no-store");
      res.sendFile(abs);
    });
  app.get("/overlay/:id/source", sendOverlayImage("source"));
  app.get("/overlay/:id/plate", sendOverlayImage("plate"));

  app.post(
    "/api/screens/:id/headline",
    asyncRoute(async (req, res) => {
      const screen = store.getScreen(req.params.id);
      if (!screen) throw new Error("Unknown screen");
      const { locale, value } = req.body as { locale: string; value: string };
      screen.headline[locale] = value;
      screen.updatedAt = new Date().toISOString();
      store.upsertScreen(screen);
      res.json(screen);
    }),
  );

  // ---- Capture ----------------------------------------------------------
  app.post(
    "/api/capture",
    asyncRoute(async (req, res) => {
      const cells = selectCells(req.body);
      const updated: AssetCell[] = [];
      for (const cell of cells) {
        try {
          updated.push(await captureEngine.captureCell(cell));
        } catch (err) {
          const failed: AssetCell = {
            ...cell,
            state: "failed",
            lastError: String(err),
            updatedAt: new Date().toISOString(),
          };
          store.upsertCell(failed);
          updated.push(failed);
        }
      }
      res.json({ cells: updated });
    }),
  );

  // ---- Compose ----------------------------------------------------------
  app.post(
    "/api/compose",
    asyncRoute(async (req, res) => {
      const cells = selectCells(req.body).filter((c) => c.capturePath);
      const updated: AssetCell[] = [];
      for (const cell of cells) {
        try {
          updated.push(await composeCell(cell));
        } catch (err) {
          const failed: AssetCell = {
            ...cell,
            state: "failed",
            lastError: String(err),
            updatedAt: new Date().toISOString(),
          };
          store.upsertCell(failed);
          updated.push(failed);
        }
      }
      res.json({ cells: updated });
    }),
  );

  app.post(
    "/api/cells/:id/approve",
    asyncRoute(async (req, res) => {
      const cell = store.getCell(req.params.id);
      if (!cell) throw new Error("Unknown cell");
      store.upsertCell({ ...cell, state: "approved" });
      res.json(store.getCell(req.params.id));
    }),
  );

  // Delete generated artifacts (capture + composed PNGs) for matching cells and
  // reset them to pending. Matches existing cells only (never creates new ones).
  app.post(
    "/api/cells/clear",
    asyncRoute(async (req, res) => {
      if (!store.isOpen()) throw new Error("No project is open");
      const cells = existingCells(req.body as CellSelector);
      for (const cell of cells) {
        for (const file of [cell.composedPath, cell.capturePath]) {
          if (file && fs.existsSync(file)) {
            try {
              fs.rmSync(file);
            } catch {
              /* ignore */
            }
          }
        }
        store.resetCell(cell.id);
      }
      res.json({ cleared: cells.length });
    }),
  );

  // ---- App Store Connect ------------------------------------------------
  app.get("/api/asc/status", (_req, res) => {
    const ref = store.isOpen() ? store.getConfig().asc : undefined;
    res.json({ hasCredentials: loadCredentials() !== null, ref });
  });

  app.post(
    "/api/asc/credentials",
    asyncRoute(async (req, res) => {
      saveCredentials(req.body);
      res.json({ ok: true, ref: store.getConfig().asc });
    }),
  );

  // ---- OpenAI (machine-local key for localize / OCR fallback) -----------
  app.get("/api/openai", (_req, res) => {
    const resolved = resolveOpenAI();
    res.json({
      configured: hasOpenAIConfig(),
      source: resolved?.source ?? null,
      model: resolved?.model,
    });
  });

  app.put(
    "/api/openai",
    asyncRoute(async (req, res) => {
      const body = req.body as {
        apiKey?: string;
        baseUrl?: string;
        model?: string;
      };
      if (!body.apiKey?.trim()) throw new Error("apiKey is required");
      saveOpenAIConfig({
        apiKey: body.apiKey,
        baseUrl: body.baseUrl,
        model: body.model,
      });
      const resolved = resolveOpenAI();
      res.json({
        ok: true,
        configured: true,
        source: resolved?.source ?? "file",
        model: resolved?.model,
      });
    }),
  );

  app.delete("/api/openai", (_req, res) => {
    clearOpenAIConfig();
    const resolved = resolveOpenAI();
    res.json({
      ok: true,
      configured: hasOpenAIConfig(),
      source: resolved?.source ?? null,
      model: resolved?.model,
    });
  });

  // Pin / clear the ASC marketing version uploads attach to (no credential change).
  app.put(
    "/api/asc/version",
    asyncRoute(async (req, res) => {
      const { versionString } = req.body as { versionString?: string };
      const ref = store.setAscVersionString(versionString);
      res.json({ ok: true, ref });
    }),
  );

  app.post(
    "/api/upload",
    asyncRoute(async (req, res) => {
      const job = createUploadJob(req.body);
      // Run in the background; the client streams progress over SSE.
      runUploadJob(job.id).catch(() => {});
      res.json({ job });
    }),
  );

  app.get("/api/jobs/:id", (req, res) => {
    const job = getJob(req.params.id);
    if (!job) {
      res.status(404).json({ error: "Unknown job" });
      return;
    }
    res.json(job);
  });

  app.post("/api/jobs/:id/cancel", (req, res) => {
    const job = cancelUploadJob(req.params.id);
    if (!job) {
      res.status(404).json({ error: "Unknown job" });
      return;
    }
    res.json({ job });
  });

  app.get("/api/jobs/:id/events", (req, res) => {
    const emitter = jobEmitter(req.params.id);
    const job = getJob(req.params.id);
    if (!emitter || !job) {
      res.status(404).end();
      return;
    }
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    res.write(`data: ${JSON.stringify({ event: "snapshot", payload: job })}\n\n`);
    const listener = (msg: unknown) => {
      res.write(`data: ${JSON.stringify(msg)}\n\n`);
    };
    emitter.on("event", listener);
    req.on("close", () => emitter.off("event", listener));
  });

  // The project's embedded fonts, as a stylesheet the studio UI can load so
  // the in-app editor canvas matches the rendered output exactly (otherwise
  // the source-locale editing view silently falls back to a system font).
  // The project's bundled font families, grouped with the weights/styles that
  // are actually available, so the studio font picker can offer exact faces.
  app.get("/api/fonts", (_req, res) => {
    const faces = store.getData()?.tokens.fonts ?? [];
    const groups = new Map<
      string,
      { label: string; family: string; weights: Set<number>; italic: boolean }
    >();
    for (const f of faces) {
      const g = groups.get(f.family) ?? {
        label: f.family,
        family: `"${f.family}", -apple-system, system-ui, sans-serif`,
        weights: new Set<number>(),
        italic: false,
      };
      g.weights.add(f.weight ?? 400);
      if (f.style === "italic") g.italic = true;
      groups.set(f.family, g);
    }
    const fonts = [...groups.values()].map((g) => ({
      label: g.label,
      family: g.family,
      weights: [...g.weights].sort((a, b) => a - b),
      italic: g.italic,
    }));
    res.json({ fonts });
  });

  app.get("/api/fonts.css", (_req, res) => {
    const tokens = store.getData()?.tokens ?? {
      colors: {},
      colorsDark: {},
      fonts: [],
      sfSymbols: [],
    };
    res.setHeader("content-type", "text/css");
    res.send(fontFaces(tokens));
  });

  // ---- Live preview render ----------------------------------------------
  app.get(
    "/render/:screenId",
    asyncRoute(async (req, res) => {
      const screen = store.getScreen(req.params.screenId);
      if (!screen) throw new Error("Unknown screen");
      const locale = (req.query.locale as string) || store.getConfig().baseLocale;
      const presetId =
        (req.query.preset as string) || primaryPresetId(screen);
      const preset = getPreset(presetId);
      const { getOverlay } = await import("./screens/variants.js");
      if (!getOverlay(screen, presetId)) {
        throw new Error("Screen has no source screenshot for this device");
      }
      res.setHeader("content-type", "text/html");
      res.send(renderOverlayHtml(screen, locale, preset));
    }),
  );

  // ---- Serve generated images (scoped to the open project) --------------
  app.get("/api/image", (req, res) => {
    const file = req.query.path as string;
    if (!store.isOpen() || !file) {
      res.status(400).end();
      return;
    }
    const resolved = path.resolve(file);
    const root = path.resolve(store.getPaths().assetsDir);
    if (!resolved.startsWith(root) || !fs.existsSync(resolved)) {
      res.status(404).end();
      return;
    }
    res.sendFile(resolved);
  });

  return app;
}

function summarize() {
  const data = store.getData();
  if (!data) return null;
  const baseLocale = store.isOpen() ? store.getConfig().baseLocale : data.baseLocale;
  const merged = store.isOpen() ? store.getMergedStrings() : data.strings;
  return {
    appName: data.appName,
    bundleId: data.bundleId,
    marketingVersion: data.marketingVersion,
    buildNumber: data.buildNumber,
    locales: data.locales,
    baseLocale,
    stringCount: merged.length,
    keys: merged.map((s) => ({
      key: s.key,
      base: s.values[baseLocale] ?? "",
    })),
    releaseNoteLocales: Object.keys(data.releaseNotes),
    tokens: {
      colorCount: Object.keys(data.tokens.colors).length,
      fontCount: data.tokens.fonts.length,
      hasAppIcon: Boolean(data.tokens.appIconDataUrl),
      sfSymbolCount: data.tokens.sfSymbols.length,
      accentColor: data.tokens.accentColor,
    },
  };
}

interface CellSelector {
  cellIds?: string[];
  screenId?: string;
  locales?: string[];
  presetIds?: string[];
}

/** Resolve a selector into already-existing cells (never creates new ones). */
function existingCells(sel: CellSelector): AssetCell[] {
  const cfg = store.getConfig();
  return cfg.cells.filter((c) => {
    if (sel.cellIds?.length) return sel.cellIds.includes(c.id);
    if (sel.screenId && c.screenId !== sel.screenId) return false;
    if (sel.presetIds?.length && !sel.presetIds.includes(c.presetId)) return false;
    if (sel.locales?.length && !sel.locales.includes(c.locale)) return false;
    return true;
  });
}

/** Resolve a selector into concrete cells, creating any missing combinations. */
function selectCells(sel: CellSelector): AssetCell[] {
  const cfg = store.getConfig();
  if (sel.cellIds?.length) {
    return sel.cellIds
      .map((id) => store.getCell(id))
      .filter((c): c is AssetCell => Boolean(c));
  }
  const locales = store.getData()?.locales ?? [cfg.baseLocale];
  const out: AssetCell[] = [];
  for (const screen of cfg.screens) {
    if (sel.screenId && screen.id !== sel.screenId) continue;
    const presetIds = sel.presetIds ?? screen.presetIds;
    const wantedLocales = sel.locales ?? locales;
    for (const locale of wantedLocales) {
      for (const presetId of presetIds) {
        const id = cellId(screen.id, locale, presetId);
        let cell = store.getCell(id);
        if (!cell) {
          cell = {
            id,
            screenId: screen.id,
            locale,
            presetId,
            state: "pending",
            updatedAt: new Date().toISOString(),
          };
          store.upsertCell(cell);
        }
        out.push(cell);
      }
    }
  }
  return out;
}
