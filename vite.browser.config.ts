import { defineConfig } from "vite";

export default defineConfig({
  build: {
    emptyOutDir: true,
    lib: {
      entry: "src/index.ts",
      fileName: "isecure-ts-client",
      formats: ["es"],
    },
    outDir: ".browser-check",
  },
});
