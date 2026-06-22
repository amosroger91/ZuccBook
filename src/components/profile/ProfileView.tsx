import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Box, Stack, Typography, TextField, Button, Chip, LinearProgress, Grid, Tooltip } from "@mui/material";
import DownloadRoundedIcon from "@mui/icons-material/DownloadRounded";
import QrCode2RoundedIcon from "@mui/icons-material/QrCode2Rounded";
import DeviceLoginDialog from "./DeviceLoginDialog";
import MyLocationRoundedIcon from "@mui/icons-material/MyLocationRounded";
import LanguageRoundedIcon from "@mui/icons-material/LanguageRounded";
import EmailRoundedIcon from "@mui/icons-material/EmailRounded";
import PhoneRoundedIcon from "@mui/icons-material/PhoneRounded";
import VisibilityRoundedIcon from "@mui/icons-material/VisibilityRounded";
import EditRoundedIcon from "@mui/icons-material/EditRounded";
import GlassCard from "@/components/common/GlassCard";
import { identityService } from "@/services/identityService";
import { reputationService, BADGES } from "@/services/reputationService";
import { communityService } from "@/services/communityService";
import { profileService } from "@/services/profileService";
import { nostrService } from "@/services/nostrService";
import { relayService } from "@/services/relayService";
import { useStore } from "@/store/useStore";
import UserAvatar from "@/components/common/UserAvatar";
import { compressAvatar, compressBanner } from "@/lib/image";
import { fingerprint } from "@/lib/crypto";
import { bus, toast } from "@/lib/events";
import type { Profile } from "@/types";

// New profiles start from this editable template — it shows off full control:
// the whole page background, fonts, layout, even animation, are yours to change.
export const STARTER_HTML = `<style>
  body {
    margin: 0;
    min-height: 100%;
    font-family: 'Trebuchet MS', Tahoma, system-ui, sans-serif;
    color: #f3f7ff;
    background: radial-gradient(120% 120% at 20% 0%, #3f97ff 0%, #1668e0 38%, #0a1f4d 100%);
  }
  .wrap { max-width: 560px; margin: 28px auto; padding: 22px; }
  .card {
    padding: 20px 22px; border-radius: 18px;
    background: rgba(255,255,255,0.10); border: 1px solid rgba(255,255,255,0.22);
    box-shadow: 0 12px 40px rgba(0,0,0,0.35); backdrop-filter: blur(8px);
  }
  h1 { margin: 0 0 8px; font-size: 26px; }
  a { color: #bcdcff; }
  .tags { margin-top: 12px; }
  .tag { display:inline-block; padding:4px 12px; margin:3px; border-radius:999px;
         background: rgba(255,255,255,0.16); font-size: 12px; }
  marquee { margin-top: 14px; opacity: .85; }
</style>
<div class="wrap">
  <div class="card">
    <h1>✦ welcome to my corner ✦</h1>
    <p>This whole page is <b>mine</b> — I changed the background, the fonts, the layout… everything.
       Edit the HTML &amp; CSS to make it yours (old-school MySpace style).</p>
    <div class="tags">
      <span class="tag">music</span><span class="tag">coding</span><span class="tag">coffee</span>
    </div>
    <marquee>★ thanks for stopping by ★</marquee>
  </div>
</div>`;

// Minimal blank canvas so the user's HTML/CSS controls everything (incl. the
// page background). No app styling is forced in. Same-origin is intentionally
// withheld, so even scripts in a peer's profile can't touch your account/keys.
function profileHtmlDoc(html: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0}img,iframe,video,canvas,svg{max-width:100%}</style></head><body>${html}</body></html>`;
}
function CustomHtml({ html }: { html: string }) {
  const [tall, setTall] = useState(false);
  return (
    <Box sx={{ position: "relative", borderRadius: 2, overflow: "hidden", border: "1px solid var(--bl-line)", bgcolor: "#fff" }}>
      <Box component="iframe" title="profile page" srcDoc={profileHtmlDoc(html)}
        sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-modals allow-presentation"
        sx={{ width: "100%", height: tall ? 1100 : 560, border: 0, display: "block" }} />
      <Button size="small" onClick={() => setTall((v) => !v)}
        sx={{ position: "absolute", bottom: 8, right: 8, minWidth: 0, px: 1, py: 0.25, fontSize: 11, textTransform: "none", bgcolor: "rgba(255,255,255,0.92)", border: "1px solid var(--bl-line)", color: "text.secondary", "&:hover": { bgcolor: "#fff" } }}>
        {tall ? "Collapse" : "Expand"}
      </Button>
    </Box>
  );
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

const normUrl = (u: string) => (/^https?:\/\//i.test(u) ? u : `https://${u}`);

