import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { applyTheme, readStoredTheme } from "./theme/theme";
import "./styles/tokens.css";
import "./styles/base.css";

// Apply the stored theme before the first paint so a dark choice does not flash light.
applyTheme(readStoredTheme());

const root = document.getElementById("root");
if (root === null) throw new Error("Missing #root element");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
