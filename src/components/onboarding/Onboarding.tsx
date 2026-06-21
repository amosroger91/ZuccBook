import { useRef, useState } from "react";
import { Box, Button, TextField, Typography, Stack, Divider, Chip } from "@mui/material";
import GlassCard from "@/components/common/GlassCard";
import { identityService } from "@/services/identityService";
import { onOnboarded } from "@/services";
import { useStore } from "@/store/useStore";
import { toast } from "@/lib/events";

export default function Onboarding() {
  const refreshMe = useStore((s) => s.refreshMe);
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function create() {
    setBusy(true);
    try {
      await identityService.create(username);
      await onOnboarded();
      refreshMe();
      toast("Identity generated — it lives only on this device", "success");
    } finally { setBusy(false); }
  }

  async function importFile(file?: File) {
    if (!file) return;
    setBusy(true);
    try {
      await identityService.importFile(file);
      await onOnboarded();
      refreshMe();
      toast("Identity imported", "success");
    } catch { toast("That doesn't look like a Nebula identity file", "error"); }
    finally { setBusy(false); }
  }

  return (
    <Box sx={{ position: "relative", zIndex: 1, minHeight: "100vh", display: "grid", placeItems: "center", p: 2 }}>
      <GlassCard sx={{ p: 4, maxWidth: 480, width: "100%" }}>
        <Typography variant="h3" sx={{ background: "linear-gradient(90deg,#6ee7ff,#a78bfa,#f472b6)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>
          NEBULA
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

          <Divider><Chip label="or" size="small" /></Divider>

          <Button variant="outlined" disabled={busy} onClick={() => fileRef.current?.click()}>
            Import an identity file
          </Button>
          <input ref={fileRef} type="file" accept="application/json" hidden onChange={(e) => importFile(e.target.files?.[0])} />
        </Stack>

        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 3 }}>
          🔐 Your private key never leaves this device. Export it any time to move to another device — it's just a file.
        </Typography>
      </GlassCard>
    </Box>
  );
}
