/**
 * Native folder / .xcodeproj picker when running inside Tauri.
 * Returns null if the user cancels or the dialog plugin isn't available
 * (browser / plain Vite).
 */
export async function pickXcodeProject(): Promise<string | null> {
  try {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({
      multiple: false,
      directory: true,
      title: "Open Xcode project",
    });
    if (selected == null) return null;
    return typeof selected === "string" ? selected : selected[0] ?? null;
  } catch {
    return null;
  }
}

/** Native directory picker for screenshot ingest (Tauri only). */
export async function pickScreenshotFolder(): Promise<string | null> {
  try {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({
      multiple: false,
      directory: true,
      title: "Import screenshots folder",
    });
    if (selected == null) return null;
    return typeof selected === "string" ? selected : selected[0] ?? null;
  } catch {
    return null;
  }
}

export function isTauriShell(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
