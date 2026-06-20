import { store } from "../store.js";
import type { LocalizedString } from "../types.js";

/** Normalize a string for resilient comparison. */
function normalize(s: string): string {
  return s
    .normalize("NFC")
    .replace(/\u2026/g, "...")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^["']|["']$/g, "")
    .replace(/[.,:;!?]+$/g, "")
    .toLowerCase();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

function similarity(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  if (max === 0) return 1;
  return 1 - levenshtein(a, b) / max;
}

const FORMAT_SPEC = /%(?:\d+\$)?[-+ 0#]?\d*(?:\.\d+)?(?:hh|h|ll|l|q|L|z|t|j)?[@diouxXeEfgGaAcspn%]/g;

/** Build a regex from a format string so "%lld days" matches "3 days". */
function formatRegex(value: string): RegExp | null {
  if (!FORMAT_SPEC.test(value)) return null;
  FORMAT_SPEC.lastIndex = 0;
  const escaped = value
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/%%/g, "%");
  // Re-run on the escaped string: specifiers survive escaping except the leading %.
  const pattern = escaped.replace(
    /%(?:\d+\\?\$)?[-+ 0#]?\d*(?:\\?\.\d+)?(?:hh|h|ll|l|q|L|z|t|j)?[@diouxXeEfgGaAcspn]/g,
    "(.+?)",
  );
  try {
    return new RegExp(`^${pattern}$`, "i");
  } catch {
    return null;
  }
}

interface IndexEntry {
  key: string;
  value: string;
  norm: string;
  regex: RegExp | null;
}

function buildIndex(locale: string, strings: LocalizedString[]): IndexEntry[] {
  return strings.map((s) => {
    const value = s.values[locale] ?? s.values[store.getConfig().baseLocale] ?? s.key;
    return { key: s.key, value, norm: normalize(value), regex: formatRegex(value) };
  });
}

export interface MatchResult {
  key?: string;
  /** 0..1 match confidence. */
  score: number;
  method: "exact" | "format" | "fuzzy" | "none";
}

/** Match a single OCR string to the best localizable key in the source locale. */
export function matchText(text: string, locale: string): MatchResult {
  const merged = store.getMergedStrings();
  if (!merged.length) return { score: 0, method: "none" };
  const index = buildIndex(locale, merged);
  const norm = normalize(text);
  if (!norm) return { score: 0, method: "none" };

  // 1) Exact (normalized) match.
  const exact = index.find((e) => e.norm === norm);
  if (exact) return { key: exact.key, score: 1, method: "exact" };

  // 2) Format-string match (e.g. "%lld days" vs "3 days").
  for (const e of index) {
    if (e.regex && e.regex.test(text.trim())) {
      return { key: e.key, score: 0.9, method: "format" };
    }
  }

  // 3) Fuzzy match (OCR noise / truncation).
  let best: { key: string; score: number } | null = null;
  for (const e of index) {
    if (!e.norm) continue;
    const score = similarity(norm, e.norm);
    if (!best || score > best.score) best = { key: e.key, score };
  }
  if (best && best.score >= 0.82) {
    return { key: best.key, score: best.score, method: "fuzzy" };
  }
  return { score: best?.score ?? 0, method: "none" };
}
