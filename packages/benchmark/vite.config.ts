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
        shadow: "shadow.html",
      },
    },
  },
});
