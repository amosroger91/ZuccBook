import { useEffect, useState } from "react";
import { Box, Stack, Typography, Switch, Button, TextField, Chip, FormControlLabel, Checkbox, IconButton, Select, MenuItem, Divider } from "@mui/material";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import RefreshRoundedIcon from "@mui/icons-material/RefreshRounded";
import GlassCard from "@/components/common/GlassCard";
import RelayFeeds from "./RelayFeeds";
import { rssService, TOPIC_FEEDS, type RssConfig, type FeedKind } from "@/services/rssService";
import { toast } from "@/lib/events";

// The kinds of custom feeds a user can add (all keyless).
const KINDS: { id: string; label: string; placeholder: string }[] = [
  { id: "rss", label: "Website RSS URL", placeholder: "https://example.com/rss.xml" },
  { id: "youtube", label: "YouTube channel", placeholder: "@handle or channel URL" },
  { id: "podcast", label: "Podcast (search by name)", placeholder: "e.g. The Joe Rogan Experience" },
  { id: "reddit", label: "Subreddit", placeholder: "e.g. overlanding (or r/overlanding)" },
  { id: "github", label: "GitHub repo releases", placeholder: "owner/repo (e.g. ollama/ollama)" },
  { id: "cve", label: "App CVEs (security)", placeholder: "app name, e.g. openssl" },
];

export default function TopicsView() {
  const [cfg, setCfg] = useState<RssConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [custom, setCustom] = useState({ topic: Object.keys(TOPIC_FEEDS)[0], url: "", name: "", ckind: "rss" });

  const load = () => rssService.config().then(setCfg);
  useEffect(() => { load(); }, []);
  if (!cfg) return null;

  const topics = [...new Set([...Object.keys(TOPIC_FEEDS), ...cfg.custom.map((c) => c.topic)])];
  const kindMeta = KINDS.find((k) => k.id === custom.ckind)!;

  async function sub(topic: string, on: boolean) { await rssService.subscribe(topic, on); load(); }
  async function toggleFeed(url: string, on: boolean) { await rssService.toggleFeed(url, on); load(); }
  async function addCustom() {
    const raw = custom.url.trim();
    if (!raw) return;
    // Translate the chosen kind into a feed url + resolver kind.
    let url = raw, kind: FeedKind = "rss", name = custom.name.trim() || raw;
    if (custom.ckind === "youtube") { kind = "youtube"; }
    else if (custom.ckind === "podcast") { kind = "podcast"; }
    else if (custom.ckind === "cve") { kind = "cve"; name = custom.name.trim() || `CVEs · ${raw}`; }
    else if (custom.ckind === "reddit") { const sub = raw.replace(/^\/?(r\/)?/i, ""); url = `https://www.reddit.com/r/${sub}/.rss`; name = custom.name.trim() || `r/${sub}`; }
    else if (custom.ckind === "github") { url = `https://github.com/${raw.replace(/^https?:\/\/github\.com\//, "")}/releases.atom`; name = custom.name.trim() || raw; }
    await rssService.addCustomFeed(custom.topic, url, name, kind);
    setCustom({ ...custom, url: "", name: "" }); load();
    toast("Feed added — RSS Bot will start posting from it", "success");
  }
  async function refresh() {
    setBusy(true);
    const n = await rssService.refresh(true);
    setBusy(false); load();
    toast(n ? `Posted ${n} story update${n === 1 ? "" : "s"} from RSS Bot` : "No new stories right now", n ? "success" : "info");
  }

  return (
    <Box sx={{ maxWidth: 900, mx: "auto" }}>
      <Stack direction="row" alignItems="center" sx={{ mb: 2 }}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="h5">Topics</Typography>
          <Typography variant="body2" color="text.secondary">Subscribe to topics and RSS Bot keeps your feed alive — it pulls the top stories and your on-device LLM writes the post.</Typography>
        </Box>
        <Button variant="contained" startIcon={<RefreshRoundedIcon />} disabled={busy} onClick={refresh}>{busy ? "Fetching…" : "Refresh now"}</Button>
      </Stack>

      <RelayFeeds />

      <Stack spacing={2}>
        {topics.map((topic) => {
          const subscribed = cfg.topics.includes(topic);
          const curated = TOPIC_FEEDS[topic] ?? [];
          const customFeeds = cfg.custom.filter((c) => c.topic === topic);
          return (
            <GlassCard key={topic}>
              <Stack direction="row" alignItems="center">
                <Box sx={{ flex: 1 }}>
                  <Typography sx={{ fontWeight: 700 }}>{topic}</Typography>
                  <Typography variant="caption" color="text.secondary">{curated.length + customFeeds.length} feeds · top 2 are used</Typography>
                </Box>
                <FormControlLabel control={<Switch checked={subscribed} onChange={(e) => sub(topic, e.target.checked)} />} label={subscribed ? "Subscribed" : "Off"} />
              </Stack>
              {subscribed && (
                <Stack sx={{ mt: 1, pl: 1 }}>
                  {[...curated, ...customFeeds].map((f, i) => (
                    <Stack key={f.url} direction="row" alignItems="center" spacing={1}>
                      <Checkbox size="small" checked={!cfg.disabled.includes(f.url)} onChange={(e) => toggleFeed(f.url, e.target.checked)} />
                      <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }} noWrap>{f.name} {i < 2 && <Chip size="small" label="relevant" sx={{ height: 16, fontSize: 9, ml: 0.5 }} />}</Typography>
                      {customFeeds.includes(f as any) && <IconButton size="small" onClick={() => rssService.removeCustomFeed(f.url).then(load)}><DeleteOutlineRoundedIcon fontSize="small" /></IconButton>}
                    </Stack>
                  ))}
                </Stack>
              )}
            </GlassCard>
          );
        })}
      </Stack>

      <GlassCard sx={{ mt: 2 }}>
        <Typography variant="overline" color="text.secondary">Add a custom feed</Typography>
        <Stack spacing={1} sx={{ mt: 1 }}>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
            <Select size="small" value={custom.ckind} onChange={(e) => setCustom({ ...custom, ckind: e.target.value })} sx={{ minWidth: 170 }}>
              {KINDS.map((k) => <MenuItem key={k.id} value={k.id}>{k.label}</MenuItem>)}
            </Select>
            <TextField size="small" fullWidth placeholder={kindMeta.placeholder} value={custom.url} onChange={(e) => setCustom({ ...custom, url: e.target.value })} onKeyDown={(e) => e.key === "Enter" && addCustom()} />
          </Stack>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
            <Select size="small" value={topics.includes(custom.topic) ? custom.topic : "__new"} onChange={(e) => setCustom({ ...custom, topic: e.target.value === "__new" ? "" : e.target.value })} sx={{ minWidth: 170 }}>
              {topics.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
              <MenuItem value="__new">+ New topic…</MenuItem>
            </Select>
            {!topics.includes(custom.topic) && <TextField size="small" placeholder="New topic name" value={custom.topic} onChange={(e) => setCustom({ ...custom, topic: e.target.value })} />}
            <TextField size="small" placeholder="Label (optional)" value={custom.name} onChange={(e) => setCustom({ ...custom, name: e.target.value })} />
            <Button variant="contained" onClick={addCustom} disabled={!custom.url.trim() || !custom.topic.trim()}>Add</Button>
          </Stack>
        </Stack>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
          YouTube channels & podcasts are resolved with no API key (podcasts via Apple's search). Feeds are fetched through public CORS proxies; RSS Bot posts appear in your Feed tagged with the topic.
        </Typography>
      </GlassCard>
    </Box>
  );
}
