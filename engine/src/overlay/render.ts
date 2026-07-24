import fs from "node:fs";
import path from "node:path";
import { store } from "../store.js";
import { getOverlay } from "../screens/variants.js";
import type {
  DesignTokens,
  DevicePreset,
  ScreenTemplate,
  SlotTypography,
  TextSlot,
} from "../types.js";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Escape a CSS string for use inside a double-quoted HTML style attribute.
 * Critically, font-family values contain double quotes (e.g. `"SF Pro Text"`)
 * which would otherwise close the attribute early and drop every later
 * declaration (color, alignment, …).
 */
function styleAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

export function fontFaces(tokens: DesignTokens): string {
  return tokens.fonts
    .filter((f) => f.dataUrl)
    .map(
      (f) =>
        `@font-face{font-family:"${f.family}";font-weight:${f.weight ?? 400};` +
        `font-style:${f.style ?? "normal"};src:url(${f.dataUrl}) format("${f.format}");font-display:swap;}`,
    )
    .join("\n");
}

/** Resolve the text a slot should display in a given locale. */
export function resolveSlotText(slot: TextSlot, locale: string): string {
  if (slot.linkedKey) {
    const base = store.getConfig().baseLocale;
    const value =
      store.resolveString(slot.linkedKey, locale) ??
      store.resolveString(slot.linkedKey, base);
    if (value !== undefined && value !== "") return value;
    return slot.literal ?? slot.detectedText ?? slot.linkedKey;
  }
  return slot.literal ?? slot.detectedText ?? "";
}

/** Merge a slot's base typography with any per-locale override. */
function effectiveType(slot: TextSlot, locale: string): SlotTypography {
  return { ...slot.type, ...(slot.localeOverrides?.[locale] ?? {}) };
}

function effectiveBox(slot: TextSlot, locale: string): TextSlot["box"] {
  return slot.localeOverrides?.[locale]?.box ?? slot.box;
}

const ALIGN_TO_JUSTIFY: Record<string, string> = {
  left: "flex-start",
  center: "center",
  right: "flex-end",
};
const VALIGN_TO_ALIGN: Record<string, string> = {
  top: "flex-start",
  middle: "center",
  bottom: "flex-end",
};

const AUTOFIT_SCRIPT = `
(function () {
  function run() {
    document.querySelectorAll('.lss-slot').forEach(function (el) {
      var inner = el.querySelector('.lss-text');
      if (!inner) return;
      var mode = el.getAttribute('data-autofit');
      if (mode === 'none') return;
      if (mode === 'wrap') inner.style.whiteSpace = 'normal';
      var size = parseFloat(getComputedStyle(inner).fontSize);
      function fits() {
        return inner.scrollWidth <= el.clientWidth + 1 &&
               inner.scrollHeight <= el.clientHeight + 1;
      }
      var guard = 0;
      while (!fits() && size > 6 && guard < 400) {
        size -= 1;
        inner.style.fontSize = size + 'px';
        guard++;
      }
    });
    window.__lssLayoutDone = true;
  }
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(run);
    setTimeout(run, 800);
  } else {
    run();
  }
})();
`;

