import fs from "node:fs";
import { openaiConfigFile } from "../paths.js";

export interface OpenAIStoredConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
}

export interface OpenAIResolved {
  apiKey: string;
  baseUrl: string;
  model: string;
  /** Where the key came from — UI-saved file vs process env. */
  source: "file" | "env";
}

/**
 * Persist the OpenAI key under ~/.lss (never in the Xcode project tree).
 */
export function saveOpenAIConfig(input: {
  apiKey: string;
  baseUrl?: string;
  model?: string;
}): void {
  const apiKey = input.apiKey.trim();
  if (!apiKey) throw new Error("apiKey is required");
  const next: OpenAIStoredConfig = { apiKey };
  const baseUrl = input.baseUrl?.trim();
  const model = input.model?.trim();
  if (baseUrl) next.baseUrl = baseUrl;
  if (model) next.model = model;
  fs.writeFileSync(openaiConfigFile(), JSON.stringify(next, null, 2), {
    mode: 0o600,
  });
}

export function loadOpenAIConfig(): OpenAIStoredConfig | null {
  try {
    const raw = JSON.parse(
      fs.readFileSync(openaiConfigFile(), "utf8"),
    ) as OpenAIStoredConfig;
    if (!raw?.apiKey?.trim()) return null;
    return raw;
  } catch {
    return null;
  }
}

export function clearOpenAIConfig(): void {
  try {
    fs.unlinkSync(openaiConfigFile());
  } catch {
    /* already gone */
  }
}

export function hasOpenAIConfig(): boolean {
  return resolveOpenAI() !== null;
}

/**
 * Prefer the user-entered key in ~/.lss; fall back to OPENAI_API_KEY for local
 * engine/dev workflows. Packaged app UX should always go through the UI save.
 */
export function resolveOpenAI(): OpenAIResolved | null {
  const stored = loadOpenAIConfig();
  if (stored?.apiKey) {
    return {
      apiKey: stored.apiKey,
      baseUrl:
        stored.baseUrl?.trim() ||
        process.env.OPENAI_BASE_URL ||
        "https://api.openai.com/v1",
      model:
        stored.model?.trim() ||
        process.env.LSS_TRANSLATE_MODEL ||
        process.env.LSS_GEN_MODEL ||
        "gpt-4o-mini",
      source: "file",
    };
  }
  const envKey = process.env.OPENAI_API_KEY?.trim();
  if (!envKey) return null;
  return {
    apiKey: envKey,
    baseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
    model:
      process.env.LSS_TRANSLATE_MODEL ??
      process.env.LSS_GEN_MODEL ??
      "gpt-4o-mini",
    source: "env",
  };
}
