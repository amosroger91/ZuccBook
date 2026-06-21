import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Box, Stack, Typography, TextField, Button, Chip, LinearProgress, Grid, Tooltip, Divider } from "@mui/material";
import DownloadRoundedIcon from "@mui/icons-material/DownloadRounded";
import MyLocationRoundedIcon from "@mui/icons-material/MyLocationRounded";
import GlassCard from "@/components/common/GlassCard";
import { identityService } from "@/services/identityService";
import { reputationService, BADGES } from "@/services/reputationService";
import { communityService } from "@/services/communityService";
import { profileService } from "@/services/profileService";
import { useStore } from "@/store/useStore";
import UserAvatar from "@/components/common/UserAvatar";
import { compressAvatar, compressBanner } from "@/lib/image";
import { fingerprint } from "@/lib/crypto";
import { bus, toast } from "@/lib/events";
import type { Profile } from "@/types";

/* ---- sandboxed custom HTML (MySpace style), isolated in a shadow root ---- */
function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script, object, embed, link, meta, base").forEach((n) => n.remove());
  doc.querySelectorAll("*").forEach((el) => {
    [...el.attributes].forEach((a) => {
      const n = a.name.toLowerCase();
      if (n.startsWith("on")) el.removeAttribute(a.name);
      if ((n === "href" || n === "src" || n === "xlink:href") && /^\s*javascript:/i.test(a.value)) el.removeAttribute(a.name);
    });
  });
  return doc.body.innerHTML;
}
function CustomHtml({ html }: { html: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = ref.current; if (!host) return;
    const sh = host.shadowRoot || host.attachShadow({ mode: "open" });
    sh.innerHTML = `<div style="color:#1b2733;font-family:Tahoma,system-ui,sans-serif;line-height:1.5">${sanitizeHtml(html)}</div>`;
  }, [html]);
  return <div ref={ref} />;
}

