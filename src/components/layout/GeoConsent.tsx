// ============================================================
//  GeoConsent — a one-time, opt-in prompt to place yourself on the
//  network world-map using your device location. Scoped narrowly: we
//  say plainly it's ONLY for the node map and only an approximate dot.
//  Decline and we still show you via a coarse IP-based guess.
// ============================================================
import { useEffect, useState } from "react";
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Typography, Stack, Box } from "@mui/material";
import PublicRoundedIcon from "@mui/icons-material/PublicRounded";
import { geoService } from "@/services/geoService";
import { toast } from "@/lib/events";

export default function GeoConsent() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (geoService.asked() || !("geolocation" in navigator)) return;
    const t = window.setTimeout(() => setOpen(true), 3500); // let the app settle first
    return () => clearTimeout(t);
  }, []);

  async function allow() {
    setBusy(true);
    const ok = await geoService.requestPrecise();
    setBusy(false);
    setOpen(false);
    toast(ok ? "You're on the network map 🌍" : "Using an approximate location for the map", ok ? "success" : "info");
  }
  function decline() { geoService.markAsked(); setOpen(false); }

  return (
    <Dialog open={open} onClose={decline} maxWidth="xs" fullWidth PaperProps={{ sx: { borderRadius: 3, backgroundImage: "none" } }}>
      <DialogTitle sx={{ fontWeight: 800 }}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <Box sx={{ width: 34, height: 34, borderRadius: 2, display: "grid", placeItems: "center", color: "#fff", background: "linear-gradient(135deg,#3f97ff,#1668e0,#0a55cf)" }}><PublicRoundedIcon fontSize="small" /></Box>
          <span>Show yourself on the map?</span>
        </Stack>
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary">
          The <b>Network</b> page has a world map of where people are. Allow your location to place an
          <b> anonymous dot</b> on it. It's used <b>only for the node map</b> — coarsened to ~10&nbsp;km, no name
          attached, and never used for anything else.
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1.5 }}>
          Say no and you'll still appear at an approximate spot from your IP address. You can change this anytime.
        </Typography>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={decline} disabled={busy}>No thanks</Button>
        <Button variant="contained" onClick={allow} disabled={busy}>{busy ? "Locating…" : "Use my location"}</Button>
      </DialogActions>
    </Dialog>
  );
}
