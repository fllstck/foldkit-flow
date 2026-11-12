import react from "@vitejs/plugin-react";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), svelte()],
  build: {
    rollupOptions: {
      input: {
        react: "react.html",
        svelte: "svelte.html",
        foldkit: "foldkit.html",
        large: "large.html",
        "large-chrome": "large-chrome.html",
        shadow: "shadow.html",
        subflow: "subflow.html",
        m6: "m6.html",
        "large-hidden": "large-hidden.html",
        "large-expanded": "large-expanded.html",
        churn: "churn.html",
        gallery: "gallery.html",
        "gallery-foldkit": "gallery-foldkit.html",
        "gallery-react": "gallery-react.html",
      },
    },
  },
});
