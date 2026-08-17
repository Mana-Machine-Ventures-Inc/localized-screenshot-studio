import { store } from "../store.js";
import { resolveOpenAI } from "../openai/credentials.js";

export interface LocalizeKeyResult {
  key: string;
  baseLocale: string;
  baseValue: string;
  engine: "openai" | "none";
  model?: string;
  /** locale -> translated value or an error explaining why it's missing. */
  results: Record<string, { value?: string; error?: string }>;
}

function failAll(
  base: LocalizeKeyResult,
  locales: string[],
  error: string,
): LocalizeKeyResult {
  for (const l of locales) base.results[l] = { error };
  return base;
}

/**
 * Translate a single key's default-language value into every target locale in
 * one LLM pass. The full default-language string index is supplied as context
 * so terminology and tone stay consistent across the app.
 */
export async function localizeKey(
  key: string,
  targetLocales: string[],
): Promise<LocalizeKeyResult> {
  const cfg = store.getConfig();
  const baseLocale = cfg.baseLocale;
  const merged = store.getMergedStrings();
  const entry = merged.find((s) => s.key === key);
  const baseValue = entry?.values[baseLocale] ?? "";

  const out: LocalizeKeyResult = {
    key,
    baseLocale,
    baseValue,
    engine: "none",
    results: {},
  };

  if (!baseValue.trim()) {
    return failAll(out, targetLocales, "No source value to translate");
  }
  const api = resolveOpenAI();
  if (!api) {
    return failAll(
      out,
      targetLocales,
      "OpenAI API key is not set — add it in Project settings",
    );
  }

  const { apiKey, baseUrl, model } = api;
  out.model = model;

  // Whole default-language index for glossary/terminology/tone context.
  const appStringIndex: Record<string, string> = {};
  for (const s of merged) {
    const v = s.values[baseLocale];
    if (v && v.trim()) appStringIndex[s.key] = v;
  }

  const system =
    "You are a professional software localizer for an iOS/macOS application. " +
    "Translate UI strings naturally and concisely, matching the tone, register, " +
    "and length of the source. Preserve ALL placeholders and format specifiers " +
    "exactly (e.g. %@, %d, %1$@, {name}, \\n) and keep punctuation style. Never " +
    "add quotes, notes, or commentary.";

  const user = JSON.stringify({
    task: "translate_one_key_into_many_locales",
    sourceLocale: baseLocale,
    key,
    sourceValue: baseValue,
    targetLocales,
    appStringIndex,
    response:
      "Return ONLY a JSON object mapping each requested target locale code to its " +
      "translated string. Include every target locale.",
  });

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return failAll(
        out,
        targetLocales,
        `LLM request failed (${res.status})${detail ? `: ${detail.slice(0, 120)}` : ""}`,
      );
    }
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    let content = json.choices?.[0]?.message?.content ?? "";
    content = content.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    const start = content.indexOf("{");
    const end = content.lastIndexOf("}");
    if (start < 0 || end < 0) {
      return failAll(out, targetLocales, "LLM returned no JSON object");
    }
    const parsed = JSON.parse(content.slice(start, end + 1)) as Record<
      string,
      unknown
    >;
    out.engine = "openai";
    for (const locale of targetLocales) {
      const v = parsed[locale];
      if (typeof v === "string" && v.trim()) {
        out.results[locale] = { value: v };
      } else {
        out.results[locale] = { error: "No translation returned" };
      }
    }
    return out;
  } catch (e) {
    return failAll(
      out,
      targetLocales,
      String(e instanceof Error ? e.message : e),
    );
  }
}
