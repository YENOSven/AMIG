import { defineConfig } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: "./",
  root: path.join(projectRoot, "electron", "renderer"),
  envDir: projectRoot,
  build: {
    outDir: path.join(projectRoot, "dist", "renderer"),
    emptyOutDir: true,
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
});
