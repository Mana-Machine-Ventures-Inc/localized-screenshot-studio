export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function parseHex(hex: string): { r: number; g: number; b: number } | null {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

export function toHex(r: number, g: number, b: number): string {
  const h = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** Canonical `#rrggbb` or null if the string is not a color we can use. */
export function normalizeHex(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const rgb = parseHex(raw);
  return rgb ? toHex(rgb.r, rgb.g, rgb.b) : null;
}

export function parseCssColorToHex(css: string): string | null {
  if (!css || css === "transparent") return null;
  const hex = parseHex(css);
  if (hex) return toHex(hex.r, hex.g, hex.b);
  const m = css.match(
    /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/i,
  );
  if (!m) return null;
  const a = m[4] === undefined ? 1 : Number(m[4]);
  if (a < 0.01) return null;
  return toHex(Number(m[1]), Number(m[2]), Number(m[3]));
}
