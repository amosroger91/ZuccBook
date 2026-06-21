import { useEffect, useState, useCallback, useMemo } from "react";
import { Box, ToggleButtonGroup, ToggleButton, Stack, Typography, Button, useMediaQuery, LinearProgress, Chip, CircularProgress, TextField, InputAdornment, IconButton, Avatar } from "@mui/material";
import AutoAwesomeRoundedIcon from "@mui/icons-material/AutoAwesomeRounded";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import ClearRoundedIcon from "@mui/icons-material/ClearRounded";
import { useSearchParams, useNavigate } from "react-router-dom";
import Composer from "./Composer";
import PostCard from "./PostCard";
import GlassCard from "@/components/common/GlassCard";
import { feedService } from "@/services/feedService";
import { companionService } from "@/services/companionService";
import { rssService } from "@/services/rssService";
import { storage } from "@/services/storage";
import { useStore } from "@/store/useStore";
import { bus } from "@/lib/events";
import { matchesFilter, matchesQuery, type ContentFilter } from "@/lib/postType";
import type { Post, RecommendationReason, FeedAlgorithm } from "@/types";

const ALGOS: { id: FeedAlgorithm; label: string }[] = [
  { id: "ai-curated", label: "✦ For You" },
  { id: "chronological", label: "Newest" },
  { id: "trending", label: "Trending" },
  { id: "discovery", label: "Discovery" },
  { id: "friends", label: "Circle" },
];

const FILTERS: { id: ContentFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "text", label: "Text" },
  { id: "video", label: "Videos" },
  { id: "image", label: "Images & GIFs" },
  { id: "music", label: "Music" },
  { id: "link", label: "Links" },
  { id: "poll", label: "Polls" },
];

