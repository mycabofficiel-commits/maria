import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

// La version est lue depuis package.json AU BUILD (vite). Ce fichier est aussi
// bundlé dans le serveur via server/_core/vite.ts ; au runtime serveur le chemin
// dist/package.json n'existe pas → on protège la lecture pour ne pas crasher le
// démarrage (la valeur n'y est de toute façon pas utilisée).
let appVersion = "dev";
try {
  appVersion = JSON.parse(
    readFileSync(path.resolve(import.meta.dirname, "package.json"), "utf8"),
  ).version;
} catch {
  // ignore — fallback "dev" (cas runtime serveur)
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
    },
  },
  envDir: path.resolve(import.meta.dirname),
  root: path.resolve(import.meta.dirname, "client"),
  publicDir: path.resolve(import.meta.dirname, "client", "public"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    host: true,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
});