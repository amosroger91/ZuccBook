import { useEffect, useState } from "react";
import { Box, Stack, TextField, Button, Chip, Typography, Tooltip, FormControlLabel, Checkbox } from "@mui/material";
import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";
import LockRoundedIcon from "@mui/icons-material/LockRounded";
import GlassCard from "@/components/common/GlassCard";
import { peerService } from "@/services/peerService";
import { profileService } from "@/services/profileService";
import { watchRoomService, LOBBY, roomLabel, isPrivate } from "@/services/watchRoomService";
import { bus, toast } from "@/lib/events";
import { useStore } from "@/store/useStore";
import { fingerprint } from "@/lib/crypto";
import type { WatchPartyState } from "@/types";

const PRESETS = ["movies", "music-videos", "gaming", "chill", "late-night"];

function youtubeId(input: string): string | null {
  const s = input.trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  const m = s.match(/[?&]v=([\w-]{11})/) || s.match(/youtu\.be\/([\w-]{11})/) || s.match(/youtube\.com\/(?:embed|shorts|live)\/([\w-]{11})/);
  return m ? m[1] : null;
}

/** "Watch with friends" rooms — like chatrooms, but everyone in a room shares
 *  the same synced YouTube moment. One public Lobby, named public rooms, and
 *  private rooms. The actual player is the global GlobalWatchPlayer (docks into
 *  #watch-dock and keeps playing as you move around). */
export default function WatchParty() {
  const me = useStore((s) => s.me);
  const [input, setInput] = useState("");
  const [room, setRoom] = useState(watchRoomService.current);
  const [stage, setStage] = useState<WatchPartyState | null>(peerService.currentStage(watchRoomService.current));
  const [active, setActive] = useState<WatchPartyState[]>(peerService.activeRooms());
  const [joinName, setJoinName] = useState("");
  const [priv, setPriv] = useState(false);

  useEffect(() => {
    const sync = () => { setStage(peerService.currentStage(watchRoomService.current)); setActive(peerService.activeRooms()); };
    const off1 = bus.on("stage:in", sync);
    const off2 = bus.on("watchroom:change", (r) => { setRoom(r); sync(); });
    // Your own start broadcasts via stage:out; re-read after it's stored.
    const off3 = bus.on("watch:start", () => setTimeout(sync, 60));
    const t = setInterval(() => setActive(peerService.activeRooms()), 4000);
    return () => { off1(); off2(); off3(); clearInterval(t); };
  }, []);

  function switchRoom(r: string) { watchRoomService.set(r); setRoom(r); setStage(peerService.currentStage(r)); }
  function joinByName() {
    const n = joinName.trim(); if (!n) return;
    switchRoom(priv ? watchRoomService.makePrivate(n) : watchRoomService.makePublic(n));
    setJoinName("");
  }
  function start() {
    const id = youtubeId(input);
    if (!id) { toast("Paste a valid YouTube link", "warn"); return; }
    setInput("");
    bus.emit("watch:start", { videoId: id });
  }

  const isActive = !!stage?.videoId;
  const startedBy = stage?.by === me?.publicKey ? "you" : (stage?.byName || profileService.get(stage?.by ?? "")?.username || fingerprint(stage?.by ?? ""));
  const otherRooms = active.filter((s) => (s.room ?? LOBBY) !== room);

  return (
    <>
      {/* room switcher */}
      <GlassCard sx={{ mb: 2 }}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
          <Typography sx={{ fontWeight: 800 }}>🍿 {roomLabel(room)}</Typography>
          {isPrivate(room) && <Tooltip title="Private room"><LockRoundedIcon sx={{ fontSize: 16, color: "text.secondary" }} /></Tooltip>}
          <Box sx={{ flex: 1 }} />
          <Typography variant="caption" color="text.secondary">you're in this room</Typography>
        </Stack>
        <Stack direction="row" spacing={0.5} sx={{ flexWrap: "wrap", gap: 0.5 }}>
          <Chip label="🍿 Public Lobby" size="small" onClick={() => switchRoom(LOBBY)} variant={room === LOBBY ? "filled" : "outlined"}
            sx={room === LOBBY ? { background: "linear-gradient(135deg,#3f97ff,#1668e0)", color: "#fff", fontWeight: 700 } : {}} />
          {PRESETS.map((p) => (
            <Chip key={p} label={"#" + p} size="small" onClick={() => switchRoom(p)} variant={room === p ? "filled" : "outlined"}
              sx={room === p ? { background: "linear-gradient(135deg,#3f97ff,#1668e0)", color: "#fff", fontWeight: 700 } : {}} />
          ))}
        </Stack>
        <Stack direction="row" spacing={1} sx={{ mt: 1.5 }} alignItems="center">
          <TextField size="small" placeholder="Join or make a room by name…" value={joinName} onChange={(e) => setJoinName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && joinByName()} sx={{ flex: 1 }} />
          <FormControlLabel control={<Checkbox size="small" checked={priv} onChange={(e) => setPriv(e.target.checked)} />} label="Private" />
          <Button variant="outlined" disabled={!joinName.trim()} onClick={joinByName}>Join</Button>
        </Stack>
        {otherRooms.length > 0 && (
          <Box sx={{ mt: 1.5 }}>
            <Typography variant="caption" color="text.secondary">Active public rooms</Typography>
            <Stack direction="row" spacing={0.5} sx={{ flexWrap: "wrap", gap: 0.5, mt: 0.5 }}>
              {otherRooms.map((s) => (
                <Chip key={s.room} size="small" label={`${roomLabel(s.room ?? LOBBY)} · ▶`} onClick={() => switchRoom(s.room ?? LOBBY)} sx={{ bgcolor: "rgba(84,201,90,0.16)", color: "#3ba33b" }} />
              ))}
            </Stack>
          </Box>
        )}
      </GlassCard>

      {/* in-room controls + player */}
      <GlassCard sx={{ mb: 2 }}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ sm: "center" }}>
          <TextField fullWidth size="small" value={input} placeholder={`Paste a YouTube link to play in ${roomLabel(room)}…`} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && start()} />
          <Button variant="contained" startIcon={<PlayArrowRoundedIcon />} onClick={start}>Watch together</Button>
        </Stack>
        {isActive && (
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1, flexWrap: "wrap" }}>
            <Chip size="small" label={stage?.playing ? "▶ playing" : "❚❚ paused"} sx={{ bgcolor: "rgba(84,201,90,0.16)", color: "#3ba33b" }} />
            <Typography variant="caption" color="text.secondary">synced room · started by {startedBy} · keeps playing as you browse</Typography>
          </Stack>
        )}
      </GlassCard>

      <GlassCard sx={{ p: isActive ? 0 : 2, overflow: "hidden" }}>
        {isActive
          ? <Box id="watch-dock" sx={{ position: "relative", pt: "56.25%", width: "100%" }} />
          : <Typography color="text.secondary">Nothing playing in <b>{roomLabel(room)}</b> yet. Paste a YouTube link above and everyone in this room watches in sync — people who join mid-video jump to the current moment, and it keeps playing in a mini player as you move around the app.</Typography>}
      </GlassCard>
    </>
  );
}
