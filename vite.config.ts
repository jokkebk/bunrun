import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

const BUN_PORT = process.env.BUN_PORT ?? "3939";

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      "/api": `http://127.0.0.1:${BUN_PORT}`,
      "/events": {
        target: `http://127.0.0.1:${BUN_PORT}`,
        changeOrigin: false,
        ws: false,
      },
    },
  },
  build: { target: "esnext", outDir: "dist" },
  plugins: [svelte()],
});
