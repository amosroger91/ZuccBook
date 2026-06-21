import { useEffect, useState } from "react";
import { Box, Stack, Typography, Button, Slider, Chip, CircularProgress, Grid } from "@mui/material";
import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";
import StopRoundedIcon from "@mui/icons-material/StopRounded";
import GlassCard from "@/components/common/GlassCard";
import { listenTogetherService, type Station } from "@/services/listenTogetherService";
import { presenceService } from "@/services/presenceService";
import { reputationService } from "@/services/reputationService";
import { toast } from "@/lib/events";

export default function ListenView() {
  const [stations, setStations] = useState<Station[]>([]);
  const [loading, setLoading] = useState(true);
  const [current, setCurrent] = useState<Station | null>(null);
  const [vol, setVol] = useState(60);

  useEffect(() => {
    listenTogetherService.stations().then((s) => { setStations(s); setLoading(false); }).catch(() => setLoading(false));
    return () => listenTogetherService.stop();
  }, []);

  async function play(s: Station) {
    const ok = await listenTogetherService.play(s.url);
    if (ok) {
      setCurrent(s);
      presenceService.setActivity("Listening", s.name);
      reputationService.award("participation", 1, "started a listen-together session");
    } else toast("Couldn't play this station — try another", "warn");
  }
  function stop() { listenTogetherService.stop(); setCurrent(null); presenceService.clearActivity(); }

  return (
    <Box sx={{ maxWidth: 1000, mx: "auto" }}>
      <Typography variant="h5">Listen Together</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Synchronized media rooms — Spotify Jam × Discord Voice × Watch Party. Pick a station; in a room everyone hears the same thing at the same timestamp (sync over the peer relay).
      </Typography>

      <GlassCard sx={{ mb: 2, background: "linear-gradient(135deg, rgba(110,231,255,0.12), rgba(244,114,182,0.12))" }}>
        <Stack direction="row" alignItems="center" spacing={2}>
          <Box sx={{ width: 64, height: 64, borderRadius: 2, display: "grid", placeItems: "center", fontSize: 30, background: "rgba(0,0,0,0.3)" }}>{current ? "🎶" : "🎧"}</Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="h6" noWrap>{current ? current.name : "Nothing playing"}</Typography>
            <Typography variant="caption" color="text.secondary">{current ? `${current.genre} · live` : "Choose a station below"}</Typography>
          </Box>
          {current
            ? <Button variant="outlined" startIcon={<StopRoundedIcon />} onClick={stop}>Stop</Button>
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
                    <Chip size="small" label={s.genre} sx={{ mt: 0.5, bgcolor: "rgba(167,139,250,0.14)", color: "#a78bfa" }} />
                  </Box>
                  <Button size="small" variant="contained" sx={{ minWidth: 0, px: 1.2 }} onClick={() => play(s)}><PlayArrowRoundedIcon /></Button>
                </Stack>
              </GlassCard>
            </Grid>
          ))}
          {stations.length === 0 && <Grid item xs={12}><GlassCard><Typography color="text.secondary">Station directory unreachable right now. (It's a free public API — try again later.)</Typography></GlassCard></Grid>}
        </Grid>
      )}
    </Box>
  );
}