/** Render an overlay screen (plate + positioned text) to a standalone HTML doc. */
export function renderOverlayHtml(
  screen: ScreenTemplate,
  locale: string,
  preset: DevicePreset,
): string {
  const overlay = getOverlay(screen, preset.id);
  if (!overlay) throw new Error(`Screen ${screen.id} has no overlay for ${preset.id}`);
  const data = store.getData();
  const tokens: DesignTokens =
    data?.tokens ?? { colors: {}, colorsDark: {}, fonts: [], sfSymbols: [] };

  const plateAbs = path.join(store.getPaths().dataDir, overlay.platePath);
  let plateUrl = "";
  if (fs.existsSync(plateAbs)) {
    plateUrl = `data:image/png;base64,${fs.readFileSync(plateAbs).toString("base64")}`;
  }

  const isRtl = ["ar", "he", "fa", "ur"].some((l) => locale.startsWith(l));
  // Mac window screenshots keep their intrinsic plate size so chrome/shadow
  // aren't stretched into the 16:10 App Store canvas. Phone/iPad still render
  // into the preset viewport (device screen size).
  const usePlateSize = preset.platform === "macos";
  const W = usePlateSize
    ? Math.max(1, overlay.plateWidth)
    : preset.pointWidth;
  const H = usePlateSize
    ? Math.max(1, overlay.plateHeight)
    : preset.pointHeight;
  const plateFit = usePlateSize ? "contain" : "fill";

  const slotsHtml = overlay.slots
    .map((slot) => {
      const t = effectiveType(slot, locale);
      const box = effectiveBox(slot, locale);
      const text = resolveSlotText(slot, locale);
      const fontPx = Math.max(6, t.fontSizePct * H);
      const left = (box.x * 100).toFixed(3);
      const top = (box.y * 100).toFixed(3);
      const width = (box.w * 100).toFixed(3);
      const height = (box.h * 100).toFixed(3);
      const whiteSpace = t.autoFit === "wrap" ? "normal" : "nowrap";
      const style = [
        `left:${left}%`,
        `top:${top}%`,
        `width:${width}%`,
        `height:${height}%`,
        // Keep box alignment physical so a "left" pick is always the left edge,
        // even for RTL locales. (justify-content otherwise follows `direction`
        // and would silently flip Arabic/Hebrew to the opposite side.)
        `direction:ltr`,
        `justify-content:${ALIGN_TO_JUSTIFY[t.align] ?? "flex-start"}`,
        `align-items:${VALIGN_TO_ALIGN[t.valign] ?? "center"}`,
      ].join(";");
      const innerStyle = [
        `font-family:${t.fontFamily}`,
        `font-weight:${t.fontWeight}`,
        `font-style:${t.fontStyle ?? "normal"}`,
        `font-size:${fontPx}px`,
        `line-height:${t.lineHeight}`,
        `letter-spacing:${t.letterSpacing}em`,
        `color:${t.color}`,
        `text-align:${t.align}`,
        // The text itself still shapes/reads in its natural script direction;
        // only the box alignment above is forced physical.
        `direction:${isRtl ? "rtl" : "ltr"}`,
        `white-space:${whiteSpace}`,
        `max-width:100%`,
        `max-height:100%`,
        `overflow:hidden`,
      ].join(";");
      return `<div class="lss-slot" data-autofit="${t.autoFit}" style="${styleAttr(style)}"><div class="lss-text" style="${styleAttr(innerStyle)}">${escapeHtml(text)}</div></div>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="${locale}" dir="${isRtl ? "rtl" : "ltr"}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=${W}, initial-scale=1" />
<style>
  ${fontFaces(tokens)}
  *,*::before,*::after{box-sizing:border-box;}
  html,body{margin:0;padding:0;${usePlateSize ? "background:transparent;color-scheme:only light;" : ""}}
  body{width:${W}px;height:${H}px;overflow:hidden;
    font-family:-apple-system,system-ui,"Segoe UI",Roboto,sans-serif;
    -webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;}
  #lss-root{position:relative;width:${W}px;height:${H}px;overflow:hidden;${usePlateSize ? "background:transparent;" : ""}}
  #lss-plate{position:absolute;inset:0;width:100%;height:100%;object-fit:${plateFit};}
  .lss-slot{position:absolute;display:flex;overflow:hidden;}
  .lss-text{display:block;}
</style>
</head>
<body>
<div id="lss-root">
  ${plateUrl ? `<img id="lss-plate" src="${plateUrl}" />` : ""}
  ${slotsHtml}
</div>
<script>${AUTOFIT_SCRIPT}</script>
</body>
</html>`;
}
