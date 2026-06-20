# Localized Screenshot & Release Studio

A visual desktop studio that reads localization and release data straight from
your Xcode project, uses AI to generate per-screen React replicas, renders
**pixel-exact** localized screenshots in a real browser engine, composites them
into App Store promo frames, and uploads everything to **App Store Connect** —
with a reviewable, retryable pipeline.

**No fastlane. No Xcode UI automation.**

## Why

Capturing localized screenshots, framing them, and uploading screenshots +
release notes to dozens of App Store languages is slow and brittle with
fastlane (especially for Mac apps). This tool replaces that with:

1. **Project Reader** — parses `.xcstrings` String Catalogs and legacy
   `.strings`, finds release notes, and extracts design tokens (named colors,
   custom fonts, app icon, SF Symbols) to keep replicas on-brand.
2. **AI Screen Generator** — produces a version-controlled React replica per
   screen with all visible text externalized to your string keys. Works offline
   via a deterministic fallback; uses an LLM when `OPENAI_API_KEY` is set.
3. **Capture Engine** — renders each screen × locale at exact App Store device
   sizes with Playwright (pinned `deviceScaleFactor`), and flags text overflow.
4. **Frame Compositor** — composites captures into framed promo images with a
   background and a localized marketing headline (via `sharp`).
5. **App Store Connect Engine** — ES256 JWT auth, screenshot
   reserve→upload→commit→verify flow, release-notes/metadata `PATCH`, retries.
6. **Visual Workflow UI** — a screen × locale matrix, live preview/edit, staged
   approval gates, and a live upload dashboard with per-cell retry.

## Architecture

```
React UI (Vite)  ──HTTP──►  Node engine (Express)  ──►  Playwright / sharp / ASC API
     ▲                              │
     └──────── Tauri shell ─────────┘   (packages UI + engine into a .app)
```

- `engine/` — the local engine (TypeScript, runs on `127.0.0.1:8787`).
- `ui/` — the React workflow UI (Vite). Proxies `/api` + `/render` to the engine.
- `src-tauri/` — the Tauri desktop shell.
- `fixtures/SampleApp/` — a sample Xcode-style project for the demo/slice.

## Prerequisites

- Node 18+ (tested on 26)
- Rust + Cargo (only for the Tauri desktop build)
- Chromium for Playwright: `npm run -w engine exec playwright install chromium`

## Quick start

```bash
npm install
npx playwright install chromium          # one-time browser download

# Prove the whole pipeline end-to-end on the sample project:
npm run slice

# Run the studio in the browser (engine + UI):
npm run dev                              # UI on http://localhost:5173

# Or run it as a desktop app (requires Rust):
npm run tauri:dev
```

In the UI, paste the path to an `.xcodeproj` (or its folder) to open a project.
The bundled sample lives at `fixtures/SampleApp`.

## App Store Connect credentials

Create an API key in App Store Connect (Users and Access → Integrations → Keys).
In the studio, click **Add credentials** and paste the Issuer ID, Key ID, App
ID, and the `.p8` contents. The private key is stored **outside** the project
(under `~/.lss/credentials`, a Keychain stand-in) and never written to
`project.json`. Without credentials, uploads run as a safe **dry run** that
simulates the full pipeline.

## Where state lives

Per-app studio state is stored in `<yourXcodeProject>/.lss/`:

- `project.json` — screens, the screen×locale×preset cell matrix, compositor config.
- `templates/*.tsx` — generated, version-controllable screen replicas.
- `assets/captures`, `assets/composed` — generated images.

## Environment variables

| Variable          | Purpose                                            |
| ----------------- | -------------------------------------------------- |
| `OPENAI_API_KEY`  | Enables LLM screen generation (else uses fallback) |
| `OPENAI_BASE_URL` | OpenAI-compatible endpoint (optional)              |
| `LSS_GEN_MODEL`   | Generation model (default `gpt-4o-mini`)           |
| `LSS_PORT`        | Engine port (default `8787`)                       |
