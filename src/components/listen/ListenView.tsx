import { useEffect, useState } from "react";
import { Box, Stack, Typography, Button, Slider, Chip, CircularProgress, Grid, ToggleButtonGroup, ToggleButton, TextField } from "@mui/material";
import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";
import StopRoundedIcon from "@mui/icons-material/StopRounded";
import MusicNoteRoundedIcon from "@mui/icons-material/MusicNoteRounded";
import SmartDisplayRoundedIcon from "@mui/icons-material/SmartDisplayRounded";
import GlassCard from "@/components/common/GlassCard";
import { listenTogetherService, type Station } from "@/services/listenTogetherService";
import { presenceService } from "@/services/presenceService";
import { reputationService } from "@/services/reputationService";
import { toast } from "@/lib/events";

/** Parse a YouTube video id from a URL or raw id. */
function youtubeId(input: string): string | null {
  const s = input.trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  const m =
    s.match(/[?&]v=([\w-]{11})/) ||
    s.match(/youtu\.be\/([\w-]{11})/) ||
    s.match(/youtube\.com\/(?:embed|shorts|live)\/([\w-]{11})/);
  return m ? m[1] : null;
}

export default function ListenView() {
  const [mode, setMode] = useState<"music" | "video">("music");

  // --- music (internet radio) ---
  const [stations, setStations] = useState<Station[]>([]);
  const [loading, setLoading] = useState(true);
  const [current, setCurrent] = useState<Station | null>(null);
  const [vol, setVol] = useState(60);

  // --- video (youtube) ---
  const [urlInput, setUrlInput] = useState("");
  const [videoId, setVideoId] = useState<string | null>(null);

  useEffect(() => {
    listenTogetherService.stations().then((s) => { setStations(s); setLoading(false); }).catch(() => setLoading(false));
    // NOTE: we intentionally do NOT stop playback on unmount — music keeps
    // playing as you navigate; the mini-player controls it from anywhere.
  }, []);

  async function playStation(s: Station) {
    const ok = await listenTogetherService.play(s);
    if (ok) {
      setCurrent(s);
      presenceService.setActivity("Listening", s.name);
      reputationService.award("participation", 1, "started a listen-together session");
    } else toast("Couldn't play this station — try another", "warn");
  }
  function stopStation() { listenTogetherService.stop(); setCurrent(null); presenceService.clearActivity(); }

  function playVideo() {
    const id = youtubeId(urlInput);
    if (!id) { toast("Paste a valid YouTube link", "warn"); return; }
    // stop audio so they don't overlap; video carries its own sound
    listenTogetherService.stop(); setCurrent(null);
    setVideoId(id);
    presenceService.setActivity("Watching", "a YouTube video");
    reputationService.award("participation", 1, "started a watch-together session");
  }
  function stopVideo() { setVideoId(null); presenceService.clearActivity(); }

  return (
    <Box sx={{ maxWidth: 1000, mx: "auto" }}>
      <Typography variant="h5">Watch &amp; Listen Together</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Synchronized rooms — Spotify Jam × Discord Voice × Watch Party. Stream internet radio or drop a YouTube video; in a room everyone shares the same moment (sync over the peer relay).
      </Typography>

      <ToggleButtonGroup
        exclusive size="small" value={mode} onChange={(_, v) => v && setMode(v)}
        sx={{ mb: 2, "& .MuiToggleButton-root": { border: "1px solid rgba(58,155,240,0.18)", color: "text.secondary", "&.Mui-selected": { background: "linear-gradient(135deg,#39c6f5,#3a7bf0)", color: "#031426" } } }}
      >
        <ToggleButton value="music"><MusicNoteRoundedIcon fontSize="small" sx={{ mr: 0.5 }} /> Music</ToggleButton>
        <ToggleButton value="video"><SmartDisplayRoundedIcon fontSize="small" sx={{ mr: 0.5 }} /> Video</ToggleButton>
      </ToggleButtonGroup>

      {mode === "music" && (
        <>
          <GlassCard sx={{ mb: 2, background: "linear-gradient(135deg, rgba(58,155,240,0.12), rgba(54,224,196,0.12))" }}>
            <Stack direction="row" alignItems="center" spacing={2}>
              <Box sx={{ width: 64, height: 64, borderRadius: 2, display: "grid", placeItems: "center", fontSize: 30, background: "rgba(0,0,0,0.3)" }}>{current ? "🎶" : "🎧"}</Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="h6" noWrap>{current ? current.name : "Nothing playing"}</Typography>
                <Typography variant="caption" color="text.secondary">{current ? `${current.genre} · live` : "Choose a station below"}</Typography>
              </Box>
              {current
                ? <Button variant="outlined" startIcon={<StopRoundedIcon />} onClick={stopStation}>Stop</Button>
                : <Chip label="idle" variant="outlined" />}
            </Stack>
            <Stack direction="row" alignItems="center" spacing={2} sx={{ mt: 2 }}>
              <Typography variant="caption">Volume</Typography>
              <Slider size="small" value={vol} onChange={(_, v) => { setVol(v as number); listenTogetherService.setVolume((v as number) / 100); }} sx={{ maxWidth: 240 }} />
            </Stack>
          </GlassCard>

          {loading ? (
            <Stack direction="row" alignItems="center" spacing={1}><CircularProgress size={16} /><Typography variant="caption" color="text.secondary">Finding stations…</Typography></Stack>
          ) : (
            <Grid container spacing={1.5}>
              {stations.map((s) => (
                <Grid item xs={12} sm={6} md={4} key={s.url}>
                  <GlassCard>
                    <Stack direction="row" alignItems="center" spacing={1.5}>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography noWrap sx={{ fontWeight: 700 }}>{s.name}</Typography>
                        <Chip size="small" label={s.genre} sx={{ mt: 0.5, bgcolor: "rgba(58,123,240,0.14)", color: "#3a7bf0" }} />
                      </Box>
                      <Button size="small" variant="contained" sx={{ minWidth: 0, px: 1.2 }} onClick={() => playStation(s)}><PlayArrowRoundedIcon /></Button>
                    </Stack>
                  </GlassCard>
                </Grid>
              ))}
              {stations.length === 0 && <Grid item xs={12}><GlassCard><Typography color="text.secondary">Station directory unreachable right now. (It's a free public API — try again later.)</Typography></GlassCard></Grid>}
            </Grid>
          )}
        </>
      )}

      {mode === "video" && (
        <>
          <GlassCard sx={{ mb: 2 }}>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
              <TextField
                fullWidth size="small" value={urlInput} placeholder="Paste a YouTube link (or video id)…"
                onChange={(e) => setUrlInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && playVideo()}
              />
              <Button variant="contained" startIcon={<PlayArrowRoundedIcon />} onClick={playVideo}>Watch</Button>
              {videoId && <Button variant="outlined" startIcon={<StopRoundedIcon />} onClick={stopVideo}>Stop</Button>}
            </Stack>
          </GlassCard>

          <GlassCard sx={{ p: videoId ? 0 : 2, overflow: "hidden" }}>
            {videoId ? (
              <Box sx={{ position: "relative", pt: "56.25%" }}>
                <Box
                  component="iframe"
                  src={`https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0`}
                  title="YouTube watch-together"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  sx={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
                />
              </Box>
            ) : (
              <Typography color="text.secondary">Paste a YouTube link above to start a watch party. Everyone in the room sees the same video; chat and reactions happen alongside it. (Playback-position sync lands in Phase 2.)</Typography>
            )}
          </GlassCard>
        </>
      )}
    </Box>
  );
}
