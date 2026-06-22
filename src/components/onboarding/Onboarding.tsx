import { useRef, useState } from "react";
import { Box, Button, TextField, Typography, Stack, Divider, Chip, Link } from "@mui/material";
import QrCodeScannerRoundedIcon from "@mui/icons-material/QrCodeScannerRounded";
import InstallMobileRoundedIcon from "@mui/icons-material/InstallMobileRounded";
import GlassCard from "@/components/common/GlassCard";
import { identityService } from "@/services/identityService";
import { onOnboarded } from "@/services";
import { useStore } from "@/store/useStore";
import { toast } from "@/lib/events";
import QrScanDialog from "@/components/profile/QrScanDialog";
import InstallHelpDialog from "@/components/layout/InstallHelpDialog";

export default function Onboarding() {
  const refreshMe = useStore((s) => s.refreshMe);
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [scan, setScan] = useState(false);
  const [install, setInstall] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Scanned the QR from a signed-in device → hand the link to the receiver.
  function onScanned(frag: string) {
    setScan(false);
    location.replace(`${location.pathname}${location.search}${frag}`);
    location.reload();
  }

  async function create() {
    setBusy(true);
    try {
      await identityService.create(username);
      refreshMe();   // enter the app immediately
      toast("Identity generated — it lives only on this device", "success");
      onOnboarded().catch((e) => console.warn("[onboard] background init failed", e)); // best-effort
    } catch (e) {
      console.error(e);
      toast("Couldn't generate identity — check your browser supports Web Crypto", "error");
    } finally { setBusy(false); }
  }

  async function importFile(file?: File) {
    if (!file) return;
    setBusy(true);
    try {
      await identityService.importFile(file);
      refreshMe();
      toast("Identity imported", "success");
      onOnboarded().catch((e) => console.warn("[onboard] background init failed", e));
    } catch { toast("That doesn't look like a ZuccBook identity file", "error"); }
    finally { setBusy(false); }
  }

  return (
    <Box sx={{ position: "relative", zIndex: 1, minHeight: "100vh", display: "grid", placeItems: "center", p: 2 }}>
      <GlassCard sx={{ p: 4, maxWidth: 480, width: "100%" }}>
        <Typography variant="h3" sx={{ background: "linear-gradient(90deg,#3f97ff,#1668e0,#0a55cf)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>
          ZuccBook
        </Typography>
        <Typography variant="body1" color="text.secondary" sx={{ mt: 1, mb: 3 }}>
          The local-first social universe. No accounts, no email, no servers — you generate a cryptographic identity that you own. Every action you take is signed by it.
        </Typography>

        <Stack spacing={2}>
          <TextField
            label="Pick a display name (optional)"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="leave blank for a random handle"
            fullWidth
          />
          <Button variant="contained" size="large" disabled={busy} onClick={create}>
            Generate my identity →
          </Button>

          <Divider><Chip label="already have an account?" size="small" /></Divider>

          <Button variant="outlined" disabled={busy} startIcon={<QrCodeScannerRoundedIcon />} onClick={() => setScan(true)}>
            Scan a signed-in device
          </Button>
          <Typography variant="caption" color="text.secondary" sx={{ mt: -1 }}>
            On your other device, open <b>Profile → Edit profile → "Log in on another device"</b> to show its QR — your whole profile copies over.
          </Typography>

          <Button variant="text" disabled={busy} onClick={() => fileRef.current?.click()}>
            Import an identity file instead
          </Button>
          <input ref={fileRef} type="file" accept="application/json" hidden onChange={(e) => importFile(e.target.files?.[0])} />
        </Stack>

        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 1, mt: 3 }}>
          <Typography variant="caption" color="text.secondary">
            🔐 Your private key never leaves this device.
          </Typography>
          <Link component="button" type="button" variant="caption" underline="hover" onClick={() => setInstall(true)} sx={{ display: "inline-flex", alignItems: "center", gap: 0.5, fontWeight: 700 }}>
            <InstallMobileRoundedIcon sx={{ fontSize: 16 }} /> Install on your phone
          </Link>
        </Box>

        <QrScanDialog open={scan} onClose={() => setScan(false)} onFound={onScanned} />
        <InstallHelpDialog open={install} onClose={() => setInstall(false)} />
      </GlassCard>
    </Box>
  );
}
