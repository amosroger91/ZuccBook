import { Box, Stack, Typography, Select, MenuItem, Switch, FormControlLabel, Divider, Button } from "@mui/material";
import GlassCard from "@/components/common/GlassCard";
import { useStore } from "@/store/useStore";
import type { FeedAlgorithm, ModerationProfile, CompanionPersona, PresenceStatus } from "@/types";
import { toast } from "@/lib/events";

const FEED: FeedAlgorithm[] = ["ai-curated", "chronological", "trending", "discovery", "friends", "community"];
const MOD: ModerationProfile[] = ["discovery", "family-friendly", "academic", "gaming", "unfiltered"];
const PERSONA: CompanionPersona[] = ["friend", "coach", "comedian", "critic", "researcher"];
const STATUS: PresenceStatus[] = ["online", "idle", "away", "dnd"];

export default function SettingsView() {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);

  function row(label: string, hint: string, control: React.ReactNode) {
    return (
      <Stack direction={{ xs: "column", sm: "row" }} alignItems={{ sm: "center" }} spacing={1} sx={{ py: 1.2 }}>
        <Box sx={{ flex: 1 }}>
          <Typography sx={{ fontWeight: 600 }}>{label}</Typography>
          <Typography variant="caption" color="text.secondary">{hint}</Typography>
        </Box>
        {control}
      </Stack>
    );
  }

  return (
    <Box sx={{ maxWidth: 760, mx: "auto" }}>
      <Typography variant="h5" sx={{ mb: 2 }}>Settings</Typography>

      <GlassCard sx={{ mb: 2 }}>
        <Typography variant="overline" color="text.secondary">Feed & moderation</Typography>
        {row("Default feed algorithm", "How your feed is ranked — all on-device.",
          <Select size="small" value={settings.feedAlgorithm} onChange={(e) => setSettings({ feedAlgorithm: e.target.value as FeedAlgorithm })}>{FEED.map((f) => <MenuItem key={f} value={f}>{f}</MenuItem>)}</Select>)}
        <Divider />
        {row("Moderation profile", "Layered local filtering. 'Unfiltered' disables Layer 1.",
          <Select size="small" value={settings.moderationProfile} onChange={(e) => setSettings({ moderationProfile: e.target.value as ModerationProfile })}>{MOD.map((m) => <MenuItem key={m} value={m}>{m}</MenuItem>)}</Select>)}
      </GlassCard>

      <GlassCard sx={{ mb: 2 }}>
        <Typography variant="overline" color="text.secondary">AI companion</Typography>
        {row("Persona", "Your companion's voice & style.",
          <Select size="small" value={settings.companionPersona} onChange={(e) => setSettings({ companionPersona: e.target.value as CompanionPersona })}>{PERSONA.map((p) => <MenuItem key={p} value={p}>{p}</MenuItem>)}</Select>)}
        <Divider />
        {row("Use on-device LLM (WebGPU)", "Loads a real local model via WebLLM. Big download, fully private. Falls back to the fast heuristic engine if WebGPU isn't available.",
          <Switch checked={settings.useWebLLM} onChange={(e) => { setSettings({ useWebLLM: e.target.checked }); if (e.target.checked) toast("Local model will download on next companion message", "info"); }} />)}
      </GlassCard>

      <GlassCard sx={{ mb: 2 }}>
        <Typography variant="overline" color="text.secondary">Presence & motion</Typography>
        {row("Status", "What others on the network see.",
          <Select size="small" value={settings.presenceStatus} onChange={(e) => setSettings({ presenceStatus: e.target.value as PresenceStatus })}>{STATUS.map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}</Select>)}
        <Divider />
        <FormControlLabel control={<Switch checked={settings.reducedMotion} onChange={(e) => setSettings({ reducedMotion: e.target.checked })} />} label="Reduce motion (calms the animated background)" sx={{ mt: 1 }} />
      </GlassCard>

      <GlassCard>
        <Typography variant="overline" color="text.secondary">Data</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          Everything lives in this browser (IndexedDB + localStorage). Clearing site data wipes your local copy — export your identity first from the Profile page.
        </Typography>
        <Button color="error" variant="outlined" sx={{ mt: 1.5 }} onClick={() => { if (confirm("Reset Nebula on this device? This clears local data. Export your identity first!")) { indexedDB.deleteDatabase("nebula"); localStorage.clear(); location.reload(); } }}>
          Reset this device
        </Button>
      </GlassCard>
    </Box>
  );
}
