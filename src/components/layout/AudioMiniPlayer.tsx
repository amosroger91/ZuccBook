import { useEffect, useState } from "react";
import { Box, Stack, Typography, IconButton, Slider, Tooltip } from "@mui/material";
import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";
import PauseRoundedIcon from "@mui/icons-material/PauseRounded";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import MusicNoteRoundedIcon from "@mui/icons-material/MusicNoteRounded";
import VolumeUpRoundedIcon from "@mui/icons-material/VolumeUpRounded";
import { audioPlayerService } from "@/services/audioPlayerService";
import { listenTogetherService } from "@/services/listenTogetherService";
import { bus } from "@/lib/events";

const fmt = (s: number) => (isFinite(s) && s > 0 ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}` : "0:00");

/** Persistent bottom bar for a shared mp3 — play/pause, seek and volume,
 *  always controllable. Sits above the radio bar when both are present. */
export default function AudioMiniPlayer() {
  const [state, setState] = useState<{ title: string | null; playing: boolean; url: string | null }>({
    title: audioPlayerService.current?.title ?? null, playing: audioPlayerService.playing, url: audioPlayerService.current?.url ?? null,
  });
  const [time, setTime] = useState<{ cur: number; dur: number }>({ cur: 0, dur: 0 });
  const [vol, setVol] = useState(Math.round(audioPlayerService.volume * 100));
  const [radioActive, setRadioActive] = useState(!!listenTogetherService.current);

  useEffect(() => {
    const a = bus.on("audio:now", setState);
    const b = bus.on("audio:time", setTime);
    const c = bus.on("listen:now", (s) => setRadioActive(!!s.station));
    return () => { a(); b(); c(); };
  }, []);

  if (!state.url) return null;
  const frac = time.dur ? (time.cur / time.dur) * 100 : 0;

  return (
    <Box sx={{
      position: "fixed", left: 0, right: 0, bottom: radioActive ? 64 : 0, zIndex: 1201,
      px: { xs: 1.5, md: 2 }, py: 1, display: "flex", alignItems: "center", gap: 1.5,
      background: "rgba(236,233,216,0.96)", backdropFilter: "blur(18px) saturate(1.3)",
      borderTop: "1px solid rgba(0,0,0,0.14)", boxShadow: "0 -8px 30px rgba(0,0,0,0.4)",
    }}>
      <Box sx={{ width: 40, height: 40, flex: "0 0 auto", borderRadius: 1.5, display: "grid", placeItems: "center", color: "#fff", background: "linear-gradient(135deg,#7c5cff,#4a1fd0)" }}>
        <MusicNoteRoundedIcon />
      </Box>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography noWrap sx={{ fontWeight: 700, fontSize: 14 }}>{state.title || "Audio"}</Typography>
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography variant="caption" color="text.secondary" sx={{ width: 34, textAlign: "right" }}>{fmt(time.cur)}</Typography>
          <Slider size="small" value={frac} onChange={(_, v) => audioPlayerService.seekFrac((v as number) / 100)} sx={{ flex: 1, minWidth: 80 }} />
          <Typography variant="caption" color="text.secondary" sx={{ width: 34 }}>{fmt(time.dur)}</Typography>
        </Stack>
      </Box>

      <Tooltip title={state.playing ? "Pause" : "Play"}>
        <IconButton color="primary" onClick={() => audioPlayerService.toggle()}>
          {state.playing ? <PauseRoundedIcon /> : <PlayArrowRoundedIcon />}
        </IconButton>
      </Tooltip>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ width: 120, display: { xs: "none", sm: "flex" } }}>
        <VolumeUpRoundedIcon fontSize="small" sx={{ opacity: 0.7 }} />
        <Slider size="small" value={vol} onChange={(_, v) => { setVol(v as number); audioPlayerService.setVolume((v as number) / 100); }} />
      </Stack>
      <Tooltip title="Close (stops audio)"><IconButton onClick={() => audioPlayerService.stop()}><CloseRoundedIcon /></IconButton></Tooltip>
    </Box>
  );
}
