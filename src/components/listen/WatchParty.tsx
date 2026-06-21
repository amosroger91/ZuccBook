import { useEffect, useRef, useState } from "react";
import { Box, Stack, TextField, Button, Chip, Typography } from "@mui/material";
import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";
import GlassCard from "@/components/common/GlassCard";
import { peerService } from "@/services/peerService";
import { presenceService } from "@/services/presenceService";
import { profileService } from "@/services/profileService";
import { bus } from "@/lib/events";
import { useStore } from "@/store/useStore";
import { fingerprint } from "@/lib/crypto";
import { toast } from "@/lib/events";
import type { WatchPartyState } from "@/types";

function youtubeId(input: string): string | null {
  const s = input.trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  const m = s.match(/[?&]v=([\w-]{11})/) || s.match(/youtu\.be\/([\w-]{11})/) || s.match(/youtube\.com\/(?:embed|shorts|live)\/([\w-]{11})/);
  return m ? m[1] : null;
}
const posOf = (s: WatchPartyState) => (s.playing ? s.baseTime + (Date.now() - s.refEpoch) / 1000 : s.baseTime);

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

/** Synchronized YouTube watch party. Everyone shares one video + position over
 *  the relay; whoever sets/plays/pauses/seeks drives it, and people who arrive
 *  mid-video are caught up to the current spot (no more overriding it). */
export default function WatchParty() {
  const me = useStore((s) => s.me);
  const hostRef = useRef<HTMLDivElement>(null);
  const player = useRef<any>(null);
  const vid = useRef<string | null>(null);
  const applying = useRef(false);
  const lastStage = useRef<WatchPartyState | null>(null);
  const [input, setInput] = useState("");
  const [stage, setStage] = useState<WatchPartyState | null>(null);

  const nameFor = (pk: string) => profileService.get(pk)?.username || fingerprint(pk);
  const flash = (text: string) => bus.emit("notify", { text });

  function broadcast(playing: boolean, baseTime: number, videoId = vid.current, title?: string) {
    if (!videoId) return;
    const s: WatchPartyState = { videoId, playing, baseTime, refEpoch: Date.now(), by: me?.publicKey ?? "", title };
    setStage(s);
    bus.emit("stage:out", s);
  }

  function onStateChange(e: any) {
    if (applying.current) return;
    const YT = (window as any).YT;
    const t = (() => { try { return e.target.getCurrentTime(); } catch { return 0; } })();
    if (e.data === YT.PlayerState.PLAYING) broadcast(true, t);
    else if (e.data === YT.PlayerState.PAUSED || e.data === YT.PlayerState.ENDED) broadcast(false, t);
  }

  async function ensurePlayer(videoId: string, start: number, playing: boolean) {
    const YT = await loadYT();
    if (!player.current) {
      player.current = new YT.Player(hostRef.current, {
        width: "100%", height: "100%", videoId,
        playerVars: { autoplay: playing ? 1 : 0, rel: 0, modestbranding: 1, playsinline: 1 },
        events: {
          onReady: (e: any) => { try { e.target.seekTo(start, true); playing ? e.target.playVideo() : e.target.pauseVideo(); } catch {} },
          onStateChange,
        },
      });
      vid.current = videoId;
    } else if (vid.current !== videoId) {
      player.current.loadVideoById({ videoId, startSeconds: start });
      vid.current = videoId;
      if (!playing) setTimeout(() => { try { player.current.pauseVideo(); } catch {} }, 400);
    } else {
      try { player.current.seekTo(start, true); playing ? player.current.playVideo() : player.current.pauseVideo(); } catch {}
    }
  }

  function applyRemote(s: WatchPartyState, silent = false) {
    const prev = lastStage.current;
    lastStage.current = s;
    setStage(s);
    // Announce who did what (skip our own actions + the silent catch-up on open).
    if (!silent && s.by && s.by !== me?.publicKey) {
      const who = nameFor(s.by);
      if (!prev?.videoId && s.videoId) flash(`${who} started a watch party`);
      else if (prev && prev.videoId !== s.videoId) flash(`${who} changed the video`);
      else if (prev && prev.playing && !s.playing) flash(`${who} paused the video`);
      else if (prev && !prev.playing && s.playing) flash(`${who} resumed the video`);
    }
    if (!s.videoId) return;
    applying.current = true;
    ensurePlayer(s.videoId, Math.max(0, posOf(s)), s.playing);
    presenceService.setActivity("Watching", s.title || "a watch party");
    setTimeout(() => { applying.current = false; }, 1600);
  }

  useEffect(() => {
    const off = bus.on("stage:in", (s) => applyRemote(s));
    const cur = peerService.currentStage();
    lastStage.current = cur;
    if (cur && cur.videoId) applyRemote(cur, true);   // arrived mid-party → silent catch up
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function start() {
    const id = youtubeId(input);
    if (!id) { toast("Paste a valid YouTube link", "warn"); return; }
    setInput("");
    applying.current = true;
    ensurePlayer(id, 0, true);
    presenceService.setActivity("Watching", "a watch party");
    broadcast(true, 0, id);
    setTimeout(() => { applying.current = false; }, 1200);
  }

  const hosting = !!stage?.videoId;
  return (
    <>
      <GlassCard sx={{ mb: 2 }}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ sm: "center" }}>
          <TextField fullWidth size="small" value={input} placeholder="Paste a YouTube link to start (or change) the party…" onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && start()} />
          <Button variant="contained" startIcon={<PlayArrowRoundedIcon />} onClick={start}>Watch together</Button>
        </Stack>
        {hosting && (
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }}>
            <Chip size="small" label={stage?.playing ? "▶ playing" : "❚❚ paused"} sx={{ bgcolor: "rgba(84,201,90,0.16)", color: "#54c95a" }} />
            <Typography variant="caption" color="text.secondary">
              synced party · started by {stage?.by === me?.publicKey ? "you" : fingerprint(stage?.by ?? "")} · everyone watches the same spot
            </Typography>
          </Stack>
        )}
      </GlassCard>

      <GlassCard sx={{ p: hosting ? 0 : 2, overflow: "hidden" }}>
        <Box sx={{ position: "relative", pt: hosting ? "56.25%" : 0 }}>
          <Box ref={hostRef} sx={{ position: hosting ? "absolute" : "static", inset: 0, width: "100%", height: "100%" }} />
          {!hosting && <Typography color="text.secondary">No watch party yet. Paste a YouTube link above and everyone in the room will watch in sync — people who join mid-video jump straight to the current moment.</Typography>}
        </Box>
      </GlassCard>
    </>
  );
}
