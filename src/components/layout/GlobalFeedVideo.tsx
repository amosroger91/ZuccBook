import { useEffect, useRef, useState } from "react";
import { Box, IconButton, Typography, Stack, Tooltip } from "@mui/material";
import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";
import PauseRoundedIcon from "@mui/icons-material/PauseRounded";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import { bus } from "@/lib/events";

// Shared YouTube IFrame API loader (one script for the whole app).
let ytReady: Promise<any> | null = null;
function loadYT(): Promise<any> {
  if (ytReady) return ytReady;
  ytReady = new Promise((res) => {
    const w = window as any;
    if (w.YT?.Player) return res(w.YT);
    const prev = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => { prev?.(); res(w.YT); };
    const s = document.createElement("script"); s.src = "https://www.youtube.com/iframe_api"; document.head.appendChild(s);
  });
  return ytReady;
}

/** A single YouTube player for FEED videos. It lives at the app root and never
 *  unmounts while a video is active. While the originating post card is on
 *  screen, the player is positioned exactly over the card's slot; when you
 *  scroll it out of view (or navigate away), it floats as a bottom-right mini
 *  player and keeps playing. The iframe is only moved, never reparented. */
export default function GlobalFeedVideo() {
  const host = useRef<HTMLDivElement>(null);
  const mount = useRef<HTMLDivElement>(null);
  const player = useRef<any>(null);
  const vid = useRef<string | null>(null);
  const dockId = useRef<string | null>(null);
  const [active, setActive] = useState(false);
  const [floating, setFloating] = useState(false);
  const [playing, setPlaying] = useState(true);

  async function ensurePlayer(videoId: string) {
    const YT = await loadYT();
    if (!mount.current) return;
    if (!player.current) {
      player.current = new YT.Player(mount.current, {
        width: "100%", height: "100%", videoId,
        playerVars: { autoplay: 1, rel: 0, modestbranding: 1, playsinline: 1 },
        events: {
          onReady: (e: any) => { try { e.target.playVideo(); } catch {} },
          onStateChange: (e: any) => {
            const YT2 = (window as any).YT;
            if (e.data === YT2.PlayerState.PLAYING) { setPlaying(true); bus.emit("media:play", { id: "feedvideo" }); }
            else if (e.data === YT2.PlayerState.PAUSED) setPlaying(false);
          },
        },
      });
      vid.current = videoId;
    } else if (vid.current !== videoId) {
      player.current.loadVideoById({ videoId }); vid.current = videoId;
    }
  }

  useEffect(() => {
    const off = bus.on("feedvideo:play", ({ videoId, dockId: d }) => {
      dockId.current = d; setActive(true); setPlaying(true);
      bus.emit("media:play", { id: "feedvideo" });   // pause radio / watch party
      ensurePlayer(videoId);
    });
    // Another media source took over (radio, mp3, Spotify, watch party) → stop
    // and dismiss our feed video entirely, so it doesn't linger as a stray mini
    // player or play audio underneath the new source.
    const offMedia = bus.on("media:play", ({ id }) => {
      if (id !== "feedvideo") { try { player.current?.stopVideo?.(); } catch {} dockId.current = null; vid.current = null; setActive(false); }
    });
    return () => { off(); offMedia(); };
  }, []);

  // Position every frame: dock over the source card when visible, else float.
  useEffect(() => {
    if (!active) return;
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
          Object.assign(h.style, { left: "auto", top: "auto", right: "12px", bottom: "84px", width: "300px", height: "169px" });
          if (!floating) setFloating(true);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [active, floating]);

  function toggle() {
    try { const p = player.current; if (!p) return; const YT = (window as any).YT; (p.getPlayerState?.() === YT.PlayerState.PLAYING ? p.pauseVideo : p.playVideo).call(p); } catch {}
  }
  function close() { try { player.current?.stopVideo?.(); } catch {} dockId.current = null; vid.current = null; setActive(false); }

  if (!active) return null;

  return (
    <Box ref={host} sx={{ position: "fixed", zIndex: floating ? 1250 : 1, overflow: "hidden", bgcolor: "#000", borderRadius: 1, border: floating ? "1px solid rgba(0,0,0,0.4)" : "1px solid var(--bl-line)", boxShadow: floating ? "0 10px 30px rgba(0,0,0,0.45)" : "none" }}>
      <Box ref={mount} sx={{ width: "100%", height: "100%" }} />
      {floating && (
        <Stack direction="row" alignItems="center" spacing={0.5} sx={{ position: "absolute", top: 0, left: 0, right: 0, px: 0.5, py: 0.25, background: "linear-gradient(180deg, rgba(0,0,0,0.7), transparent)" }}>
          <Typography variant="caption" sx={{ color: "#fff", flex: 1, ml: 0.5 }}>Playing</Typography>
          <Tooltip title={playing ? "Pause" : "Play"}><IconButton size="small" sx={{ color: "#fff" }} onClick={toggle}>{playing ? <PauseRoundedIcon fontSize="small" /> : <PlayArrowRoundedIcon fontSize="small" />}</IconButton></Tooltip>
          <Tooltip title="Close"><IconButton size="small" sx={{ color: "#fff" }} onClick={close}><CloseRoundedIcon fontSize="small" /></IconButton></Tooltip>
        </Stack>
      )}
    </Box>
  );
}
