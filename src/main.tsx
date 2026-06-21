import React from "react";
import ReactDOM from "react-dom/client";
import { ThemeProvider, CssBaseline } from "@mui/material";
import { HashRouter } from "react-router-dom";
import { theme } from "@/theme/theme";
import App from "@/App";

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
