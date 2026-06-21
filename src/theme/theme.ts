import { createTheme, alpha } from "@mui/material/styles";

// Nebula palette — Blade Runner / Cyberpunk: deep space base, neon cyan +
// violet + magenta accents, glass surfaces.
const cyan = "#6ee7ff";
const violet = "#a78bfa";
const magenta = "#f472b6";

export const theme = createTheme({
  palette: {
    mode: "dark",
    primary: { main: cyan },
    secondary: { main: violet },
    error: { main: "#ff5d7a" },
    warning: { main: "#ffcc66" },
    success: { main: "#5dffa0" },
    info: { main: violet },
    background: { default: "#05060f", paper: alpha("#0c1230", 0.6) },
    text: { primary: "#e6ebff", secondary: alpha("#e6ebff", 0.62) },
    divider: alpha(cyan, 0.14),
  },
  shape: { borderRadius: 16 },
  typography: {
    fontFamily: '"Rajdhani", system-ui, sans-serif',
    h1: { fontFamily: '"Orbitron", sans-serif', fontWeight: 900, letterSpacing: "0.02em" },
    h2: { fontFamily: '"Orbitron", sans-serif', fontWeight: 800 },
    h3: { fontFamily: '"Orbitron", sans-serif', fontWeight: 700 },
    h4: { fontFamily: '"Orbitron", sans-serif', fontWeight: 700 },
    h5: { fontFamily: '"Orbitron", sans-serif', fontWeight: 700 },
    h6: { fontFamily: '"Orbitron", sans-serif', fontWeight: 700, letterSpacing: "0.04em" },
    button: { fontWeight: 700, letterSpacing: "0.04em", textTransform: "none" },
  },
  components: {
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: "none",
          backgroundColor: alpha("#0c1230", 0.55),
          backdropFilter: "blur(18px) saturate(1.4)",
          WebkitBackdropFilter: "blur(18px) saturate(1.4)",
          border: `1px solid ${alpha(cyan, 0.12)}`,
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: { borderRadius: 12 },
        containedPrimary: {
          color: "#04121a",
          backgroundImage: `linear-gradient(135deg, ${cyan}, ${violet})`,
          boxShadow: `0 6px 20px ${alpha(cyan, 0.35)}`,
          "&:hover": { backgroundImage: `linear-gradient(135deg, ${cyan}, ${magenta})` },
        },
      },
    },
    MuiChip: {
      styleOverrides: { root: { borderRadius: 8, fontWeight: 600 } },
    },
    MuiTooltip: {
      styleOverrides: { tooltip: { background: alpha("#0c1230", 0.95), border: `1px solid ${alpha(cyan, 0.2)}` } },
    },
    MuiCssBaseline: {
      styleOverrides: {
        "*::-webkit-scrollbar": { width: 10, height: 10 },
        "*::-webkit-scrollbar-thumb": { background: alpha(cyan, 0.25), borderRadius: 8 },
        "*::-webkit-scrollbar-track": { background: "transparent" },
      },
    },
  },
});

export const NEON = { cyan, violet, magenta };
