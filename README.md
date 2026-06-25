# Localized Screenshot & Release Studio

A visual desktop studio that reads localization and release data straight from
your Xcode project, overlays localized text onto your real screenshots,
composites them into App Store promo frames, and uploads everything to
**App Store Connect** — with a reviewable, retryable pipeline.

**No fastlane. No Xcode UI automation.**

## Why

Capturing localized screenshots, framing them, and uploading screenshots +
release notes to dozens of App Store languages is slow and brittle with
fastlane (especially for Mac apps). This tool replaces that with:

1. **Project Reader** — parses `.xcstrings` String Catalogs and legacy
   `.strings` (and can write back to them), finds release notes, and extracts
   design tokens (named colors, custom fonts).
2. **Overlay editor** — you upload a screenshot once, the studio detects the
   text, masks it, and lets you place each string in a precise box with full
   typography control. Language is just a display asset over one canonical
   layout, so it "just works" for every locale.
3. **Capture Engine** — renders each screen × locale at exact App Store device
   sizes with Playwright (pinned `deviceScaleFactor`).
4. **Frame Compositor** — composites captures into framed promo images with a
   background and a localized marketing headline (via `sharp`).
5. **App Store Connect Engine** — ES256 JWT auth, screenshot
   reserve→upload→commit→verify flow, release-notes/metadata `PATCH`, retries.
6. **Visual Workflow UI** — Project / Strings / Screens / Compositions /
   Generate / Upload tabs, with a live upload dashboard and per-cell retry.

## Architecture

```
React UI (Vite)  ──HTTP──►  Node engine (Express)  ──►  Playwright / sharp / ASC API
     ▲                              │
     └──────── Tauri shell ─────────┘
```

- `engine/` — the local engine (TypeScript, runs on `127.0.0.1:8787`).
- `ui/` — the React workflow UI (Vite). Proxies `/api`, `/render`, `/overlay`
  to the engine in dev.
- `src-tauri/` — the Tauri desktop shell (native window).

## Run it

```bash
# 1. Prerequisites: Node 18+ (the only hard requirement)
npm install                  # also fetches Chromium (Playwright) + sharp's native binary

# 2a. Run in the browser — the simplest way:
npm run dev                  # opens the engine + UI; visit http://localhost:5173

# 2b. …or as a native desktop window (needs Rust toolchain — see below):
npm run tauri:dev
```

`npm install` does the heavy lifting per-machine: it downloads the right
Chromium for Playwright and the right native `sharp` binary for your CPU, so
every developer gets a working setup with one command — no manual bundling.

Then in the UI, paste the path to an `.xcodeproj` (or its folder) to open a
project. The studio remembers your last project and reopens it automatically.

**Ports:** the engine uses `8787` and the UI dev server `5173`. If something
else is already on `8787` the engine prints how to free it (or set
`LSS_PORT=8788 npm run dev`).

### Native desktop window (`tauri:dev`)

`npm run tauri:dev` runs the same engine + UI inside a native Tauri window
(requires the Rust toolchain: `curl https://sh.rustup.rs -sSf | sh` and
`xcode-select --install`). This is the recommended "app-like" experience for
developers today.

> **Building a distributable `.app`/`.dmg` (`npm run tauri:build`) is not yet
> wired up.** The bundle compiles, but the Node engine isn't packaged into it as
> a sidecar, so the shipped app can't reach the engine. Distributing a
> double-click app also requires Apple Developer ID signing + notarization.
> Until that's built, share the repo and run with `npm run dev` /
> `npm run tauri:dev`.

## App Store Connect credentials

Create an API key in App Store Connect (Users and Access → Integrations → Keys).
In the studio, click **Add credentials** and paste the Issuer ID, Key ID, App
ID, and the `.p8` contents. The private key is stored **outside** the project
(under `~/.lss/credentials`, a Keychain stand-in) and never written to
`project.json`. Without credentials, uploads run as a safe **dry run** that
simulates the full pipeline.

## Where state lives

Per-app studio state is stored in `<yourXcodeProject>/.lss/`:

- `project.json` — screens + overlay layouts, the screen×locale×preset cell
  matrix, and compositor config.
- `assets/overlay` — source uploads and masked "clean plates".
- `assets/captures`, `assets/composed` — generated images.

Strings and fonts are re-read live from the Xcode project on every open, so the
catalog stays the source of truth. The `assets/*.png` files are large and fully
regenerable — consider gitignoring them.

## Environment variables

| Variable             | Purpose                                              |
| -------------------- | ---------------------------------------------------- |
| `OPENAI_API_KEY`     | Enables AI translation of missing localizations      |
| `OPENAI_BASE_URL`    | OpenAI-compatible endpoint (optional)                |
| `LSS_TRANSLATE_MODEL`| Translation model (default `gpt-4o-mini`)            |
| `LSS_PORT`           | Engine port (default `8787`)                         |
