import { useMemo } from "react";
import { Box, Typography } from "@mui/material";
import { marked } from "marked";
import GlassCard from "@/components/common/GlassCard";
// The README is the source of truth for "what is ZuccBook" — bundle it at build
// time and render it here so the About page is always in sync with the repo.
import readme from "../../../README.md?raw";

export default function AboutView() {
  const html = useMemo(() => marked.parse(readme, { async: false, gfm: true, breaks: false }) as string, []);
  return (
    <Box sx={{ maxWidth: 820, mx: "auto" }}>
      <Typography variant="h5" sx={{ mb: 0.5 }}>About ZuccBook</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>Straight from the project's README — what this is, why it's built this way, and how it all works with no server.</Typography>
      <GlassCard
        // First-party, build-time content — safe to render as HTML.
        dangerouslySetInnerHTML={{ __html: html }}
        sx={{
          p: { xs: 2, md: 3 },
          "& h1": { fontSize: 26, fontWeight: 800, mt: 0, mb: 1.5, lineHeight: 1.2 },
          "& h2": { fontSize: 20, fontWeight: 800, mt: 3, mb: 1, color: "#1668e0" },
          "& h3": { fontSize: 16, fontWeight: 700, mt: 2, mb: 0.5 },
          "& p": { fontSize: 15, lineHeight: 1.6, my: 1, color: "text.primary" },
          "& a": { color: "#0a55cf", fontWeight: 600 },
          "& ul, & ol": { pl: 3, my: 1 },
          "& li": { fontSize: 15, lineHeight: 1.6, mb: 0.5 },
          "& blockquote": { borderLeft: "3px solid rgba(58,155,240,0.4)", ml: 0, pl: 2, color: "text.secondary", fontStyle: "italic", my: 1.5 },
          "& code": { fontFamily: "monospace", fontSize: 13, bgcolor: "rgba(0,0,0,0.05)", px: 0.5, py: 0.1, borderRadius: 0.5 },
          "& pre": { bgcolor: "rgba(0,0,0,0.05)", p: 1.5, borderRadius: 1.5, overflowX: "auto", "& code": { bgcolor: "transparent", p: 0 } },
          "& table": { borderCollapse: "collapse", width: "100%", my: 1.5, fontSize: 14 },
          "& th, & td": { border: "1px solid var(--bl-line)", px: 1, py: 0.5, textAlign: "left" },
          "& th": { bgcolor: "rgba(58,155,240,0.08)", fontWeight: 700 },
          "& hr": { border: 0, borderTop: "1px solid var(--bl-line)", my: 2.5 },
          "& img": { maxWidth: "100%" },
        }}
      />
    </Box>
  );
}
