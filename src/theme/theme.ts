import { createTheme, alpha } from "@mui/material/styles";

// ============================================================
//  Modern Ledgr Theme — reskinned from retro XP Luna to a
//  sleek, clean, flat, modern UI matching professional platforms.
//  Uses the CSS variable tokens from bliss.css to naturally support
//  light/dark schemes dynamically.
// ============================================================

export const BL = {
  blue400: "var(--bl-blue-400)",
  blue500: "var(--bl-blue-500)",
  blue600: "var(--bl-blue-600)",
  blue700: "var(--bl-blue-700)",
  blue800: "var(--bl-blue-800)",
  green500: "var(--bl-green-500)",
  white: "var(--bl-white)",
  panel: "var(--bl-face)",
  raised: "var(--bl-face-raised)",
  face: "var(--bl-face)",
  faceDark: "var(--bl-grey-300)",
  edge: "var(--bl-edge-frame)",
  line: "var(--bl-line)",
  sunk: "var(--bl-edge-sunk)",
  ink: "var(--bl-ink)",
  inkDim: "var(--bl-ink-dim)",
  inkFaint: "var(--bl-ink-faint)",
  ok: "var(--bl-ok)",
  info: "var(--bl-info)",
  warn: "var(--bl-warn)",
  danger: "var(--bl-danger)",
  tip: "var(--bl-tip-bg)",
};

const UI = '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const TITLE = '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

const isDark = typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;

export const theme = createTheme({
  breakpoints: {
    values: {
      xs: 0,
      sm: 640,   // mobile portrait / tablet boundary
      md: 1024,  // tablet / desktop boundary
      lg: 1280,
      xl: 1920,
    },
  },
  palette: {
    // MUI palette colours MUST be concrete values — MUI runs alpha()/contrast math
    // and augmentColor() over them, and a CSS var like var(--bl-accent) is not a
    // parseable color, so it throws "unsupported color" (minified error #9) at theme
    // creation and the WHOLE app fails to render. These mirror the --bl-* design
    // tokens (light + dark from bliss.css). The rest of the UI still themes via the
    // var(--bl-*) values in sx/styleOverrides, which flip with prefers-color-scheme.
    mode: isDark ? "dark" : "light",
    primary: { main: "#1d9bf0", light: "#3b9df7", dark: "#1570ab", contrastText: "#fff" },
    secondary: { main: "#22c55e", contrastText: "#fff" },
    error: { main: "#f4212e" },
    warning: { main: isDark ? "#ffd400" : "#f59e0b" },
    success: { main: "#00ba7c" },
    info: { main: "#1d9bf0" },
    background: isDark ? { default: "#0f1419", paper: "#15202b" } : { default: "#f0f2f5", paper: "#ffffff" },
    text: isDark ? { primary: "#f7f9fa", secondary: "#8899a6" } : { primary: "#0f1419", secondary: "#536471" },
    divider: isDark ? "#2f3336" : "#eff3f4",
  },
  shape: { borderRadius: 8 },
  typography: {
    fontFamily: UI,
    fontSize: 14,
    h1: { fontFamily: TITLE, fontWeight: 800, fontSize: "clamp(1.5rem, 5vw, 2.5rem)" },
    h2: { fontFamily: TITLE, fontWeight: 800, fontSize: "clamp(1.2rem, 4vw, 2rem)" },
    h3: { fontFamily: TITLE, fontWeight: 700, fontSize: "clamp(1rem, 3vw, 1.5rem)" },
    h4: { fontFamily: TITLE, fontWeight: 700 },
    h5: { fontFamily: TITLE, fontWeight: 700 },
    h6: { fontFamily: TITLE, fontWeight: 700, fontSize: "clamp(0.875rem, 2.5vw, 1.1rem)" },
    body1: { fontSize: "clamp(0.85rem, 1vw, 1.05rem)" },
    body2: { fontSize: "clamp(0.8rem, 0.9vw, 0.95rem)" },
    button: { textTransform: "none", fontWeight: 700 },
    overline: { letterSpacing: "0.08em", fontWeight: 700, color: "var(--bl-ink-dim)" },
  },
  components: {
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: "none",
          backgroundColor: "var(--bl-face)",
          border: "1px solid var(--bl-line)",
          boxShadow: "var(--bl-shadow-1)",
          backdropFilter: "none",
          borderRadius: 12,
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          border: "1px solid var(--bl-edge-frame)",
          backgroundColor: "var(--bl-btn-bg)",
          backgroundImage: "none",
          color: "var(--bl-ink)",
          boxShadow: "none",
          transition: "all var(--bl-dur-fast) var(--bl-ease)",
          "&:hover": { backgroundColor: "var(--bl-accent-soft)", borderColor: "var(--bl-accent)" },
        },
        containedPrimary: {
          color: "#fff",
          border: "1px solid var(--bl-accent)",
          backgroundColor: "var(--bl-accent)",
          backgroundImage: "none",
          boxShadow: "none",
          textShadow: "none",
          "&:hover": { backgroundColor: "var(--bl-accent-deep)", borderColor: "var(--bl-accent-deep)", boxShadow: "none" },
        },
        outlined: { backgroundImage: "none", backgroundColor: "transparent", border: "1px solid var(--bl-edge-frame)", "&:hover": { backgroundColor: "var(--bl-accent-soft)" } },
        text: { backgroundImage: "none", backgroundColor: "transparent", border: "1px solid transparent", boxShadow: "none", "&:hover": { backgroundColor: "var(--bl-accent-soft)", borderColor: "transparent" } },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { borderRadius: 999, fontWeight: 600, backgroundColor: "var(--bl-face-raised)", border: "1px solid var(--bl-line)" },
        outlined: { backgroundColor: "var(--bl-white)" },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: 8, backgroundColor: "var(--bl-white)",
          "& fieldset": { borderColor: "var(--bl-edge-frame)" },
          "&:hover fieldset": { borderColor: "var(--bl-accent)" },
          "&.Mui-focused fieldset": { borderColor: "var(--bl-accent)", borderWidth: 1 },
        },
        input: { boxShadow: "none" },
      },
    },
    MuiToggleButton: {
      styleOverrides: { root: { borderRadius: 8, textTransform: "none", color: "var(--bl-ink-dim)" } },
    },
    MuiTooltip: {
      styleOverrides: { tooltip: { backgroundColor: "var(--bl-tip-bg)", color: "#fff", border: "none", fontSize: 12, boxShadow: "var(--bl-shadow-2)" }, arrow: { color: "var(--bl-tip-bg)" } },
    },
    MuiAvatar: { styleOverrides: { root: { border: "1px solid var(--bl-line)" } } },
    MuiDivider: { styleOverrides: { root: { borderColor: "var(--bl-line)" } } },
  },
});

export const TITLE_GLOSS = "none";
export const NEON = { cyan: "var(--bl-blue-400)", violet: "var(--bl-blue-500)", magenta: "var(--bl-blue-600)" };
