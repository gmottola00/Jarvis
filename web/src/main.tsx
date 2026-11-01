import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { syncPush } from "./lib/push";
import { registerServiceWorker } from "./lib/pwa";

registerServiceWorker();
void syncPush();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
