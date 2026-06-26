import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

// base: "./" keeps asset URLs relative so the static build works from any path
// (GitHub Pages project sites, IPFS, a USB stick — anywhere). Routing uses
// HashRouter so deep links survive a refresh with no server config.
export default defineConfig({
  plugins: [react()],
  base: "./",
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  // ES-module workers: the feed worker now code-splits (it dynamically imports
  // the WASM embeddings core), which Vite can't emit as a single IIFE. Our
  // workers are already created with { type: "module" }, so ESM output matches.
  worker: { format: "es" },
  // NOTE: a manualChunks vendor split (react vs mui) was tried and reverted — it
  // caused a cross-chunk circular-init crash ("Cannot access '$a' before
  // initialization") between the React/emotion/MUI chunks. The initial-load win
  // comes from lazy-loading the service layer + views + players, not from vendor
  // splitting, so we let Rollup keep the framework in the entry chunk where the
  // evaluation order is correct.
  build: { target: "es2021", sourcemap: false },
});
