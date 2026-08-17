import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveOpenAI } from "../openai/credentials.js";

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const SWIFT_SCRIPT = path.join(here, "visionOcr.swift");

/** A single detected text region, normalized 0..1 with a top-left origin. */
export interface OcrLine {
  text: string;
  confidence: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface OcrResult {
  lines: OcrLine[];
  engine: "apple-vision" | "openai" | "none";
}

function sanitize(lines: OcrLine[]): OcrLine[] {
  return lines
    .filter(
      (l) =>
        typeof l.text === "string" &&
        l.text.trim().length > 0 &&
        [l.x, l.y, l.w, l.h].every((n) => typeof n === "number" && isFinite(n)),
    )
    .map((l) => ({
      text: l.text.trim(),
      confidence: typeof l.confidence === "number" ? l.confidence : 0.5,
      x: Math.max(0, Math.min(1, l.x)),
      y: Math.max(0, Math.min(1, l.y)),
      w: Math.max(0, Math.min(1, l.w)),
      h: Math.max(0, Math.min(1, l.h)),
    }));
}

/** Run Apple's Vision OCR via the bundled Swift sidecar (macOS only). */
async function appleVision(imagePath: string): Promise<OcrLine[] | null> {
  if (process.platform !== "darwin") return null;
  if (!fs.existsSync(SWIFT_SCRIPT)) return null;
  try {
    const { stdout } = await execFileAsync("swift", [SWIFT_SCRIPT, imagePath], {
      timeout: 60_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    const parsed = JSON.parse(stdout.trim() || "[]") as OcrLine[];
    return sanitize(parsed);
  } catch {
    return null;
  }
}

/** Fallback OCR via an OpenAI vision model. Geometry is approximate. */
async function openaiVision(imagePath: string): Promise<OcrLine[] | null> {
  const api = resolveOpenAI();
  if (!api) return null;
  const { apiKey, baseUrl, model } = api;
  const buf = fs.readFileSync(imagePath);
  const dataUrl = `data:image/png;base64,${buf.toString("base64")}`;

  const prompt = `You are an OCR engine for an app-store screenshot. Return ONLY a JSON array.
Each element: {"text": string, "x": number, "y": number, "w": number, "h": number}.
Coordinates are normalized 0..1 with the ORIGIN AT THE TOP-LEFT; (x,y) is the
top-left of the text's bounding box and (w,h) its size. Detect every visible
text run (titles, labels, buttons). Ignore decorative icons. No prose, JSON only.`;

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    let content = json.choices?.[0]?.message?.content ?? "";
    content = content.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    const start = content.indexOf("[");
    const end = content.lastIndexOf("]");
    if (start < 0 || end < 0) return null;
    const parsed = JSON.parse(content.slice(start, end + 1)) as OcrLine[];
    return sanitize(parsed);
  } catch {
    return null;
  }
}

/** Detect text regions in an image, preferring on-device Apple Vision. */
export async function detectText(imagePath: string): Promise<OcrResult> {
  const vision = await appleVision(imagePath);
  if (vision && vision.length) return { lines: vision, engine: "apple-vision" };

  const openai = await openaiVision(imagePath);
  if (openai && openai.length) return { lines: openai, engine: "openai" };

  return { lines: [], engine: "none" };
}
