import React from "react";
import { createRoot } from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import App from "./App.tsx";
import "./index.css";
import "./i18n";
import { applyTheme, readStoredTheme } from "./hooks/useTheme";

// Apply the saved theme BEFORE React mounts so the first paint matches the
// user's preference (no flash of light/dark on reload).
applyTheme(readStoredTheme());

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <HelmetProvider>
      <App />
    </HelmetProvider>
  </React.StrictMode>
);
