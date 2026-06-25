import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const ENGINE = process.env.LSS_ENGINE_URL ?? "http://127.0.0.1:8787";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
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
