import { useEffect, useState } from "react";
import { Box, IconButton } from "@mui/material";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import { bus } from "@/lib/events";

/** Full-screen image viewer. Any <SafeImage> emits "lightbox:open" on click and
 *  this overlay shows the image centered; close by clicking the backdrop, the X,
 *  or pressing Esc. Clicking the image itself doesn't close (so you can look). */
export default function ImageLightbox() {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => bus.on("lightbox:open", ({ src }) => setSrc(src)), []);
  useEffect(() => {
    if (!src) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSrc(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [src]);

  if (!src) return null;
  return (
    <Box onClick={() => setSrc(null)}
      sx={{ position: "fixed", inset: 0, zIndex: 2000, bgcolor: "rgba(0,0,0,0.92)", display: "grid", placeItems: "center", p: 2, cursor: "zoom-out", animation: "lbfade .15s ease", "@keyframes lbfade": { from: { opacity: 0 }, to: { opacity: 1 } } }}>
      <IconButton onClick={(e) => { e.stopPropagation(); setSrc(null); }} aria-label="Close"
        sx={{ position: "fixed", top: 12, right: 12, color: "#fff", bgcolor: "rgba(255,255,255,0.14)", "&:hover": { bgcolor: "rgba(255,255,255,0.28)" } }}>
        <CloseRoundedIcon />
      </IconButton>
      <Box component="img" src={src} alt="" onClick={(e) => e.stopPropagation()}
        sx={{ maxWidth: "96vw", maxHeight: "92vh", objectFit: "contain", borderRadius: 1, boxShadow: "0 10px 40px rgba(0,0,0,0.6)", cursor: "default" }} />
    </Box>
  );
}
