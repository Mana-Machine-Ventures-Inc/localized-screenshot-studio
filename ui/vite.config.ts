import type { Plugin } from "vite";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const ENGINE = process.env.LSS_ENGINE_URL ?? "http://127.0.0.1:8787";

/**
 * Vite's HMR client does `location.reload()` after any WebSocket disconnect once
 * the server pings again. Generate (and other long UI work) can stall the
 * webview enough for that WS to drop — even while the app stays foregrounded —
 * which wipes React state and dumps the user back on Overview.
 *
 * Suppress that reload; the next real code edit still hot-updates in place.
 */
function preserveStateOnHmrDisconnect(): Plugin {
  return {
    name: "lss-preserve-state-on-hmr-disconnect",
    enforce: "pre",
    transform(code, id) {
      if (!id.includes("vite/dist/client/client.mjs")) return;
      const needle =
        "await waitForSuccessfulPing(url.href);\n          location.reload();";
      if (!code.includes(needle)) return;
      return code.replace(
        needle,
        `await waitForSuccessfulPing(url.href);
          console.info(
            "[vite] server connection restored (reload suppressed to preserve studio state)",
          );`,
      );
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), preserveStateOnHmrDisconnect()],
  clearScreen: false,
  server: {
    // Bind IPv4 loopback explicitly. Vite's default ("localhost") resolves to
    // IPv6 ::1 on recent Node, but the Tauri macOS webview reaches the dev URL
    // over IPv4 127.0.0.1 — the mismatch makes the app load a stale bundle with
    // no proxy, so /api calls hang ("Connecting to engine…").
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": { target: ENGINE, changeOrigin: true },
      "/render": { target: ENGINE, changeOrigin: true },
      "/overlay": { target: ENGINE, changeOrigin: true },
    },
  },
  build: {
    outDir: "dist",
    target: "es2022",
  },
});
