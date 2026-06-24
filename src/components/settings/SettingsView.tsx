import { useEffect, useState } from "react";
import { Box, Stack, Typography, Select, MenuItem, Switch, FormControlLabel, Divider, Button, Dialog, DialogTitle, DialogContent, DialogActions } from "@mui/material";
import QrCode2RoundedIcon from "@mui/icons-material/QrCode2Rounded";
import DownloadRoundedIcon from "@mui/icons-material/DownloadRounded";
import InstallMobileRoundedIcon from "@mui/icons-material/InstallMobileRounded";
import GlassCard from "@/components/common/GlassCard";
import DeviceLoginDialog from "@/components/profile/DeviceLoginDialog";
import InstallHelpDialog from "@/components/layout/InstallHelpDialog";
import { useStore } from "@/store/useStore";
import { factCheckService } from "@/services/factCheckService";
import { identityService } from "@/services/identityService";
import { nostrService } from "@/services/nostrService";
import { trustService } from "@/services/trustService";
import { feedService } from "@/services/feedService";
import { profileService } from "@/services/profileService";
import { fingerprint } from "@/lib/crypto";
import type { FeedAlgorithm, ModerationProfile, CompanionPersona, PresenceStatus } from "@/types";
import { bus, toast } from "@/lib/events";

const FEED: FeedAlgorithm[] = ["ai-curated", "chronological", "trending", "discovery", "friends", "community"];
const MOD: ModerationProfile[] = ["discovery", "family-friendly", "academic", "gaming", "unfiltered"];
const PERSONA: CompanionPersona[] = ["friend", "coach", "comedian", "critic", "researcher"];
const STATUS: PresenceStatus[] = ["online", "idle", "away", "dnd"];

