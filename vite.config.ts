/// <reference types="vitest" />
import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig({
  base: "./",
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  server: { port: 5174, open: true },
  build: { outDir: "dist", sourcemap: true, target: "es2022" },
  test: {
    environment: "happy-dom",
    globals: false,
    include: ["src/**/*.{test,spec}.ts"],
  },
});
