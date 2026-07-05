import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev: proxy ke localhost (backend jalan lokal).
// Production: Nginx di server DO yang handle routing — config ini tidak dipakai.
const DO_SERVER = "http://localhost";
const DO_WS = "ws://localhost";

export default defineConfig({
  plugins: [react()],

  server: {
    port: 5173,
    host: true,
    proxy: {
      // REST API: /api/** → http://localhost:3001
      "/api": {
        target: `${DO_SERVER}:3001`,
        changeOrigin: true,
      },
      // WebSocket gateway: /ws → ws://167.71.195.81:8090/ws
      "/ws": {
        target: `${DO_WS}:8090`,
        ws: true,
        changeOrigin: true,
      },
    },
  },

  build: {
    outDir: "dist",
    sourcemap: false,
  },
});
