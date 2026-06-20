import path from "node:path";
import os from "node:os";
import fs from "node:fs";

/**
 * All studio state for a given app lives in `<xcodeProjectDir>/.lss/` so that
 * generated templates are version-controlled alongside the app, exactly as the
 * plan specifies. Secrets (ASC private keys) are kept out of the project dir.
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
 * Stand-in for the OS keychain. Private keys are stored here (outside the
 * project, gitignored by virtue of living in the home dir) keyed by appId.
 * In a shipped build this is replaced by the macOS Keychain.
 */
export function credentialFile(appId: string): string {
  const dir = path.join(globalDir(), "credentials");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return path.join(dir, `${appId.replace(/[^\w.-]/g, "_")}.p8`);
}
