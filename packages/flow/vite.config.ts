import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: "src/index.ts",
      formats: ["es"],
      fileName: "index",
    },
    rollupOptions: {
      external: [
        "@xyflow/system",
        "effect",
        "foldkit",
        /^effect\//,
        /^foldkit\//,
      ],
    },
    sourcemap: true,
  },
});
