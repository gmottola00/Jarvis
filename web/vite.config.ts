import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // In development the SPA talks to uvicorn directly. In the container, nginx
    // does this instead - same paths, so the app code never knows the difference.
    proxy: {
      "/api": { target: "http://localhost:8100", changeOrigin: true },
      "/health": { target: "http://localhost:8100", changeOrigin: true },
    },
  },
});
