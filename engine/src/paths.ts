import path from "node:path";
import os from "node:os";
import fs from "node:fs";

/**
 * All studio state for a given app lives in `<xcodeProjectDir>/.lss/` so
 * layouts can sit alongside the Xcode project. Secrets stay out of this tree.
 */
export interface ProjectPaths {
  root: string; // the opened xcode project directory
  dataDir: string; // <root>/.lss
  projectFile: string; // <root>/.lss/project.json
  templatesDir: string; // <root>/.lss/templates  (version-controlled .tsx)
  assetsDir: string; // <root>/.lss/assets
  capturesDir: string; // <root>/.lss/assets/captures
  composedDir: string; // <root>/.lss/assets/composed
  referencesDir: string; // <root>/.lss/assets/references
  overlayDir: string; // <root>/.lss/assets/overlay (source uploads + clean plates)
}

export function projectPaths(root: string): ProjectPaths {
  const dataDir = path.join(root, ".lss");
  const assetsDir = path.join(dataDir, "assets");
  return {
    root,
    dataDir,
    projectFile: path.join(dataDir, "project.json"),
    templatesDir: path.join(dataDir, "templates"),
    assetsDir,
    capturesDir: path.join(assetsDir, "captures"),
    composedDir: path.join(assetsDir, "composed"),
    referencesDir: path.join(assetsDir, "references"),
    overlayDir: path.join(assetsDir, "overlay"),
  };
}

export function ensureProjectDirs(root: string): ProjectPaths {
  const p = projectPaths(root);
  for (const dir of [
    p.dataDir,
    p.templatesDir,
    p.assetsDir,
    p.capturesDir,
    p.composedDir,
    p.referencesDir,
    p.overlayDir,
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return p;
}

/** Global, machine-local studio dir (last project, credential stand-in). */
export function globalDir(): string {
  const dir = path.join(os.homedir(), ".lss");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function globalSettingsFile(): string {
  return path.join(globalDir(), "settings.json");
}

/**
 * Machine-local ASC private key (outside the Xcode project). Files are
 * mode 0600 under ~/.lss/credentials — never in project.json. A packaged
 * .app could move this to the macOS Keychain later; this is the store today.
 */
export function credentialFile(appId: string): string {
  const dir = path.join(globalDir(), "credentials");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return path.join(dir, `${appId.replace(/[^\w.-]/g, "_")}.p8`);
}

/**
 * Machine-local OpenAI API key (outside any Xcode project). Same ~/.lss
 * file store as ASC credentials — never written to project.json.
 */
export function openaiConfigFile(): string {
  return path.join(globalDir(), "openai.json");
}
