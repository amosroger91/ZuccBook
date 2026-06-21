import { useEffect, useRef, useState } from "react";
import { Box, Stack, Typography, TextField, Button, Avatar, Chip, LinearProgress, Grid, Tooltip } from "@mui/material";
import DownloadRoundedIcon from "@mui/icons-material/DownloadRounded";
import GlassCard from "@/components/common/GlassCard";
import { identityService } from "@/services/identityService";
import { reputationService, BADGES } from "@/services/reputationService";
import { useStore } from "@/store/useStore";
import { avatarGradient, initials } from "@/components/common/avatar";
import { fingerprint } from "@/lib/crypto";
import { toast } from "@/lib/events";

export default function ProfileView() {
  const me = useStore((s) => s.me);
  const refreshMe = useStore((s) => s.refreshMe);
  const [username, setUsername] = useState(me?.username ?? "");
  const [bio, setBio] = useState(me?.bio ?? "");
  const [rep, setRep] = useState(0);
  const [breakdown, setBreakdown] = useState<Record<string, number>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { reputationService.total().then(setRep); reputationService.breakdown().then(setBreakdown); }, []);

  async function save() { await identityService.update({ username: username.trim() || me!.username, bio }); refreshMe(); toast("Profile saved", "success"); }
  async function importId(file?: File) {
    if (!file) return;
    try { await identityService.importFile(file); refreshMe(); toast("Identity replaced on this device", "success"); }
    catch { toast("Invalid identity file", "error"); }
  }

  const rank = reputationService.rank(rep);
  const next = reputationService.nextRank(rep);
  const badges = me?.badges ?? [];

  return (
    <Box sx={{ maxWidth: 880, mx: "auto" }}>
      <GlassCard sx={{ mb: 2 }}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
          <Avatar sx={{ width: 80, height: 80, fontSize: 30, fontWeight: 800, color: "#04121a", background: avatarGradient(me?.publicKey ?? "") }}>{initials(me?.username ?? "?")}</Avatar>
          <Box sx={{ flex: 1 }}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="h5">{me?.username}</Typography>
              <Chip size="small" label={rank} sx={{ background: "linear-gradient(135deg,#6ee7ff,#a78bfa)", color: "#04121a", fontWeight: 700 }} />
            </Stack>
            <Tooltip title={me?.publicKey ?? ""}>
              <Typography variant="caption" color="text.secondary" sx={{ fontFamily: "monospace" }}>id {fingerprint(me?.publicKey ?? "")}</Typography>
            </Tooltip>
            <Stack direction="row" spacing={2} sx={{ mt: 1 }}>
              <Box><Typography variant="h6">{rep}</Typography><Typography variant="caption" color="text.secondary">reputation</Typography></Box>
              <Box><Typography variant="h6">{badges.length}</Typography><Typography variant="caption" color="text.secondary">badges</Typography></Box>
            </Stack>
            {next && (
              <Box sx={{ mt: 1, maxWidth: 320 }}>
                <Typography variant="caption" color="text.secondary">{next.remaining} to {next.name}</Typography>
                <LinearProgress variant="determinate" value={Math.min(100, (rep / (rep + next.remaining)) * 100)} sx={{ height: 6, borderRadius: 3, mt: 0.5 }} />
              </Box>
            )}
          </Box>
        </Stack>
      </GlassCard>

      <Grid container spacing={2}>
        <Grid item xs={12} md={7}>
          <GlassCard>
            <Typography variant="overline" color="text.secondary">Edit profile</Typography>
            <Stack spacing={2} sx={{ mt: 1 }}>
              <TextField label="Display name" value={username} onChange={(e) => setUsername(e.target.value)} fullWidth />
              <TextField label="Bio" value={bio} onChange={(e) => setBio(e.target.value)} fullWidth multiline minRows={2} />
              <Stack direction="row" spacing={1}>
                <Button variant="contained" onClick={save}>Save</Button>
                <Button variant="outlined" startIcon={<DownloadRoundedIcon />} onClick={() => identityService.exportFile()}>Export identity</Button>
                <Button variant="text" onClick={() => fileRef.current?.click()}>Import</Button>
                <input ref={fileRef} type="file" accept="application/json" hidden onChange={(e) => importId(e.target.files?.[0])} />
              </Stack>
              <Typography variant="caption" color="text.secondary">🔐 Export saves your private key as a file. Keep it safe — it IS your account. Import it on any device to be you there.</Typography>
            </Stack>
          </GlassCard>
        </Grid>
        <Grid item xs={12} md={5}>
          <GlassCard sx={{ mb: 2 }}>
            <Typography variant="overline" color="text.secondary">Reputation breakdown</Typography>
            <Stack spacing={1} sx={{ mt: 1 }}>
              {["helpful", "expertise", "participation", "trust"].map((k) => (
                <Box key={k}>
                  <Stack direction="row" justifyContent="space-between"><Typography variant="body2" sx={{ textTransform: "capitalize" }}>{k}</Typography><Typography variant="caption">{breakdown[k] ?? 0}</Typography></Stack>
                  <LinearProgress variant="determinate" value={Math.min(100, ((breakdown[k] ?? 0) / Math.max(1, rep)) * 100)} sx={{ height: 5, borderRadius: 3 }} />
                </Box>
              ))}
            </Stack>
          </GlassCard>
          <GlassCard>
            <Typography variant="overline" color="text.secondary">Badges</Typography>
            <Stack direction="row" sx={{ mt: 1, flexWrap: "wrap", gap: 1 }}>
              {badges.map((b) => { const def = BADGES[b]; return <Tooltip key={b} title={def?.description ?? b}><Chip label={`${def?.icon ?? "🏅"} ${def?.label ?? b}`} /></Tooltip>; })}
              {badges.length === 0 && <Typography variant="caption" color="text.secondary">Earn badges by participating.</Typography>}
            </Stack>
          </GlassCard>
        </Grid>
      </Grid>
    </Box>
  );
}