export default function SettingsView() {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const [deviceLogin, setDeviceLogin] = useState(false);
  const [install, setInstall] = useState(false);
  const [adsDialog, setAdsDialog] = useState(false);
  const [restricted, setRestricted] = useState(() => trustService.myRestricted());
  const [hiddenCount, setHiddenCount] = useState(() => feedService.hiddenCount());

  useEffect(() => {
    const refresh = () => { setRestricted(trustService.myRestricted()); setHiddenCount(feedService.hiddenCount()); };
    refresh();
    const a = bus.on("trust:update", refresh);
    const b = bus.on("feed:updated", refresh);
    return () => { a(); b(); };
  }, []);

  async function unrestrict(pk: string, blocked: boolean) {
    await trustService.clear(pk);
    setRestricted(trustService.myRestricted());
    bus.emit("feed:updated", undefined);   // their posts can flow back into your feed
    toast(blocked ? "Unblocked" : "Unmuted", "success");
  }
  async function unhideAll() {
    await feedService.clearHidden();
    setHiddenCount(0);
    toast("Hidden posts restored", "success");
  }

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
        <Divider />
        {row("Filter adult content", "Blur explicit images (classified on-device with nsfwjs — the picture never leaves your device) and hide posts with explicit language behind a tap.",
          <Switch checked={settings.filterNsfw} onChange={(e) => { setSettings({ filterNsfw: e.target.checked }); toast(e.target.checked ? "Adult content will be filtered on this device" : "Adult-content filter off", "info"); }} />)}
        <Divider />
        {row("Censor cuss words", "Mask profanity inline (fuck → f**k) instead of hiding it. Works whether or not the filter above is on.",
          <Switch checked={settings.censorProfanity} onChange={(e) => setSettings({ censorProfanity: e.target.checked })} />)}
        <Divider />
        {row("Nostr posts", "Pull notes from the Nostr network (for the topics you follow) into your feed, shown as external 'NOSTR' users you can reply to and react to. Turn off to hide them.",
          <Switch checked={settings.nostrEnabled !== false} onChange={(e) => { setSettings({ nostrEnabled: e.target.checked }); if (e.target.checked) { nostrService.start().catch(() => {}); toast("Nostr posts on — streaming notes for your topics", "info"); } else { nostrService.stop(); toast("Nostr posts hidden", "info"); } }} />)}
        <Divider />
        {row("Auto-translate to English", "Automatically translate posts detected as another language into English, clearly labeled with a one-tap toggle back to the original. Off by default — you can still translate any post on demand from its text.",
          <Switch checked={settings.autoTranslate === true} onChange={(e) => { setSettings({ autoTranslate: e.target.checked }); toast(e.target.checked ? "Auto-translate on — non-English posts will translate to English" : "Auto-translate off", "info"); }} />)}
        <Divider />
        {row("Support with ads", "Ledger is free with no subscriptions — one small ad shows after every 10 posts (A-ADS: privacy-respecting, no tracking, no cookies). Leaving this on is how you keep the project free, at no cost to you.",
          <Switch checked={settings.showAds !== false} onChange={(e) => { if (e.target.checked) { setSettings({ showAds: true }); toast("Thanks for keeping Ledger free 💛", "success"); } else { setAdsDialog(true); } }} />)}
      </GlassCard>

      <GlassCard sx={{ mb: 2 }}>
        <Typography variant="overline" color="text.secondary">Blocked &amp; hidden</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 1.5 }}>
          People you block or mute are hidden from your feed; posts you hide are tucked away. It's all private and stays on this device.
        </Typography>
        {restricted.length === 0
          ? <Typography variant="caption" color="text.secondary">You haven't blocked or muted anyone.</Typography>
          : <Stack spacing={1}>
              {restricted.map((r) => {
                const blocked = r.kind === "block";
                return (
                  <Stack key={r.to} direction="row" alignItems="center" spacing={1}>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>{profileService.get(r.to)?.username ?? `id ${fingerprint(r.to)}`}</Typography>
                      <Typography variant="caption" color="text.secondary">{blocked ? "Blocked" : "Muted"}</Typography>
                    </Box>
                    <Button size="small" variant="outlined" onClick={() => unrestrict(r.to, blocked)}>{blocked ? "Unblock" : "Unmute"}</Button>
                  </Stack>
                );
              })}
            </Stack>}
        <Divider sx={{ my: 1.5 }} />
        {row(`Hidden posts (${hiddenCount})`, "Posts you hid with “Hide this post.” Bring them all back.",
          <Button size="small" variant="outlined" disabled={hiddenCount === 0} onClick={unhideAll}>Unhide all</Button>)}
      </GlassCard>

      <GlassCard sx={{ mb: 2 }}>
        <Typography variant="overline" color="text.secondary">AI companion</Typography>
        {row("Persona", "Your companion's voice & style.",
          <Select size="small" value={settings.companionPersona} onChange={(e) => setSettings({ companionPersona: e.target.value as CompanionPersona })}>{PERSONA.map((p) => <MenuItem key={p} value={p}>{p}</MenuItem>)}</Select>)}
        <Divider />
        {row("On-device LLM (WebGPU)", "On by default — a real local model (WebLLM) downloads automatically on WebGPU devices, fully private. Turn off to force the fast heuristic engine.",
          <Switch checked={settings.useWebLLM} onChange={(e) => { setSettings({ useWebLLM: e.target.checked, llmOptOut: !e.target.checked }); toast(e.target.checked ? "Local model will download now" : "Using the fast local engine", "info"); }} />)}
      </GlassCard>

      <GlassCard sx={{ mb: 2 }}>
        <Typography variant="overline" color="text.secondary">Presence & motion</Typography>
        {row("Status", "What others on the network see.",
          <Select size="small" value={settings.presenceStatus} onChange={(e) => setSettings({ presenceStatus: e.target.value as PresenceStatus })}>{STATUS.map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}</Select>)}
        <Divider />
        <FormControlLabel control={<Switch checked={settings.reducedMotion} onChange={(e) => setSettings({ reducedMotion: e.target.checked })} />} label="Reduce motion (calms the animated background)" sx={{ mt: 1 }} />
        <Divider />
        {row("Pre-load PolitiFact index", "\"Fact-check this\" is always available from a post's ⋯ menu — it's a purely local keyword match against PolitiFact's recent ratings (no AI, nothing sent anywhere). Keep this on to pre-load that index at launch so the first check is instant; off still works, it just loads on first use.",
          <Switch checked={settings.showFactChecks} onChange={(e) => { setSettings({ showFactChecks: e.target.checked }); if (e.target.checked) factCheckService.refresh().catch(() => {}); }} />)}
      </GlassCard>

      <GlassCard sx={{ mb: 2 }}>
        <Typography variant="overline" color="text.secondary">Account & devices</Typography>
        {row("Install on your phone", "Add Ledger to your home screen — opens full-screen like a native app and works offline. Scan a QR to jump to it on your phone, with iOS & Android steps.",
          <Button variant="outlined" startIcon={<InstallMobileRoundedIcon />} onClick={() => setInstall(true)}>Download on phone</Button>)}
        <Divider />
        {row("Log in on another device", "Show a QR / link that copies your whole account to another device — peer-to-peer, nothing on a server.",
          <Button variant="outlined" startIcon={<QrCode2RoundedIcon />} onClick={() => setDeviceLogin(true)}>Log in on another device</Button>)}
        <Divider />
        {row("Download profile data", "Save your full account (keys, avatar, bio, custom page) as a file you can import on another device.",
          <Button variant="outlined" startIcon={<DownloadRoundedIcon />} onClick={() => { identityService.exportFile(); toast("Profile data downloaded", "success"); }}>Download profile data</Button>)}
        <DeviceLoginDialog open={deviceLogin} onClose={() => setDeviceLogin(false)} />
        <InstallHelpDialog open={install} onClose={() => setInstall(false)} />
      </GlassCard>

      <GlassCard>
        <Typography variant="overline" color="text.secondary">Data</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          Everything lives in this browser (IndexedDB + localStorage). Clearing site data wipes your local copy — download your profile data first (above).
        </Typography>
        <Button color="error" variant="outlined" sx={{ mt: 1.5 }} onClick={() => { if (confirm("Reset Ledger on this device? This clears local data. Export your identity first!")) { indexedDB.deleteDatabase("nebula"); localStorage.clear(); location.reload(); } }}>
          Reset this device
        </Button>
      </GlassCard>

      {/* Confirm before turning ads off — the only thing that keeps Ledger free. */}
      <Dialog open={adsDialog} onClose={() => setAdsDialog(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Turn off ads?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            Ledger is <b>free, open-source, and has no subscriptions</b> — the occasional ad in your feed (from A-ADS, which doesn't track you) is the only thing that keeps it running.
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
            Turning them off is completely your call, but it does mean you're choosing not to support the project this way. You can turn them back on anytime, or help out in other ways.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ flexWrap: "wrap", gap: 1, px: 3, pb: 2 }}>
          <Button component="a" href={`${import.meta.env.BASE_URL}support.html`} target="_blank" rel="noopener noreferrer" color="inherit">Other ways to help</Button>
          <Box sx={{ flex: 1 }} />
          <Button color="inherit" onClick={() => { setSettings({ showAds: false }); setAdsDialog(false); toast("Ads turned off", "info"); }}>Turn off anyway</Button>
          <Button variant="contained" onClick={() => setAdsDialog(false)}>Keep ads on</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