function Banner({ header, color = "#3f97ff" }: { header?: string; color?: string }) {
  return <Box sx={{ height: 160, borderRadius: 1, mb: -6, backgroundImage: header ? `url(${header})` : `linear-gradient(135deg, ${color}, #1668e0)`, backgroundSize: "cover", backgroundPosition: "center", border: "1px solid var(--bl-line)" }} />;
}

function StatTile({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Box sx={{ flex: 1, textAlign: "center", py: 1, borderRadius: 2, bgcolor: "rgba(58,155,240,0.07)", border: "1px solid rgba(58,155,240,0.14)" }}>
      <Typography sx={{ fontWeight: 800, fontSize: 18, lineHeight: 1.1, color: "#1668e0" }}>{value}</Typography>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
    </Box>
  );
}

/* ============ shared presentation (visitor view, your default view & preview) ============ */
function ProfileDisplay({ profile, own, onEdit }: { profile: Profile; own?: boolean; onEdit?: () => void }) {
  const nav = useNavigate();
  const rank = reputationService.rank(profile.reputation);
  // Network-contribution points, earned by running a Ledger Node (from the relay).
  const [netPoints, setNetPoints] = useState<number | null>(null);
  useEffect(() => {
    let ok = true;
    relayService.points(profile.pk).then((c) => { if (ok) setNetPoints(c?.points ?? 0); });
    return () => { ok = false; };
  }, [profile.pk]);
  return (
    <Box sx={{ maxWidth: 760, mx: "auto" }}>
      <GlassCard sx={{ p: 0, overflow: "hidden", mb: 2 }}>
        {/* hero */}
        <Box sx={{ position: "relative", height: 200, backgroundImage: profile.header ? `url(${profile.header})` : "linear-gradient(135deg,#3f97ff,#1668e0,#0a2a6b)", backgroundSize: "cover", backgroundPosition: "center" }}>
          <Box sx={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(0,0,0,0) 55%, rgba(0,0,0,0.28))" }} />
          {own && onEdit && (
            <Button size="small" startIcon={<EditRoundedIcon />} onClick={onEdit}
              sx={{ position: "absolute", top: 12, right: 12, textTransform: "none", fontWeight: 700, bgcolor: "rgba(255,255,255,0.92)", color: "#1668e0", boxShadow: 2, "&:hover": { bgcolor: "#fff" } }}>
              Edit profile
            </Button>
          )}
        </Box>

        <Box sx={{ px: { xs: 2, sm: 3 }, pb: 2.5 }}>
          {/* avatar overlapping the hero */}
          <Box sx={{ mt: "-58px", mb: 1 }}>
            <Box sx={{ display: "inline-flex", borderRadius: "50%", border: "4px solid var(--bl-face)", boxShadow: "0 6px 20px rgba(0,0,0,0.25)" }}>
              <UserAvatar pk={profile.pk} name={profile.username} avatar={profile.avatar} size={104} />
            </Box>
          </Box>

          <Stack direction="row" alignItems="center" spacing={1} sx={{ flexWrap: "wrap" }}>
            <Typography variant="h4" sx={{ fontWeight: 800, lineHeight: 1.1 }}>{profile.username}</Typography>
            <Chip size="small" label={rank} sx={{ background: "linear-gradient(135deg,#3f97ff,#1668e0)", color: "#fff", fontWeight: 700 }} />
          </Stack>
          {profile.quote && <Typography sx={{ mt: 0.5, fontStyle: "italic", color: "text.secondary" }}>“{profile.quote}”</Typography>}
          {profile.location && <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>📍 {profile.location}</Typography>}
          {profile.bio && <Typography sx={{ mt: 1.25, lineHeight: 1.6 }}>{profile.bio}</Typography>}

          {(profile.website || profile.email || profile.phone) && (
            <Stack direction="row" spacing={1} sx={{ mt: 1.25, flexWrap: "wrap", gap: 0.5 }}>
              {profile.website && <Chip size="small" icon={<LanguageRoundedIcon />} label={profile.website.replace(/^https?:\/\//, "")} component="a" clickable href={normUrl(profile.website)} target="_blank" rel="noopener noreferrer" />}
              {profile.email && <Chip size="small" icon={<EmailRoundedIcon />} label={profile.email} component="a" clickable href={`mailto:${profile.email}`} />}
              {profile.phone && <Chip size="small" icon={<PhoneRoundedIcon />} label={profile.phone} component="a" clickable href={`tel:${profile.phone}`} />}
            </Stack>
          )}

          <Stack direction="row" spacing={1.5} sx={{ mt: 2 }}>
            <StatTile label="Reputation" value={profile.reputation} />
            <StatTile label="Rank" value={<span style={{ fontSize: 13 }}>{rank}</span>} />
            <StatTile label="Groups" value={profile.communities?.length ?? 0} />
            <StatTile label="Network pts" value={netPoints === null ? "…" : netPoints} />
          </Stack>

          {!own && profile.walletAddress && (
            <Button fullWidth variant="contained" sx={{ mt: 1.5 }} onClick={() => nav("/wallet", { state: { to: profile.walletAddress } })}>💸 Pay {profile.username}</Button>
          )}

          {profile.badges?.length > 0 && (
            <Box sx={{ mt: 2 }}>
              <Typography variant="overline" color="text.secondary">Badges</Typography>
              <Stack direction="row" sx={{ flexWrap: "wrap", gap: 0.5, mt: 0.5 }}>{profile.badges.map((b) => <Chip key={b} size="small" label={`${BADGES[b]?.icon ?? "🏅"} ${BADGES[b]?.label ?? b}`} />)}</Stack>
            </Box>
          )}
          {profile.communities?.length > 0 && (
            <Box sx={{ mt: 1.5 }}>
              <Typography variant="overline" color="text.secondary">Groups</Typography>
              <Stack direction="row" sx={{ flexWrap: "wrap", gap: 0.5, mt: 0.5 }}>{profile.communities.map((c) => <Chip key={c} size="small" variant="outlined" label={c} />)}</Stack>
            </Box>
          )}
        </Box>
      </GlassCard>

      {/* the fully-custom MySpace canvas */}
      {profile.html && (
        <GlassCard sx={{ p: { xs: 1, sm: 1.25 } }}>
          <Typography variant="overline" color="text.secondary" sx={{ px: 0.5 }}>✦ {profile.username}'s space</Typography>
          <Box sx={{ mt: 0.5 }}><CustomHtml html={profile.html} /></Box>
        </GlassCard>
      )}
    </Box>
  );
}

export default function ProfileView() {
  const { pk: routePk } = useParams();
  const me = useStore((s) => s.me);
  const refreshMe = useStore((s) => s.refreshMe);
  if (!routePk || routePk === me?.publicKey) return <OwnProfile me={me} refreshMe={refreshMe} />;
  if (routePk.startsWith("nostr:")) return <NostrProfile pk={routePk} />;
  return <ViewProfile pk={routePk} />;
}

/* ============================ external Nostr user ============================ */
function NostrProfile({ pk }: { pk: string }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  useEffect(() => {
    nostrService.profile(pk).then(setProfile);
    const off = bus.on("profile:update", (p) => { if (p.pk === pk) setProfile(p); });
    return off;
  }, [pk]);
  const npub = nostrService.npubFor(pk);
  return (
    <>
      <Box sx={{ maxWidth: 760, mx: "auto", mb: 1.5 }}>
        <GlassCard sx={{ background: "rgba(138,43,226,0.08)", borderColor: "rgba(138,43,226,0.28)" }}>
          <Stack direction="row" spacing={1.25} alignItems="flex-start">
            <Box sx={{ fontSize: 22, lineHeight: 1 }}>🟣</Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography sx={{ fontWeight: 800 }}>External Nostr user</Typography>
              <Typography variant="body2" color="text.secondary">
                They still need to sign up for Ledger — this profile is mirrored from the Nostr network. You can still reply &amp; react, and it reaches them on Nostr.
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.75, fontFamily: "monospace", wordBreak: "break-all" }}>{npub}</Typography>
            </Box>
          </Stack>
        </GlassCard>
      </Box>
      {profile && <ProfileDisplay profile={profile} />}
    </>
  );
}

/* ============================ viewing someone else ============================ */
function ViewProfile({ pk }: { pk: string }) {
  const [profile, setProfile] = useState<Profile | null>(profileService.get(pk));
  const [snapshot, setSnapshot] = useState<Profile | null>(null);
  useEffect(() => {
    const cached = profileService.get(pk);
    setProfile(cached);
    setSnapshot(null);
    const off = bus.on("profile:update", (p) => { if (p.pk === pk) setProfile(p); });
    // No full profile cached yet → reconstruct a snapshot from their posts so
    // the page still works; the real one fills in if/when it syncs.
    if (!cached) profileService.snapshot(pk).then(setSnapshot);
    return off;
  }, [pk]);

  const shown = profile ?? snapshot;
  if (!shown) return (
    <Box sx={{ maxWidth: 720, mx: "auto" }}>
      <GlassCard><Typography color="text.secondary">We haven't seen anything from this person yet — their profile and posts arrive over the network when they're (or were recently) online.</Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1, fontFamily: "monospace" }}>id {fingerprint(pk)}</Typography></GlassCard>
    </Box>
  );
  return (
    <>
      {!profile && (
        <Box sx={{ maxWidth: 720, mx: "auto", mb: 1.5 }}>
          <GlassCard sx={{ background: "rgba(58,155,240,0.08)", borderColor: "rgba(58,155,240,0.24)" }}>
            <Typography variant="body2" color="text.secondary">
              📷 Showing a snapshot built from their posts — their full profile (bio, links, custom page) fills in automatically the next time they're online.
            </Typography>
          </GlassCard>
        </Box>
      )}
      <ProfileDisplay profile={shown} />
    </>
  );
}

