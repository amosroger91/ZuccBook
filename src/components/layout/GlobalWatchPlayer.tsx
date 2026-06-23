import { useEffect, useRef, useState } from "react";
import { Box, IconButton, Typography, Stack, Tooltip } from "@mui/material";
import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";
import PauseRoundedIcon from "@mui/icons-material/PauseRounded";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import OpenInFullRoundedIcon from "@mui/icons-material/OpenInFullRounded";
import YouTubeIcon from "@mui/icons-material/YouTube";
import { useNavigate } from "react-router-dom";
import { peerService } from "@/services/peerService";
import { presenceService } from "@/services/presenceService";
import { profileService } from "@/services/profileService";
import { watchRoomService } from "@/services/watchRoomService";
import { setUnloadGuard } from "@/lib/unloadGuard";
import { openOnYouTube } from "@/lib/youtube";
import { bus } from "@/lib/events";
import { useStore } from "@/store/useStore";
import { fingerprint } from "@/lib/crypto";
import type { WatchPartyState } from "@/types";

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

/** A single YouTube player that lives at the app root and never unmounts while a
 *  video is active — so navigating away keeps it playing. It docks into the
 *  Listen page's #watch-dock when present, otherwise floats as a bottom-right
 *  mini player. The iframe is only resized/repositioned (never reparented), so
 *  playback is uninterrupted. */
