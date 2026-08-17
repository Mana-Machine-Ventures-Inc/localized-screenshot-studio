# Localized Screenshot Studio

A visual desktop studio that reads localization and release data from your
Xcode project, overlays localized text onto your real screenshots, composites
them into App Store promo frames, and uploads everything to
**App Store Connect**.

**No fastlane. No Xcode UI automation.**

macOS is the supported platform. Bring your own OpenAI key (optional, for AI
localization) and your own App Store Connect API key (optional, for real
uploads). Nothing is billed through this project.

## Why

Capturing localized screenshots, framing them, and uploading screenshots plus
release notes to dozens of App Store languages is slow and brittle with
fastlane — especially for Mac apps. This tool replaces that with:

1. **Project reader** — parses `.xcstrings` String Catalogs and legacy
   `.strings` (and can write back to them), finds release notes, and extracts
   design tokens (named colors, custom fonts).
2. **Overlay editor** — you upload a screenshot once, the studio detects the
   text, masks it, and lets you place each string in a precise box with full
   typography control. Language is a display asset over one canonical layout.
3. **Capture engine** — renders each screen × locale at exact App Store device
   sizes with Playwright (pinned `deviceScaleFactor`).
4. **Frame compositor** — composites captures into framed promo images with a
   background and a localized marketing headline (via `sharp`).
5. **App Store Connect engine** — ES256 JWT auth, screenshot
   reserve→upload→commit→verify, release-notes/metadata `PATCH`, retries.
6. **Workflow UI** — Overview / Project / Strings / Screens / Generate /
   Upload, with a live upload dashboard and per-cell retry.

## Requirements

- **macOS** (Apple Vision OCR and Xcode-project workflows assume it)
- **Node.js 18+** — the only hard runtime requirement
- **Xcode Command Line Tools** — used by the Swift Vision OCR sidecar
  (`xcode-select --install`). Without them, OCR falls back to OpenAI vision if
  you have configured a key
- An **OpenAI API key** — only if you want AI localization or OCR fallback.
  Enter it in the UI; do not commit it
- An **App Store Connect API key** — only if you want real uploads. Without
  it, uploads run as a safe dry run

Rust / Xcode full toolchain are **not** required for `npm run dev`. They are
only needed if you want the native Tauri window (`npm run tauri:dev`).

## Quick start

```bash
git clone https://github.com/Mana-Machine-Ventures-Inc/localized-screenshot-studio.git
cd localized-screenshot-studio
npm install          # also downloads Chromium for Playwright (~150–200 MB)
npm run dev          # engine on :8787, UI on :5173
```

Then open [http://localhost:5173](http://localhost:5173).

`npm install` can take a few minutes the first time — it fetches the right
Chromium build and the native `sharp` binary for your CPU.

In the UI, open an `.xcodeproj` (or its folder). To try the studio without
your own app, open `fixtures/SampleApp`. The last project is remembered and
reopened on the next launch.

**Ports:** engine `8787`, UI `5173`. If `8787` is taken, the engine prints how
to free it, or run `LSS_PORT=8788 npm run dev`.

### Native window (optional)

```bash
# Rust toolchain: https://rustup.rs  +  xcode-select --install
npm run tauri:dev
```

Or double-click `Launch Studio.command` in the repo root.

A distributable `.app` / `.dmg` is **not** wired up yet. `npm run tauri:build`
compiles a window, but the Node engine is not packaged as a sidecar, so the
shipped app cannot run the pipeline. Until that exists, distribution is this
repo plus `npm run dev` / `npm run tauri:dev`. A signed Mac build would also
need Apple Developer ID signing and notarization.

## First-run checklist

1. Open an Xcode project (or `fixtures/SampleApp`).
2. **OpenAI (optional)** — paste your API key in the UI. Required for AI
   localization and as the OCR fallback. Stored only on this Mac.
3. **App Store Connect (optional)** — paste Issuer ID, Key ID, App ID, and
   `.p8` contents. Without credentials, Generate still works and Upload runs
   as a dry run.
4. Import screenshots, place overlay slots, generate, review, upload.

## Secrets

This project never ships a shared API key. Each user brings their own.

| Secret | Where it lives | What it is not |
| --- | --- | --- |
| OpenAI API key | `~/.lss/openai.json` (file mode `0600`), or `OPENAI_API_KEY` in a local `.env` | Never written to `project.json` or the Xcode tree |
| App Store Connect `.p8` | `~/.lss/credentials/<appId>.p8` (dir `0700`, file `0600`) | Never written to `project.json` — only a redacted reference is stored |

`~/.lss` is in your home directory, outside any git repo. `.env`, `.p8`, and
`.lss/` are gitignored.

The UI is the supported way to save keys. A root `.env` (see `.env.example`)
is an optional fallback for local engine/dev work. Real environment variables
always win over `.env` values.

Do not commit `.env`, `.p8` files, or anything under `~/.lss`. Treat an ASC
key as more sensitive than an OpenAI key — it can upload to App Store Connect.

File-based storage under `~/.lss` is intentional for this developer-distributed
tool. A future packaged `.app` could move the same secrets into the macOS
Keychain; that is not required to use the studio today.

## Where project state lives

Per-app studio state is stored in `<yourXcodeProject>/.lss/`:

- `project.json` — screens + overlay layouts, the screen×locale×preset cell
  matrix, and compositor config. No secrets.
- `assets/overlay` — source uploads and masked clean plates.
- `assets/captures`, `assets/composed` — generated images.

Strings and fonts are re-read live from the Xcode project on every open, so
the catalog stays the source of truth. Generated `assets/*.png` files are
large and fully regenerable — consider gitignoring them in the app repo.

## Architecture

```
React UI (Vite)  ──HTTP──►  Node engine (Express)  ──►  Playwright / sharp / ASC API
     ▲                              │
     └──────── Tauri shell ─────────┘
```

- `engine/` — local engine (TypeScript) on `127.0.0.1:8787` only.
- `ui/` — React workflow UI (Vite). In dev it proxies `/api`, `/render`,
  `/overlay` to the engine.
- `src-tauri/` — optional native window.

## Environment variables

All optional. Prefer the UI for keys.

| Variable | Purpose |
| --- | --- |
| `OPENAI_API_KEY` | Fallback if no key has been saved in the UI |
| `OPENAI_BASE_URL` | OpenAI-compatible endpoint (Azure, proxy, etc.) |
| `LSS_TRANSLATE_MODEL` | Translation model (default `gpt-4o-mini`) |
| `LSS_GEN_MODEL` | Alias used if `LSS_TRANSLATE_MODEL` is unset |
| `LSS_PORT` | Engine port (default `8787`) |

## License

[MIT](LICENSE)
