import { useEffect, useState } from "react";
import { Box, Stack, Typography, IconButton, Slider, Chip, Tooltip } from "@mui/material";
import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";
import PauseRoundedIcon from "@mui/icons-material/PauseRounded";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import QueueMusicRoundedIcon from "@mui/icons-material/QueueMusicRounded";
import VolumeUpRoundedIcon from "@mui/icons-material/VolumeUpRounded";
import { useNavigate } from "react-router-dom";
import { listenTogetherService } from "@/services/listenTogetherService";
import { bus } from "@/lib/events";

/** Persistent music bar — visible on every screen so playback is always
 *  controllable. Audio itself is a singleton in listenTogetherService, so it
 *  keeps playing across route changes. */
export default function MiniPlayer() {
  const nav = useNavigate();
  const [state, setState] = useState<{ station: { name: string; genre: string; url: string } | null; playing: boolean }>({
    station: listenTogetherService.current ? { name: listenTogetherService.current.name, genre: listenTogetherService.current.genre, url: listenTogetherService.current.url } : null,
    playing: listenTogetherService.playing,
  });
  const [vol, setVol] = useState(Math.round(listenTogetherService.volume * 100));

  useEffect(() => bus.on("listen:now", setState), []);

  if (!state.station) return null;

  return (
    <Box sx={{
      position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 1200,
      px: { xs: 1.5, md: 2 }, py: 1,
      display: "flex", alignItems: "center", gap: 1.5,
      background: "rgba(10,15,26,0.72)", backdropFilter: "blur(18px) saturate(1.3)",
      borderTop: "1px solid rgba(255,255,255,0.14)", boxShadow: "0 -8px 30px rgba(0,0,0,0.4)",
    }}>
      <Box sx={{ width: 40, height: 40, flex: "0 0 auto", borderRadius: 1.5, display: "grid", placeItems: "center", fontSize: 20, background: "linear-gradient(135deg,#39c6f5,#3a7bf0)" }}>
        {state.playing ? "🎶" : "🎧"}
      </Box>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography noWrap sx={{ fontWeight: 700, fontSize: 14 }}>{state.station.name}</Typography>
        <Stack direction="row" spacing={0.5} alignItems="center">
          <Chip size="small" label={state.station.genre} sx={{ height: 16, fontSize: 10, bgcolor: "rgba(58,123,240,0.18)", color: "#9fd0ff" }} />
          <Typography variant="caption" color="text.secondary">{state.playing ? "live" : "paused"}</Typography>
        </Stack>
      </Box>

      <Tooltip title={state.playing ? "Pause" : "Play"}>
        <IconButton color="primary" onClick={() => listenTogetherService.toggle()}>
          {state.playing ? <PauseRoundedIcon /> : <PlayArrowRoundedIcon />}
        </IconButton>
      </Tooltip>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ width: 130, display: { xs: "none", sm: "flex" } }}>
        <VolumeUpRoundedIcon fontSize="small" sx={{ opacity: 0.7 }} />
        <Slider size="small" value={vol} onChange={(_, v) => { setVol(v as number); listenTogetherService.setVolume((v as number) / 100); }} />
      </Stack>

      <Tooltip title="Browse stations & video"><IconButton onClick={() => nav("/listen")}><QueueMusicRoundedIcon /></IconButton></Tooltip>
      <Tooltip title="Close player (stops music)"><IconButton onClick={() => listenTogetherService.stop()}><CloseRoundedIcon /></IconButton></Tooltip>
    </Box>
  );
}