export default function GlobalWatchPlayer() {
  const me = useStore((s) => s.me);
  const nav = useNavigate();
  const host = useRef<HTMLDivElement>(null);
  const mount = useRef<HTMLDivElement>(null);
  const player = useRef<any>(null);
  const vid = useRef<string | null>(null);
  const applying = useRef(false);
  const lastStage = useRef<WatchPartyState | null>(null);
  const closedId = useRef<string | null>(null);
  const [stage, setStage] = useState<WatchPartyState | null>(peerService.currentStage());
  const [docked, setDocked] = useState(true);

  const nameFor = (s: WatchPartyState) => s.byName || profileService.get(s.by)?.username || fingerprint(s.by);
  const flash = (t: string) => bus.emit("notify", { text: t });

  function broadcast(playing: boolean, baseTime: number, videoId = vid.current) {
    if (!videoId) return;
    const s: WatchPartyState = { videoId, playing, baseTime, refEpoch: Date.now(), by: me?.publicKey ?? "", byName: me?.username, room: watchRoomService.current };
    lastStage.current = s; setStage(s); bus.emit("stage:out", s);
  }
  // When the current video ends, the person who started it advances the shared
  // "up next" queue (only the controller, so we don't double-skip).
  function advanceQueue() {
    if (lastStage.current && lastStage.current.by !== me?.publicKey) return;
    const room = watchRoomService.current;
    const q = peerService.queueFor(room);
    if (!q.length) return;
    const [next, ...rest] = q;
    bus.emit("watch:queue-out", { room, items: rest });
    bus.emit("watch:start", { videoId: next.videoId });
  }
  function onStateChange(e: any) {
    const YT = (window as any).YT;
    if (e.data === YT.PlayerState.PLAYING) bus.emit("media:play", { id: "watch" }); // others pause
    if (applying.current) return;
    let t = 0; try { t = e.target.getCurrentTime(); } catch {}
    if (e.data === YT.PlayerState.PLAYING) broadcast(true, t);
    else if (e.data === YT.PlayerState.PAUSED) broadcast(false, t);
    else if (e.data === YT.PlayerState.ENDED) { broadcast(false, t); advanceQueue(); }
  }
  async function ensurePlayer(videoId: string, start: number, playing: boolean) {
    const YT = await loadYT();
    if (!mount.current) return;
    if (!player.current) {
      player.current = new YT.Player(mount.current, {
        width: "100%", height: "100%", videoId,
        playerVars: { autoplay: playing ? 1 : 0, rel: 0, modestbranding: 1, playsinline: 1 },
        events: { onReady: (e: any) => { try { e.target.seekTo(start, true); playing ? e.target.playVideo() : e.target.pauseVideo(); } catch {} }, onStateChange },
      });
      vid.current = videoId;
    } else if (vid.current !== videoId) {
      player.current.loadVideoById({ videoId, startSeconds: start }); vid.current = videoId;
      if (!playing) setTimeout(() => { try { player.current.pauseVideo(); } catch {} }, 400);
    } else {
      try { player.current.seekTo(start, true); playing ? player.current.playVideo() : player.current.pauseVideo(); } catch {}
    }
  }
  function applyRemote(s: WatchPartyState, silent = false) {
    if ((s.room ?? "lobby") !== watchRoomService.current) return; // another room's party — ignore
    const prev = lastStage.current; lastStage.current = s; setStage(s);
    if (!silent && s.by && s.by !== me?.publicKey) {
      const who = nameFor(s);
      if (!prev?.videoId && s.videoId) { flash(`${who} started a watch party`); bus.emit("alert", { kind: "watch", text: `${who} started a watch party`, route: "/listen" }); }
      else if (prev && prev.videoId !== s.videoId) flash(`${who} changed the video`);
      else if (prev && prev.playing && !s.playing) flash(`${who} paused the video`);
      else if (prev && !prev.playing && s.playing) flash(`${who} resumed the video`);
    }
  }

  useEffect(() => {
    const off = bus.on("stage:in", (s) => applyRemote(s));
    const offStart = bus.on("watch:start", ({ videoId }) => {
      closedId.current = null; applying.current = true;
      ensurePlayer(videoId, 0, true); presenceService.setActivity("Watching", "a watch party");
      broadcast(true, 0, videoId); setTimeout(() => { applying.current = false; }, 1200);
    });
    // When another video/sound plays, pause our player locally (don't broadcast).
    const offMedia = bus.on("media:play", ({ id }) => {
      if (id !== "watch" && player.current) { try { applying.current = true; player.current.pauseVideo(); setTimeout(() => { applying.current = false; }, 800); } catch {} }
    });
    // Switching rooms → load that room's video (or clear the player if empty).
    const offRoom = bus.on("watchroom:change", (room) => {
      const s = peerService.currentStage(room);
      closedId.current = null;
      if (s?.videoId) applyRemote(s, true);
      else { lastStage.current = null; setStage(null); try { player.current?.stopVideo?.(); } catch {} }
    });
    const cur = peerService.currentStage(watchRoomService.current); lastStage.current = cur;
    if (cur?.videoId) applyRemote(cur, true);
    return () => { off(); offStart(); offMedia(); offRoom(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const active = !!stage?.videoId && closedId.current !== stage?.videoId;

  // While a video is loaded, warn before an accidental refresh / tab-close that
  // would lose it (in-app navigation keeps the mini player, so it's safe).
  useEffect(() => {
    setUnloadGuard("watch", active);
    return () => setUnloadGuard("watch", false);
  }, [active]);

  // Pop the current video out to youtube.com at the exact moment you're watching.
  function openYT() {
    let t = 0; try { t = player.current?.getCurrentTime?.() ?? 0; } catch {}
    openOnYouTube(vid.current ?? stage?.videoId ?? null, t);
  }

  // (Re)create / sync the player whenever the active video changes.
  useEffect(() => {
    if (!active) { player.current = null; vid.current = null; return; }
    applying.current = true;
    ensurePlayer(stage!.videoId!, Math.max(0, posOf(stage!)), stage!.playing);
    const t = setTimeout(() => { applying.current = false; }, 1600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, stage?.videoId]);

  // Position: dock into the Listen page, else float bottom-right.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const h = host.current;
      if (h) {
        const dock = document.getElementById("watch-dock");
        if (dock) {
          const r = dock.getBoundingClientRect();
          Object.assign(h.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, right: "auto", bottom: "auto" });
          if (!docked) setDocked(true);
        } else {
          Object.assign(h.style, { left: "auto", top: "auto", right: "12px", bottom: "84px", width: "300px", height: "169px" });
          if (docked) setDocked(false);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [docked, active]);

  function toggle() { try { const p = player.current; if (!p) return; const YT = (window as any).YT; (p.getPlayerState?.() === YT.PlayerState.PLAYING ? p.pauseVideo : p.playVideo).call(p); } catch {} }
  function close() { if (stage?.videoId) closedId.current = stage.videoId; presenceService.clearActivity(); setStage((s) => (s ? { ...s } : s)); }

  if (!active) return null;

  return (
    <Box ref={host} sx={{ position: "fixed", zIndex: docked ? 1 : 1250, overflow: "hidden", bgcolor: "#000", borderRadius: 1, border: docked ? "1px solid var(--bl-line)" : "1px solid rgba(0,0,0,0.4)", boxShadow: docked ? "none" : "0 10px 30px rgba(0,0,0,0.45)", "& .yt-pop": { opacity: 0, transition: "opacity .15s" }, "&:hover .yt-pop": { opacity: 1 } }}>
      <Box ref={mount} sx={{ width: "100%", height: "100%" }} />
      {docked && (
        <Tooltip title="Open on YouTube (current time)">
          <IconButton className="yt-pop" size="small" onClick={openYT} sx={{ position: "absolute", top: 6, right: 6, color: "#fff", bgcolor: "rgba(0,0,0,0.5)", "&:hover": { bgcolor: "rgba(0,0,0,0.75)" } }}><YouTubeIcon fontSize="small" /></IconButton>
        </Tooltip>
      )}
      {!docked && (
        <Stack direction="row" alignItems="center" spacing={0.5} sx={{ position: "absolute", top: 0, left: 0, right: 0, px: 0.5, py: 0.25, background: "linear-gradient(180deg, rgba(0,0,0,0.7), transparent)" }}>
          <Typography variant="caption" sx={{ color: "#fff", flex: 1, ml: 0.5 }}>Watch party</Typography>
          <Tooltip title="Open on YouTube (current time)"><IconButton size="small" sx={{ color: "#fff" }} onClick={openYT}><YouTubeIcon fontSize="small" /></IconButton></Tooltip>
          <Tooltip title={stage?.playing ? "Pause" : "Play"}><IconButton size="small" sx={{ color: "#fff" }} onClick={toggle}>{stage?.playing ? <PauseRoundedIcon fontSize="small" /> : <PlayArrowRoundedIcon fontSize="small" />}</IconButton></Tooltip>
          <Tooltip title="Open"><IconButton size="small" sx={{ color: "#fff" }} onClick={() => nav("/listen")}><OpenInFullRoundedIcon fontSize="small" /></IconButton></Tooltip>
          <Tooltip title="Close"><IconButton size="small" sx={{ color: "#fff" }} onClick={close}><CloseRoundedIcon fontSize="small" /></IconButton></Tooltip>
        </Stack>
      )}
    </Box>
  );
}
