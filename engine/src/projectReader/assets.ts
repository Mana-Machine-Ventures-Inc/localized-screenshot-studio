import fs from "node:fs";
import path from "node:path";
import { walk } from "./walk.js";
import type { DesignTokens, FontAsset } from "../types.js";

interface ColorComponents {
  red?: string | number;
  green?: string | number;
  blue?: string | number;
  alpha?: string | number;
}

function compToHex(v: string | number | undefined): number {
  if (v === undefined) return 0;
  if (typeof v === "number") return Math.round(v <= 1 ? v * 255 : v);
  const s = v.trim();
  if (s.startsWith("0x")) return parseInt(s, 16);
  const n = parseFloat(s);
  return Math.round(n <= 1 ? n * 255 : n);
}

function componentsToHex(c: ColorComponents): string {
  const r = compToHex(c.red);
  const g = compToHex(c.green);
  const b = compToHex(c.blue);
  return (
    "#" +
    [r, g, b]
      .map((x) => Math.max(0, Math.min(255, x)).toString(16).padStart(2, "0"))
      .join("")
  );
}

/** Extract named colors (light + dark appearances) from `.colorset` catalogs. */
function readColorSets(root: string): {
  colors: Record<string, string>;
  colorsDark: Record<string, string>;
} {
  const colors: Record<string, string> = {};
  const colorsDark: Record<string, string> = {};
  const colorSets = walk(root, {
    match: () => false,
    matchDir: (p) => p.endsWith(".colorset"),
  });
  for (const dir of colorSets) {
    const name = path.basename(dir, ".colorset");
    const contentsPath = path.join(dir, "Contents.json");
    if (!fs.existsSync(contentsPath)) continue;
    try {
      const json = JSON.parse(fs.readFileSync(contentsPath, "utf8"));
      for (const entry of json.colors ?? []) {
        const components = entry.color?.components as ColorComponents | undefined;
        if (!components) continue;
        const hex = componentsToHex(components);
        const isDark = (entry.appearances ?? []).some(
          (a: { appearance?: string; value?: string }) =>
            a.appearance === "luminosity" && a.value === "dark",
        );
        if (isDark) colorsDark[name] = hex;
        else if (!colors[name]) colors[name] = hex;
      }
    } catch {
      // ignore malformed color sets
    }
  }
  return { colors, colorsDark };
}

/** Find the largest app icon PNG and return its path. */
function findAppIcon(root: string): string | undefined {
  const iconSets = walk(root, {
    match: () => false,
    matchDir: (p) => p.endsWith(".appiconset"),
  });
  let best: { path: string; size: number } | undefined;
  for (const dir of iconSets) {
    let files: string[];
    try {
      files = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.toLowerCase().endsWith(".png")) continue;
      const full = path.join(dir, f);
      const size = fs.statSync(full).size;
      if (!best || size > best.size) best = { path: full, size };
    }
  }
  return best?.path;
}

function dataUrlFor(filePath: string, mime: string): string | undefined {
  try {
    const buf = fs.readFileSync(filePath);
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return undefined;
  }
}

/** Weight keywords (incl. common German names) -> numeric CSS weight. */
const WEIGHT_TOKENS: Record<string, number> = {
  thin: 100,
  hairline: 100,
  extralight: 200,
  ultralight: 200,
  ultrathin: 200,
  light: 300,
  leicht: 300,
  normal: 400,
  regular: 400,
  roman: 400,
  book: 400,
  buch: 400,
  text: 400,
  medium: 500,
  kraftig: 500,
  "kräftig": 500,
  semibold: 600,
  demibold: 600,
  demi: 600,
  halbfett: 600,
  bold: 700,
  fett: 700,
  extrabold: 800,
  ultrabold: 800,
  heavy: 800,
  black: 900,
  schwarz: 900,
};
const STYLE_TOKENS = new Set(["italic", "oblique", "kursiv", "ital"]);

/** Parse weight + style + a clean family display name from a font file name. */
function parseFontName(base: string): {
  family: string;
  weight: number;
  style: "normal" | "italic";
} {
  const tokens = base.split(/[-_\s]+/).filter(Boolean);
  let weight = 400;
  let style: "normal" | "italic" = "normal";
  const familyTokens: string[] = [];
  for (const tok of tokens) {
    const low = tok.toLowerCase();
    if (STYLE_TOKENS.has(low)) {
      style = "italic";
      continue;
    }
    if (low in WEIGHT_TOKENS) {
      weight = WEIGHT_TOKENS[low];
      continue;
    }
    familyTokens.push(tok);
  }
  const family = familyTokens.join(" ").trim() || base;
  return { family, weight, style };
}

/** Locate bundled custom font files, one entry per weight/style face. */
function findFonts(root: string): FontAsset[] {
  const fontFiles = walk(root, {
    match: (p) => /\.(ttf|otf)$/i.test(p),
    maxDepth: 8,
  });
  const seen = new Set<string>();
  const fonts: FontAsset[] = [];
  for (const file of fontFiles) {
    const ext = path.extname(file).toLowerCase();
    const { family, weight, style } = parseFontName(path.basename(file, ext));
    // De-dupe per face (family + weight + style), not per family, so distinct
    // weights and italics are all available to the picker.
    const key = `${family.toLowerCase()}|${weight}|${style}`;
    if (seen.has(key)) continue;
    seen.add(key);
    fonts.push({
      family,
      path: file,
      format: ext === ".otf" ? "opentype" : "truetype",
      dataUrl: dataUrlFor(file, ext === ".otf" ? "font/otf" : "font/ttf"),
      weight,
      style,
    });
  }
  return fonts;
}

/** Best-effort scan of source for SF Symbols references. */
function findSfSymbols(root: string): string[] {
  const sources = walk(root, {
    match: (p) => /\.swift$/i.test(p),
    maxDepth: 8,
  });
  const symbols = new Set<string>();
  const re = /system(?:Name|Image):\s*"([^"]+)"/g;
  for (const file of sources.slice(0, 800)) {
    let text: string;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) symbols.add(m[1]);
  }
  return [...symbols].slice(0, 60);
}

export function readDesignTokens(root: string): DesignTokens {
  const { colors, colorsDark } = readColorSets(root);
  const appIconPath = findAppIcon(root);
  const fonts = findFonts(root);
  const sfSymbols = findSfSymbols(root);

  // Prefer an explicitly named accent/brand color, else the first color found.
  const accentKey = Object.keys(colors).find((k) =>
    /accent|brand|primary|tint/i.test(k),
  );
  const accentColor = accentKey
    ? colors[accentKey]
    : Object.values(colors)[0];

  return {
    colors,
    colorsDark,
    fonts,
    appIconPath,
    appIconDataUrl: appIconPath ? dataUrlFor(appIconPath, "image/png") : undefined,
    sfSymbols,
    accentColor,
  };
}
