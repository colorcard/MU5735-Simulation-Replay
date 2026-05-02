import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  base: "./",
  root: resolve(import.meta.dirname),
  plugins: [react()],
  build: {
    outDir: resolve(import.meta.dirname, "..", "dist"),
    emptyOutDir: true
  },
  server: {
    host: "0.0.0.0",
    port: 5173
  },
  preview: {
    host: "0.0.0.0",
    port: 4173
  }
});
