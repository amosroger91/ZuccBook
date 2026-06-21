import { useEffect, useRef, useState } from "react";
import { Box, IconButton, Typography, Stack, Tooltip } from "@mui/material";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import { bus } from "@/lib/events";

/** A single Spotify embed for the feed. Docks over the source card while it's on
 *  screen; when you scroll away it floats as a bottom-right mini player so you
 *  can still pause it (using the embed's own controls). One iframe, only moved —
 *  never reparented — so playback isn't interrupted. */
export default function GlobalSpotify() {
  const host = useRef<HTMLDivElement>(null);
  const dockId = useRef<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [floating, setFloating] = useState(false);

  useEffect(() => {
    const off = bus.on("spotify:play", ({ embedUrl, dockId: d }) => {
      dockId.current = d; setUrl(embedUrl);
      bus.emit("media:play", { id: "music" }); // stop YT feed video / radio / mp3
    });
    return off;
  }, []);

  useEffect(() => {
    if (!url) return;
    let raf = 0;
    const tick = () => {
      const h = host.current;
      if (h) {
        const dock = dockId.current ? document.getElementById(dockId.current) : null;
        const r = dock?.getBoundingClientRect();
        const visible = !!r && r.width > 0 && r.bottom > 64 && r.top < window.innerHeight - 8;
        if (r && visible) {
          Object.assign(h.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, right: "auto", bottom: "auto" });
          if (floating) setFloating(false);
        } else {
          Object.assign(h.style, { left: "auto", top: "auto", right: "12px", bottom: "84px", width: "320px", height: "152px" });
          if (!floating) setFloating(true);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [url, floating]);

  function close() { dockId.current = null; setUrl(null); }

  if (!url) return null;
  return (
    <Box ref={host} sx={{ position: "fixed", zIndex: floating ? 1250 : 1, overflow: "hidden", borderRadius: 1.5, bgcolor: "#121212", border: floating ? "1px solid rgba(0,0,0,0.4)" : "1px solid var(--bl-line)", boxShadow: floating ? "0 10px 30px rgba(0,0,0,0.45)" : "none" }}>
      <Box component="iframe" title="Spotify" src={url} allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" sx={{ width: "100%", height: "100%", border: 0, display: "block" }} />
      {floating && (
        <Stack direction="row" alignItems="center" sx={{ position: "absolute", top: 0, right: 0, p: 0.25 }}>
          <Tooltip title="Close"><IconButton size="small" sx={{ color: "#fff", bgcolor: "rgba(0,0,0,0.4)", "&:hover": { bgcolor: "rgba(0,0,0,0.6)" } }} onClick={close}><CloseRoundedIcon fontSize="small" /></IconButton></Tooltip>
        </Stack>
      )}
      {floating && <Typography variant="caption" sx={{ position: "absolute", bottom: 2, left: 8, color: "rgba(255,255,255,0.5)", pointerEvents: "none" }}>♫ playing</Typography>}
    </Box>
  );
}
