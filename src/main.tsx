import React from "react";
import ReactDOM from "react-dom/client";
import { ThemeProvider, CssBaseline } from "@mui/material";
import { HashRouter } from "react-router-dom";
import { theme } from "@/theme/theme";
import "@/bliss.css";   // the Bliss / XP "Luna" design system (tokens + components)
import "@/bliss.js";    // Bliss behavior layer (window.Bliss); harmless for our MUI tree
import App from "@/App";

// Swallow noisy, non-fatal WebGPU/WebLLM rejections (e.g. "device lost",
// "Instance dropped in popErrorScope") so a GPU hiccup while the on-device model
// loads can't spam the console or destabilize the page — we fall back to the
// fast engine automatically.
window.addEventListener("unhandledrejection", (e) => {
  const msg = String((e.reason && (e.reason.message || e.reason)) || "");
  if (/popErrorScope|Instance dropped|external Instance|GPUDevice|device lost|WebGPU/i.test(msg)) e.preventDefault();
});

// Always open on the home feed — ignore a stale route hash left over from a
// previous session so a fresh load lands on the timeline, not /wallet, /settings, etc.
if (location.hash && location.hash !== "#/" && location.hash !== "#") {
  history.replaceState(null, "", `${location.pathname}${location.search}#/`);
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <HashRouter>
        <App />
      </HashRouter>
    </ThemeProvider>
  </React.StrictMode>,
);

// dismiss the boot splash once React has painted
requestAnimationFrame(() => {
  const boot = document.getElementById("boot");
  if (boot) { boot.style.opacity = "0"; setTimeout(() => boot.remove(), 500); }
});
