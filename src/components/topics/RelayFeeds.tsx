import { useEffect, useState } from "react";
import { Box, Stack, Typography, TextField, Select, MenuItem, Button, Chip } from "@mui/material";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import PublicRoundedIcon from "@mui/icons-material/PublicRounded";
import GlassCard from "@/components/common/GlassCard";
import { relayService, type NetworkFeed } from "@/services/relayService";
import { toast } from "@/lib/events";

// Anything can be a feed. Each source maps to a relay /api/feeds payload.
const SOURCES = [
  { id: "rss", label: "Any RSS / Atom URL", ph: "https://example.com/feed.xml", topic: "news" },
  { id: "youtube", label: "YouTube channel ID", ph: "UCxxxxxxxxxxxxxxxxxxxxxx", topic: "youtube" },
  { id: "reddit", label: "Subreddit", ph: "overlanding  (or r/overlanding)", topic: "reddit" },
  { id: "twitch", label: "Twitch streamer (via RSSHub)", ph: "shroud", topic: "live" },
  { id: "rsshub", label: "Any RSSHub route", ph: "/instagram/user/natgeo", topic: "social" },
];

/** "Network feeds" — the shared, relay-powered RSS list. Adding here makes the
 *  always-on relay fetch the source server-side and seed it into EVERYONE's
 *  global feed (vs. the per-device client-side topics below). */
export default function RelayFeeds() {
  const [feeds, setFeeds] = useState<NetworkFeed[] | null>(null);
  const [offline, setOffline] = useState(false);
  const [src, setSrc] = useState("rss");
  const [val, setVal] = useState("");
  const [topic, setTopic] = useState("");
  const [busy, setBusy] = useState(false);

  const meta = SOURCES.find((s) => s.id === src)!;
  const load = () =>
    relayService.listFeeds().then((r) => { setFeeds(r.feeds); setOffline(false); }).catch(() => setOffline(true));
  useEffect(() => { load(); }, []);

  async function add() {
    const v = val.trim();
    if (!v) return;
    setBusy(true);
    try {
      const t = (topic.trim() || meta.topic).toLowerCase();
      let body: Record<string, string>;
      if (src === "youtube") body = { channelId: v, topic: t };
      else if (src === "reddit") body = { url: `https://www.reddit.com/r/${v.replace(/^\/?(r\/)?/i, "")}/.rss`, topic: t };
      else if (src === "twitch") body = { rsshub: `/twitch/live/${v.replace(/^@/, "")}`, topic: t };
      else if (src === "rsshub") body = { rsshub: v.startsWith("/") ? v : "/" + v, topic: t };
      else body = { url: v, topic: t };
      await relayService.addFeed(body);
      setVal(""); setTopic("");
      toast("Feed added to the network — the relay will pull it for everyone", "success");
      load();
    } catch {
      toast("Couldn't add that feed (relay unreachable?)", "error");
    } finally {
      setBusy(false);
    }
  }
  async function remove(id: string) { try { await relayService.removeFeed(id); load(); } catch {} }

  return (
    <GlassCard sx={{ mb: 2, border: "1px solid rgba(58,155,240,0.30)" }}>
      <Stack direction="row" alignItems="flex-start" spacing={1}>
        <PublicRoundedIcon color="primary" sx={{ mt: 0.25 }} />
        <Box sx={{ flex: 1 }}>
          <Typography sx={{ fontWeight: 800 }}>Network feeds — powered by the relay</Typography>
          <Typography variant="body2" color="text.secondary">
            Add <b>basically anything</b> as a feed: any website's RSS/Atom URL, a YouTube channel, a subreddit, a
            Twitch streamer, or <b>any of the hundreds of sources RSSHub supports</b> (Instagram, X, Bluesky, blogs,
            podcasts…). It's fetched on the always-on Ledger relay and seeded into <b>everyone's</b> global feed — not just yours.
          </Typography>
        </Box>
      </Stack>

      <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ mt: 1.5 }}>
        <Select size="small" value={src} onChange={(e) => setSrc(e.target.value)} sx={{ minWidth: 210 }}>
          {SOURCES.map((s) => <MenuItem key={s.id} value={s.id}>{s.label}</MenuItem>)}
        </Select>
        <TextField size="small" fullWidth placeholder={meta.ph} value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <TextField size="small" placeholder={`topic · ${meta.topic}`} value={topic} onChange={(e) => setTopic(e.target.value)} sx={{ width: { xs: "100%", sm: 150 } }} />
        <Button variant="contained" onClick={add} disabled={busy || !val.trim()}>{busy ? "Adding…" : "Add"}</Button>
      </Stack>

      {offline ? (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1.5 }}>
          Relay unreachable right now — your client-side topics below still work.
        </Typography>
      ) : feeds && (
        <Box sx={{ mt: 1.5 }}>
          <Typography variant="overline" color="text.secondary">{feeds.length} network feed{feeds.length === 1 ? "" : "s"} live</Typography>
          <Stack direction="row" sx={{ flexWrap: "wrap", gap: 0.5, mt: 0.5 }}>
            {feeds.map((f) => (
              <Chip key={f.id} size="small" variant="outlined" label={`${f.title} · ${f.topic}`} onDelete={() => remove(f.id)} deleteIcon={<DeleteOutlineRoundedIcon />} />
            ))}
          </Stack>
        </Box>
      )}
    </GlassCard>
  );
}