async function detectLocation(): Promise<string> {
  const pos = await new Promise<GeolocationPosition>((res, rej) => {
    if (!navigator.geolocation) return rej(new Error("no geolocation"));
    navigator.geolocation.getCurrentPosition(res, rej, { timeout: 10000 });
  });
  const { latitude, longitude } = pos.coords;
  try {
    const r = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=en`);
    const j = await r.json();
    return [j.city || j.locality, j.principalSubdivision, j.countryCode].filter(Boolean).join(", ") || `${latitude.toFixed(2)}, ${longitude.toFixed(2)}`;
  } catch { return `${latitude.toFixed(2)}, ${longitude.toFixed(2)}`; }
}

function Banner({ header, color }: { header?: string; color: string }) {
  return <Box sx={{ height: 160, borderRadius: 1, mb: -6, backgroundImage: header ? `url(${header})` : `linear-gradient(135deg, ${color}, #1668e0)`, backgroundSize: "cover", backgroundPosition: "center", border: "1px solid var(--bl-line)" }} />;
}

export default function ProfileView() {
  const { pk: routePk } = useParams();
  const me = useStore((s) => s.me);
  const refreshMe = useStore((s) => s.refreshMe);
  const own = !routePk || routePk === me?.publicKey;

  if (own) return <OwnProfile me={me} refreshMe={refreshMe} />;
  return <ViewProfile pk={routePk!} />;
}

/* ============================ viewing someone else ============================ */
function ViewProfile({ pk }: { pk: string }) {
  const [profile, setProfile] = useState<Profile | null>(profileService.get(pk));
  useEffect(() => {
    setProfile(profileService.get(pk));
    const off = bus.on("profile:update", (p) => { if (p.pk === pk) setProfile(p); });
    return off;
  }, [pk]);

  if (!profile) return (
    <Box sx={{ maxWidth: 720, mx: "auto" }}>
      <GlassCard><Typography color="text.secondary">This profile hasn't synced to you yet — it arrives over the network when the person is (or was recently) online. Check back in a moment.</Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1, fontFamily: "monospace" }}>id {fingerprint(pk)}</Typography></GlassCard>
    </Box>
  );

  return (
    <Box sx={{ maxWidth: 720, mx: "auto" }}>
      <GlassCard sx={{ mb: 2 }}>
        <Banner header={profile.header} color="#3f97ff" />
        <Stack direction="row" spacing={2} alignItems="flex-end" sx={{ px: 1 }}>
          <UserAvatar pk={profile.pk} name={profile.username} avatar={profile.avatar} size={80} />
          <Box sx={{ pb: 1 }}>
            <Typography variant="h5">{profile.username}</Typography>
            {profile.location && <Typography variant="caption" color="text.secondary">📍 {profile.location}</Typography>}
          </Box>
        </Stack>
        {profile.bio && <Typography sx={{ mt: 1 }}>{profile.bio}</Typography>}
        <Stack direction="row" spacing={2} sx={{ mt: 1 }}>
          <Typography variant="body2"><b>{profile.reputation}</b> reputation</Typography>
          <Typography variant="body2"><b>{reputationService.rank(profile.reputation)}</b></Typography>
        </Stack>
        {profile.badges?.length > 0 && <Stack direction="row" sx={{ mt: 1, flexWrap: "wrap", gap: 0.5 }}>{profile.badges.map((b) => <Chip key={b} size="small" label={`${BADGES[b]?.icon ?? "🏅"} ${BADGES[b]?.label ?? b}`} />)}</Stack>}
        {profile.communities?.length > 0 && (
          <Box sx={{ mt: 1.5 }}>
            <Typography variant="overline" color="text.secondary">Communities</Typography>
            <Stack direction="row" sx={{ flexWrap: "wrap", gap: 0.5, mt: 0.5 }}>{profile.communities.map((c) => <Chip key={c} size="small" variant="outlined" label={c} />)}</Stack>
          </Box>
        )}
      </GlassCard>
      {profile.html && <GlassCard><Typography variant="overline" color="text.secondary">Their page</Typography><Box sx={{ mt: 1 }}><CustomHtml html={profile.html} /></Box></GlassCard>}
    </Box>
  );
}

/* ============================ your own profile ============================ */
function OwnProfile({ me, refreshMe }: { me: any; refreshMe: () => void }) {
  const [username, setUsername] = useState(me?.username ?? "");
  const [bio, setBio] = useState(me?.bio ?? "");
  const [html, setHtml] = useState(me?.html ?? "");
  const [rep, setRep] = useState(0);
  const [breakdown, setBreakdown] = useState<Record<string, number>>({});
  const [communities, setCommunities] = useState<string[]>([]);
  const [locating, setLocating] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const avatarRef = useRef<HTMLInputElement>(null);
  const headerRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    reputationService.total().then(setRep);
    reputationService.breakdown().then(setBreakdown);
    communityService.list().then((cs) => setCommunities(cs.filter((c) => c.members.includes(me?.publicKey)).map((c) => c.name)));
  }, [me?.publicKey]);

  const sync = () => { refreshMe(); profileService.publishSelf(); };
  async function save() { await identityService.update({ username: username.trim() || me.username, bio, html }); sync(); toast("Profile saved & shared", "success"); }
  async function setPhoto(file?: File) { if (!file) return; try { await identityService.update({ avatar: await compressAvatar(file) }); sync(); toast("Photo updated", "success"); } catch { toast("Couldn't load that image", "error"); } }
  async function setHeader(file?: File) { if (!file) return; try { await identityService.update({ header: await compressBanner(file) }); sync(); toast("Header updated", "success"); } catch { toast("Couldn't load that image", "error"); } }
  async function importId(file?: File) { if (!file) return; try { await identityService.importFile(file); refreshMe(); toast("Identity replaced on this device", "success"); } catch { toast("Invalid identity file", "error"); } }
  async function useLocation() {
    setLocating(true);
    try { const loc = await detectLocation(); await identityService.update({ location: loc }); sync(); toast(`Location set: ${loc}`, "success"); }
    catch { toast("Couldn't get your location (permission denied?)", "warn"); }
    finally { setLocating(false); }
  }
  async function clearLocation() { await identityService.update({ location: "" }); sync(); }

  const rank = reputationService.rank(rep);
  const next = reputationService.nextRank(rep);
  const badges = me?.badges ?? [];

  return (
    <Box sx={{ maxWidth: 880, mx: "auto" }}>
      <GlassCard sx={{ mb: 2 }}>
        <Box sx={{ position: "relative" }}>
          <Banner header={me?.header} color="#3f97ff" />
          <Button size="small" onClick={() => headerRef.current?.click()} sx={{ position: "absolute", right: 8, top: 8 }}>Change header</Button>
          <input ref={headerRef} type="file" accept="image/*" hidden onChange={(e) => setHeader(e.target.files?.[0])} />
        </Box>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems={{ sm: "flex-end" }} sx={{ px: 1 }}>
          <Box sx={{ position: "relative", cursor: "pointer", width: 80, height: 80 }} onClick={() => avatarRef.current?.click()} title="Change photo">
            <UserAvatar pk={me?.publicKey ?? ""} name={me?.username ?? "?"} avatar={me?.avatar} size={80} />
            <Box sx={{ position: "absolute", inset: 0, borderRadius: "50%", display: "grid", placeItems: "center", fontSize: 12, fontWeight: 700, color: "#fff", background: "rgba(0,0,0,0.5)", opacity: 0, transition: "opacity .2s", "&:hover": { opacity: 1 } }}>Change</Box>
          </Box>
          <input ref={avatarRef} type="file" accept="image/*" hidden onChange={(e) => setPhoto(e.target.files?.[0])} />
          <Box sx={{ flex: 1, pb: 1 }}>
            <Stack direction="row" spacing={1} alignItems="center"><Typography variant="h5">{me?.username}</Typography><Chip size="small" label={rank} sx={{ background: "linear-gradient(135deg,#3f97ff,#1668e0)", color: "#fff", fontWeight: 700 }} /></Stack>
            <Tooltip title={me?.publicKey ?? ""}><Typography variant="caption" color="text.secondary" sx={{ fontFamily: "monospace" }}>id {fingerprint(me?.publicKey ?? "")}</Typography></Tooltip>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5 }}>
              <Typography variant="body2">📍 {me?.location || "no location"}</Typography>
              <Button size="small" startIcon={<MyLocationRoundedIcon />} disabled={locating} onClick={useLocation}>{locating ? "Locating…" : "Use my location"}</Button>
              {me?.location && <Button size="small" color="inherit" onClick={clearLocation}>Clear</Button>}
            </Stack>
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
              <TextField label="Custom profile HTML (MySpace style)" value={html} onChange={(e) => setHtml(e.target.value)} fullWidth multiline minRows={6}
                placeholder={'<h2>Welcome to my page ✨</h2>\n<style>h2{color:hotpink}</style>\n<marquee>under construction</marquee>'}
                InputProps={{ sx: { fontFamily: "monospace", fontSize: 13 } }} />
              <Typography variant="caption" color="text.secondary">Your HTML/CSS renders in an isolated sandbox on your page (scripts are stripped for safety). Others see it when they visit you.</Typography>
              <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
                <Button variant="contained" onClick={save}>Save & share</Button>
                <Button variant="outlined" startIcon={<DownloadRoundedIcon />} onClick={() => identityService.exportFile()}>Export identity</Button>
                <Button variant="text" onClick={() => fileRef.current?.click()}>Import</Button>
                <input ref={fileRef} type="file" accept="application/json" hidden onChange={(e) => importId(e.target.files?.[0])} />
              </Stack>
            </Stack>
          </GlassCard>
          {html && <GlassCard sx={{ mt: 2 }}><Typography variant="overline" color="text.secondary">Live preview</Typography><Box sx={{ mt: 1 }}><CustomHtml html={html} /></Box></GlassCard>}
        </Grid>
        <Grid item xs={12} md={5}>
          <GlassCard sx={{ mb: 2 }}>
            <Typography variant="overline" color="text.secondary">Communities</Typography>
            <Stack direction="row" sx={{ mt: 1, flexWrap: "wrap", gap: 0.5 }}>
              {communities.map((c) => <Chip key={c} size="small" variant="outlined" label={c} />)}
              {communities.length === 0 && <Typography variant="caption" color="text.secondary">Join communities and they'll show here.</Typography>}
            </Stack>
          </GlassCard>
          <GlassCard sx={{ mb: 2 }}>
            <Typography variant="overline" color="text.secondary">Reputation</Typography>
            {next && <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>{next.remaining} to {next.name}</Typography>}
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
              {badges.map((b: string) => <Tooltip key={b} title={BADGES[b]?.description ?? b}><Chip label={`${BADGES[b]?.icon ?? "🏅"} ${BADGES[b]?.label ?? b}`} /></Tooltip>)}
              {badges.length === 0 && <Typography variant="caption" color="text.secondary">Earn badges by participating.</Typography>}
            </Stack>
          </GlassCard>
        </Grid>
      </Grid>
    </Box>
  );
}