/* ============================ your own profile ============================ */
function OwnProfile({ me, refreshMe }: { me: any; refreshMe: () => void }) {
  const [username, setUsername] = useState(me?.username ?? "");
  const [bio, setBio] = useState(me?.bio ?? "");
  const [quote, setQuote] = useState(me?.quote ?? "");
  const [website, setWebsite] = useState(me?.website ?? "");
  const [email, setEmail] = useState(me?.email ?? "");
  const [phone, setPhone] = useState(me?.phone ?? "");
  const [html, setHtml] = useState(me?.html ?? STARTER_HTML);
  const [rep, setRep] = useState(0);
  const [breakdown, setBreakdown] = useState<Record<string, number>>({});
  const [communities, setCommunities] = useState<string[]>([]);
  const [locating, setLocating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [view, setView] = useState<Profile | null>(null);
  const [deviceLogin, setDeviceLogin] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const avatarRef = useRef<HTMLInputElement>(null);
  const headerRef = useRef<HTMLInputElement>(null);

  const buildView = async () => { const v = await profileService.buildSelf(); setView({ ...v, html: v.html || html || STARTER_HTML }); };
  useEffect(() => {
    reputationService.total().then(setRep);
    reputationService.breakdown().then(setBreakdown);
    communityService.list().then((cs) => setCommunities(cs.filter((c) => c.members.includes(me?.publicKey)).map((c) => c.name)));
    buildView();
  }, [me?.publicKey]);

  const sync = async () => { refreshMe(); await buildView(); profileService.publishSelf(); };
  async function save() {
    await identityService.update({ username: username.trim() || me.username, bio, quote, website: website.trim(), email: email.trim(), phone: phone.trim(), html });
    await sync(); toast("Profile saved & shared", "success"); setEditing(false);
  }
  async function setPhoto(file?: File) { if (!file) return; try { await identityService.update({ avatar: await compressAvatar(file) }); await sync(); toast("Photo updated", "success"); } catch { toast("Couldn't load that image", "error"); } }
  async function setHeader(file?: File) { if (!file) return; try { await identityService.update({ header: await compressBanner(file) }); await sync(); toast("Header updated", "success"); } catch { toast("Couldn't load that image", "error"); } }
  async function importId(file?: File) { if (!file) return; try { await identityService.importFile(file); refreshMe(); toast("Identity replaced on this device", "success"); } catch { toast("Invalid identity file", "error"); } }
  async function useLocation() {
    setLocating(true);
    try { const loc = await detectLocation(); await identityService.update({ location: loc }); await sync(); toast(`Location set: ${loc}`, "success"); }
    catch { toast("Couldn't get your location (permission denied?)", "warn"); }
    finally { setLocating(false); }
  }

  const rank = reputationService.rank(rep);
  const next = reputationService.nextRank(rep);
  const badges = me?.badges ?? [];

  // Default view: exactly how visitors see you, with an Edit button.
  if (!editing) {
    return view
      ? <ProfileDisplay profile={view} own onEdit={() => setEditing(true)} />
      : <Box sx={{ maxWidth: 760, mx: "auto" }}><GlassCard><LinearProgress /></GlassCard></Box>;
  }

  return (
    <Box sx={{ maxWidth: 880, mx: "auto" }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
        <Chip icon={<EditRoundedIcon />} label="Editing your profile" color="primary" sx={{ flex: 1, justifyContent: "flex-start" }} />
        <Button startIcon={<VisibilityRoundedIcon />} onClick={() => setEditing(false)}>View profile</Button>
      </Stack>
      <GlassCard sx={{ mb: 2 }}>
        <Box sx={{ position: "relative" }}>
          <Banner header={me?.header} />
          <Stack direction="row" spacing={1} sx={{ position: "absolute", right: 8, top: 8 }}>
            <Button size="small" variant="contained" onClick={() => headerRef.current?.click()}>Change header</Button>
          </Stack>
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
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5, flexWrap: "wrap" }}>
              <Typography variant="body2">📍 {me?.location || "no location"}</Typography>
              <Button size="small" startIcon={<MyLocationRoundedIcon />} disabled={locating} onClick={useLocation}>{locating ? "Locating…" : "Use my location"}</Button>
              {me?.location && <Button size="small" color="inherit" onClick={async () => { await identityService.update({ location: "" }); sync(); }}>Clear</Button>}
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
              <TextField label="Quote / tagline" value={quote} onChange={(e) => setQuote(e.target.value)} fullWidth placeholder="a line that's very you" />
              <TextField label="Bio" value={bio} onChange={(e) => setBio(e.target.value)} fullWidth multiline minRows={2} />
              <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                <TextField label="Website" value={website} onChange={(e) => setWebsite(e.target.value)} fullWidth placeholder="example.com" />
                <TextField label="Email (optional)" value={email} onChange={(e) => setEmail(e.target.value)} fullWidth />
              </Stack>
              <TextField label="Phone (optional)" value={phone} onChange={(e) => setPhone(e.target.value)} fullWidth sx={{ maxWidth: { sm: "50%" } }} />
              <TextField label="Your page — full HTML &amp; CSS (MySpace style)" value={html} onChange={(e) => setHtml(e.target.value)} fullWidth multiline minRows={10}
                InputProps={{ sx: { fontFamily: "monospace", fontSize: 13 } }} />
              <Typography variant="caption" color="text.secondary">This is <b>your</b> canvas — change <b>everything</b>: the background, fonts, colors, layout, even animations and scripts. It renders in a secure sandbox (it can't touch anyone's account or keys), so go wild. Hit <b>Save &amp; view</b> to see it live.</Typography>
              <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
                <Button variant="contained" onClick={save}>Save &amp; view</Button>
                <Button variant="text" onClick={() => setHtml(STARTER_HTML)}>Reset HTML</Button>
                <Button variant="outlined" startIcon={<QrCode2RoundedIcon />} onClick={() => setDeviceLogin(true)}>Log in on another device</Button>
                <Button variant="outlined" startIcon={<DownloadRoundedIcon />} onClick={() => { identityService.exportFile(); toast("Profile data downloaded", "success"); }}>Download profile data</Button>
                <Button variant="text" onClick={() => fileRef.current?.click()}>Import</Button>
                <input ref={fileRef} type="file" accept="application/json" hidden onChange={(e) => importId(e.target.files?.[0])} />
              </Stack>
              <DeviceLoginDialog open={deviceLogin} onClose={() => setDeviceLogin(false)} />
            </Stack>
          </GlassCard>
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
