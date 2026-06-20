import type { ProjectFont } from "./api";

export interface FontOption {
  id: string;
  label: string;
  /** CSS font-family value to store on the slot/composition. */
  family: string;
  source: "project" | "system";
  weights: number[];
  italic: boolean;
}

export const ALL_WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900];

const WEIGHT_NAMES: Record<number, string> = {
  100: "Thin",
  200: "Extra Light",
  300: "Light",
  400: "Regular",
  500: "Medium",
  600: "Semibold",
  700: "Bold",
  800: "Extra Bold",
  900: "Black",
};

export function weightLabel(w: number): string {
  return WEIGHT_NAMES[w] ? `${WEIGHT_NAMES[w]} · ${w}` : String(w);
}

/** Curated families that ship with macOS/iOS — always offered as fallbacks. */
export const SYSTEM_FONTS: FontOption[] = [
  {
    id: "sys-sf-text",
    label: "SF Pro Text",
    family: '"SF Pro Text", -apple-system, system-ui, sans-serif',
    source: "system",
    weights: ALL_WEIGHTS,
    italic: true,
  },
  {
    id: "sys-sf-display",
    label: "SF Pro Display",
    family: '"SF Pro Display", -apple-system, system-ui, sans-serif',
    source: "system",
    weights: ALL_WEIGHTS,
    italic: true,
  },
  {
    id: "sys-system",
    label: "System (San Francisco)",
    family: "-apple-system, system-ui, sans-serif",
    source: "system",
    weights: ALL_WEIGHTS,
    italic: true,
  },
  {
    id: "sys-ny",
    label: "New York (Serif)",
    family: 'ui-serif, "New York", Georgia, serif',
    source: "system",
    weights: [300, 400, 500, 600, 700, 800],
    italic: true,
  },
  {
    id: "sys-helvetica",
    label: "Helvetica Neue",
    family: '"Helvetica Neue", Helvetica, Arial, sans-serif',
    source: "system",
    weights: [100, 200, 300, 400, 500, 700],
    italic: true,
  },
  {
    id: "sys-avenir",
    label: "Avenir Next",
    family: '"Avenir Next", Avenir, sans-serif',
    source: "system",
    weights: [400, 500, 600, 700, 800],
    italic: true,
  },
  {
    id: "sys-arial",
    label: "Arial",
    family: "Arial, Helvetica, sans-serif",
    source: "system",
    weights: [400, 700],
    italic: true,
  },
  {
    id: "sys-georgia",
    label: "Georgia (Serif)",
    family: 'Georgia, "Times New Roman", serif',
    source: "system",
    weights: [400, 700],
    italic: true,
  },
  {
    id: "sys-times",
    label: "Times New Roman (Serif)",
    family: '"Times New Roman", Times, serif',
    source: "system",
    weights: [400, 700],
    italic: true,
  },
  {
    id: "sys-menlo",
    label: "Menlo (Mono)",
    family: "Menlo, ui-monospace, monospace",
    source: "system",
    weights: [400, 700],
    italic: true,
  },
  {
    id: "sys-courier",
    label: "Courier New (Mono)",
    family: '"Courier New", ui-monospace, monospace',
    source: "system",
    weights: [400, 700],
    italic: true,
  },
];

/** Merge the project's bundled fonts with the curated system list. */
export function buildFontOptions(project: ProjectFont[]): FontOption[] {
  const proj: FontOption[] = project.map((f, i) => ({
    id: `proj-${i}-${f.label}`,
    label: f.label,
    family: f.family,
    source: "project",
    weights: f.weights.length ? f.weights : ALL_WEIGHTS,
    italic: f.italic,
  }));
  return [...proj, ...SYSTEM_FONTS];
}

/** The first, de-quoted family token of a CSS font-family value. */
export function primaryFamily(css: string): string {
  const first = css.split(",")[0]?.trim() ?? css;
  return first.replace(/^["']|["']$/g, "").toLowerCase();
}

/** Find the option whose family matches a stored css value (exact, then loose). */
export function matchFont(
  options: FontOption[],
  family: string,
): FontOption | undefined {
  if (!family) return undefined;
  const exact = options.find((o) => o.family === family);
  if (exact) return exact;
  const primary = primaryFamily(family);
  return options.find((o) => primaryFamily(o.family) === primary);
}

/** Snap a desired weight to the nearest weight a family actually offers. */
export function nearestWeight(weights: number[], want: number): number {
  if (!weights.length || weights.includes(want)) return want;
  return weights.reduce(
    (best, w) => (Math.abs(w - want) < Math.abs(best - want) ? w : best),
    weights[0],
  );
}
