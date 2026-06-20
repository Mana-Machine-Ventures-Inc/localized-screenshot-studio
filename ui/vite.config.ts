import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const ENGINE = process.env.LSS_ENGINE_URL ?? "http://127.0.0.1:8787";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
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
