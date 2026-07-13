import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser } from "playwright";
import { getPreset } from "./presets.js";
import { renderOverlayHtml } from "../overlay/render.js";
import { getOverlay } from "../screens/variants.js";
import { store } from "../store.js";
import type { AssetCell, DevicePreset, ScreenTemplate } from "../types.js";
import { cellId } from "../store.js";

export interface CaptureResult {
  capturePath: string;
  overflow: boolean;
}

export class CaptureEngine {
  private browser: Browser | null = null;

  private async getBrowser(): Promise<Browser> {
    if (!this.browser) {
      this.browser = await chromium.launch({ args: ["--no-sandbox"] });
    }
    return this.browser;
  }

  async close(): Promise<void> {
    await this.browser?.close();
    this.browser = null;
  }

  /** Render and capture a single screen x locale x preset to a PNG. */
  async capture(
    screen: ScreenTemplate,
    locale: string,
    preset: DevicePreset,
  ): Promise<CaptureResult> {
    const paths = store.getPaths();
    if (!getOverlay(screen, preset.id)) {
      throw new Error(
        `Screen ${screen.id} has no source screenshot for ${preset.id}`,
      );
    }
    const html = renderOverlayHtml(screen, locale, preset);

    const browser = await this.getBrowser();
    const context = await browser.newContext({
      viewport: { width: preset.pointWidth, height: preset.pointHeight },
      deviceScaleFactor: preset.scale,
    });
    const page = await context.newPage();
    try {
      await page.setContent(html, { waitUntil: "networkidle" });
      // Wait for fonts + the auto-fit pass to settle before capturing.
      await page
        .waitForFunction(
          () =>
            (window as { __lssLayoutDone?: boolean }).__lssLayoutDone === true,
          { timeout: 5000 },
        )
        .catch(() => {});
      const overflow = false;
      const outName = `${screen.id}__${locale}__${preset.id}.png`;
      const capturePath = path.join(paths.capturesDir, outName);
      fs.mkdirSync(paths.capturesDir, { recursive: true });
      await page.screenshot({
        path: capturePath,
        clip: {
          x: 0,
          y: 0,
          width: preset.pointWidth,
          height: preset.pointHeight,
        },
      });
      return { capturePath, overflow };
    } finally {
      await context.close();
    }
  }

  /** Capture a cell, updating its state in the store. */
  async captureCell(cell: AssetCell): Promise<AssetCell> {
    const screen = store.getScreen(cell.screenId);
    if (!screen) throw new Error(`Unknown screen: ${cell.screenId}`);
    const preset = getPreset(cell.presetId);
    const { capturePath, overflow } = await this.capture(
      screen,
      cell.locale,
      preset,
    );
    const updated: AssetCell = {
      ...cell,
      state: "captured",
      capturePath,
      overflow,
      lastError: undefined,
      updatedAt: new Date().toISOString(),
    };
    store.upsertCell(updated);
    return updated;
  }
}

export const captureEngine = new CaptureEngine();

/** Ensure a cell exists for the screen/locale/preset, then capture it. */
export async function captureScreenLocale(
  screenId: string,
  locale: string,
  presetId: string,
): Promise<AssetCell> {
  const id = cellId(screenId, locale, presetId);
  let cell = store.getCell(id);
  if (!cell) {
    cell = {
      id,
      screenId,
      locale,
      presetId,
      state: "pending",
      updatedAt: new Date().toISOString(),
    };
    store.upsertCell(cell);
  }
  return captureEngine.captureCell(cell);
}
