import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "./server.js";
import { store } from "./store.js";
import { readProject } from "./projectReader/index.js";
import { readGlobalSettings } from "./store.js";
import { captureEngine } from "./capture/capture.js";

// Load a .env (for OPENAI_API_KEY etc.) from the repo root, the engine dir, or
// the current working directory. Uses Node's built-in loader; missing files are
// ignored. Real environment variables always take precedence.
function loadEnvFiles(): void {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, "../../.env"), // repo root
    path.resolve(here, "../.env"), // engine/
    path.resolve(process.cwd(), ".env"),
  ];
  const loadEnvFile = (process as unknown as {
    loadEnvFile?: (p: string) => void;
  }).loadEnvFile;
  for (const file of candidates) {
    try {
      loadEnvFile?.(file);
      console.log(`[engine] loaded env from ${file}`);
    } catch {
      /* file not present — ignore */
    }
  }
}

loadEnvFiles();

const PORT = Number(process.env.LSS_PORT ?? 8787);

const app = createServer();

// Re-open the last project automatically for a frictionless launch.
try {
  const settings = readGlobalSettings();
  if (settings.lastProjectPath) {
    const data = readProject(settings.lastProjectPath);
    store.open(data.projectPath);
    store.setData(data);
    store.reconcileCells(data.locales);
    console.log(`[engine] reopened project: ${data.appName} (${data.projectPath})`);
  }
} catch (err) {
  console.warn(`[engine] could not reopen last project: ${String(err)}`);
}

const server = app.listen(PORT, () => {
  console.log(`[engine] listening on http://127.0.0.1:${PORT}`);
});

async function shutdown() {
  await captureEngine.close().catch(() => {});
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