export default function FeedView() {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const compact = useMediaQuery("(max-width:1100px)");
  const [posts, setPosts] = useState<Post[]>([]);
  const [reasons, setReasons] = useState<Map<string, RecommendationReason>>(new Map());
  const [refreshing, setRefreshing] = useState(false);
  const [rssProg, setRssProg] = useState<{ done: number; total: number; posted: number }>({ done: 0, total: 0, posted: 0 });
  const [replies, setReplies] = useState<Map<string, Post[]>>(new Map());
  const [verdicts, setVerdicts] = useState<Map<string, import("@/types").ModerationVerdict>>(new Map());
  const [filter, setFilter] = useState<ContentFilter>("all");
  const [query, setQuery] = useState("");
  const [params] = useSearchParams();
  const nav = useNavigate();
  const community = params.get("community");
  const [communityName, setCommunityName] = useState<string | null>(null);

  const algo = settings.feedAlgorithm;

  // Group feed: ?community=<id> restricts the feed to that group's posts.
  useEffect(() => {
    if (!community) { setCommunityName(null); return; }
    storage.communities().then((cs) => setCommunityName(cs.find((c) => c.id === community)?.name ?? "this group"));
  }, [community]);

  const digest = useMemo(() => companionService.feedDigest(posts), [posts]);

  // Client-side content-type + keyword (+ group) filtering over the ranked feed.
  const shown = useMemo(
    () => posts.filter((p) => (!community || p.community === community) && matchesFilter(p, filter) && matchesQuery(p, query)),
    [posts, filter, query, community],
  );

  const refresh = useCallback(async () => {
    const subscribedTopics = (await rssService.config()).topics;
    const { posts, reasons, verdicts } = await feedService.generate(algo, { moderation: settings.moderationProfile, subscribedTopics });
    setPosts(posts);
    setReasons(reasons);
    setVerdicts(verdicts);
    // group replies under their parent post
    const map = new Map<string, Post[]>();
    for (const p of await storage.allPosts()) if (p.replyTo) { const a = map.get(p.replyTo) ?? []; a.push(p); map.set(p.replyTo, a); }
    for (const a of map.values()) a.sort((x, y) => x.createdAt - y.createdAt);
    setReplies(map);
  }, [algo, settings.moderationProfile]);

  useEffect(() => { refresh(); const off = bus.on("feed:updated", refresh); return off; }, [refresh]);
  // Scroll to & highlight a post when an alert deep-links to it.
  useEffect(() => bus.on("focus:post", ({ postId }) => {
    let tries = 0;
    const tick = () => {
      const el = document.getElementById(`post-${postId}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("zb-focus");
        setTimeout(() => el.classList.remove("zb-focus"), 2200);
      } else if (tries++ < 20) setTimeout(tick, 150); // wait for the feed to render
    };
    tick();
  }), []);
  useEffect(() => { const off = bus.on("rss:refreshing", setRefreshing); return off; }, []);
  useEffect(() => { const off = bus.on("rss:progress", setRssProg); return off; }, []);
  useEffect(() => { rssService.refresh().catch(() => {}); }, []); // top up RSS Bot stories (throttled)

  return (
    <Box sx={{ display: "grid", gridTemplateColumns: compact ? "1fr" : "minmax(0,1fr) 300px", gap: 2, maxWidth: 1100, mx: "auto" }}>
      <Box sx={{ minWidth: 0 }}>
        {community && (
          <GlassCard sx={{ mb: 1.5, display: "flex", alignItems: "center", gap: 1, background: "linear-gradient(135deg, rgba(58,155,240,0.12), rgba(54,224,196,0.1))" }}>
            <Typography variant="body2" sx={{ flex: 1 }}>Viewing posts from <b>{communityName ?? "this group"}</b> only.</Typography>
            <Button size="small" startIcon={<ClearRoundedIcon />} onClick={() => nav("/")}>Clear</Button>
          </GlassCard>
        )}
        <ToggleButtonGroup
          exclusive size="small" value={algo}
          onChange={(_, v) => v && setSettings({ feedAlgorithm: v })}
          sx={{ mb: 2, flexWrap: "wrap", "& .MuiToggleButton-root": { border: "1px solid rgba(58,155,240,0.18)", color: "text.secondary", "&.Mui-selected": { background: "linear-gradient(135deg,#3f97ff,#1668e0)", color: "#ffffff" } } }}
        >
          {ALGOS.map((a) => <ToggleButton key={a.id} value={a.id}>{a.label}</ToggleButton>)}
        </ToggleButtonGroup>

        <Composer community={community ?? undefined} />

        {/* Content-type filter + keyword search over the feed */}
        <Stack spacing={1} sx={{ mb: 2 }}>
          <TextField
            size="small" fullWidth placeholder="Search posts, people, #tags…" value={query}
            onChange={(e) => setQuery(e.target.value)}
            InputProps={{
              startAdornment: <InputAdornment position="start"><SearchRoundedIcon fontSize="small" /></InputAdornment>,
              endAdornment: query ? <InputAdornment position="end"><IconButton size="small" onClick={() => setQuery("")}><ClearRoundedIcon fontSize="small" /></IconButton></InputAdornment> : undefined,
            }}
          />
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
            {FILTERS.map((f) => (
              <Chip key={f.id} label={f.label} size="small" onClick={() => setFilter(f.id)}
                variant={filter === f.id ? "filled" : "outlined"}
                sx={filter === f.id
                  ? { background: "linear-gradient(135deg,#3f97ff,#1668e0)", color: "#fff", fontWeight: 700 }
                  : { borderColor: "rgba(58,155,240,0.3)", color: "text.secondary" }} />
            ))}
          </Box>
        </Stack>

        {refreshing && (
          <GlassCard sx={{ mb: 1.5, p: 0, overflow: "hidden" }}>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 2, py: 1 }}>
              <CircularProgress size={16} />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" color="text.secondary">
                  Populating your timeline with RSS feeds{rssProg.total ? ` · ${rssProg.done}/${rssProg.total} feeds` : "…"}{rssProg.posted ? ` · ${rssProg.posted} new` : ""}
                </Typography>
                <Typography variant="caption" color="text.secondary">⚡ You're contributing your device's compute to refresh the network's feed right now.</Typography>
              </Box>
              <Chip size="small" label="live" sx={{ height: 18, fontSize: 10, bgcolor: "rgba(84,201,90,0.16)", color: "#54c95a" }} />
            </Stack>
            <LinearProgress variant={rssProg.total ? "determinate" : "indeterminate"} value={rssProg.total ? (rssProg.done / rssProg.total) * 100 : undefined} sx={{ height: 3 }} />
          </GlassCard>
        )}

        {shown.length === 0 && (
          <GlassCard><Typography color="text.secondary">
            {posts.length === 0
              ? "No posts match this view yet. Switch algorithms or post something — your feed is generated locally."
              : (filter !== "all" || query)
                ? "No posts match your filter/search. Try a different content type or clear the search."
                : "No posts to show."}
          </Typography></GlassCard>
        )}
        {shown.map((p) => <PostCard key={p.id} post={p} reason={reasons.get(p.id)} replies={replies.get(p.id) ?? []} replyMap={replies} verdict={verdicts.get(p.id)} />)}
      </Box>

      {!compact && (
        <Box>
          <GlassCard sx={{ position: "sticky", top: 16, p: 0, overflow: "hidden" }}>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 1.5, py: 1.25, color: "#fff", background: "linear-gradient(135deg,#3f97ff,#1668e0,#0a55cf)" }}>
              <Avatar sx={{ width: 30, height: 30, bgcolor: "rgba(255,255,255,0.22)" }}><AutoAwesomeRoundedIcon fontSize="small" /></Avatar>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontWeight: 800, fontSize: 14, lineHeight: 1.1 }}>Companion digest</Typography>
                <Stack direction="row" alignItems="center" spacing={0.5}>
                  <Box sx={{ width: 6, height: 6, borderRadius: "50%", bgcolor: "#54ff7a" }} />
                  <Typography variant="caption" sx={{ opacity: 0.9 }}>on-device · live</Typography>
                </Stack>
              </Box>
            </Stack>
            <Box sx={{ p: 1.5 }}>
              <Stack direction="row" spacing={1}>
                {[["Posts", digest.count], ["People", digest.people], ["Reactions", digest.reactions]].map(([label, value]) => (
                  <Box key={label as string} sx={{ flex: 1, textAlign: "center", py: 0.85, borderRadius: 1.5, bgcolor: "rgba(58,155,240,0.07)" }}>
                    <Typography sx={{ fontWeight: 800, fontSize: 18, lineHeight: 1, color: "#1668e0" }}>{value as number}</Typography>
                    <Typography variant="caption" color="text.secondary">{label as string}</Typography>
                  </Box>
                ))}
              </Stack>
              {digest.themes.length > 0 && (
                <Box sx={{ mt: 1.5 }}>
                  <Typography variant="overline" color="text.secondary">Themes</Typography>
                  <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mt: 0.25 }}>
                    {digest.themes.map((t) => <Chip key={t} size="small" label={`#${t}`} sx={{ height: 22, bgcolor: "rgba(58,123,240,0.1)", color: "#1668e0", fontWeight: 600 }} />)}
                  </Box>
                </Box>
              )}
              {digest.top && (Object.values(digest.top.reactions).some((v) => v.length)) && (
                <Box sx={{ mt: 1.5, p: 1, borderRadius: 1.5, bgcolor: "rgba(0,0,0,0.03)" }}>
                  <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>🔥 Most-reacted</Typography>
                  <Typography variant="body2" sx={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", mt: 0.25 }}>
                    "{(digest.top.text ?? "").split("\n")[0].slice(0, 110)}" — {digest.top.authorName}
                  </Typography>
                </Box>
              )}
              <Button fullWidth variant="outlined" size="small" startIcon={<AutoAwesomeRoundedIcon />} sx={{ mt: 1.5, textTransform: "none", fontWeight: 700 }} href="#/companion">Ask your Companion</Button>
            </Box>
          </GlassCard>
          <GlassCard sx={{ mt: "20px" }}>
            <Typography variant="overline" color="text.secondary">How this feed works</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              Ranking runs <b>on this device</b> with a lightweight text-embedding (hashed word vectors) — instant and needs no download. It's <b>not</b> the chat LLM: your <b>Companion</b> is a separate full language model that auto-downloads and also runs locally. Tap the <b>insights</b> icon on any post to see exactly why it surfaced. Nothing is sent to a server.
            </Typography>
          </GlassCard>

        </Box>
      )}
    </Box>
  );
}
