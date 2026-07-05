import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

const BUN_PORT = Number(process.env.BUN_PORT ?? "3939");
const VITE_PORT = process.env.VITE_PORT
  ? Number(process.env.VITE_PORT)
  : BUN_PORT + 1;

export default defineConfig({
  server: {
    port: VITE_PORT,
    open: process.env.BUNRUN_NO_OPEN === "1" ? false : "/",
    proxy: {
      "/api": `http://127.0.0.1:${BUN_PORT}`,
      "/fav": `http://127.0.0.1:${BUN_PORT}`,
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
