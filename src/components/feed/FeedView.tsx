import { useEffect, useState, useCallback, useMemo } from "react";
import { Box, ToggleButtonGroup, ToggleButton, Stack, Typography, Button, useMediaQuery, LinearProgress, Chip, CircularProgress, TextField, InputAdornment, IconButton } from "@mui/material";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import ClearRoundedIcon from "@mui/icons-material/ClearRounded";
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
  const [summary, setSummary] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [replies, setReplies] = useState<Map<string, Post[]>>(new Map());
  const [verdicts, setVerdicts] = useState<Map<string, import("@/types").ModerationVerdict>>(new Map());
  const [filter, setFilter] = useState<ContentFilter>("all");
  const [query, setQuery] = useState("");

  const algo = settings.feedAlgorithm;

  // Client-side content-type + keyword filtering over the ranked feed.
  const shown = useMemo(
    () => posts.filter((p) => matchesFilter(p, filter) && matchesQuery(p, query)),
    [posts, filter, query],
  );

  const refresh = useCallback(async () => {
    const subscribedTopics = (await rssService.config()).topics;
    const { posts, reasons, verdicts } = await feedService.generate(algo, { moderation: settings.moderationProfile, subscribedTopics });
    setPosts(posts);
    setReasons(reasons);
    setVerdicts(verdicts);
    setSummary(companionService.summarizeFeed(posts));
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
  useEffect(() => { rssService.refresh().catch(() => {}); }, []); // top up RSS Bot stories (throttled)

  return (
    <Box sx={{ display: "grid", gridTemplateColumns: compact ? "1fr" : "minmax(0,1fr) 300px", gap: 2, maxWidth: 1100, mx: "auto" }}>
      <Box sx={{ minWidth: 0 }}>
        <ToggleButtonGroup
          exclusive size="small" value={algo}
          onChange={(_, v) => v && setSettings({ feedAlgorithm: v })}
          sx={{ mb: 2, flexWrap: "wrap", "& .MuiToggleButton-root": { border: "1px solid rgba(58,155,240,0.18)", color: "text.secondary", "&.Mui-selected": { background: "linear-gradient(135deg,#3f97ff,#1668e0)", color: "#ffffff" } } }}
        >
          {ALGOS.map((a) => <ToggleButton key={a.id} value={a.id}>{a.label}</ToggleButton>)}
        </ToggleButtonGroup>

        <Composer />

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
              <Typography variant="body2" color="text.secondary">RSS Bot is fetching fresh stories…</Typography>
              <Box sx={{ flex: 1 }} />
              <Chip size="small" label="live" sx={{ height: 18, fontSize: 10, bgcolor: "rgba(84,201,90,0.16)", color: "#54c95a" }} />
            </Stack>
            <LinearProgress sx={{ height: 3 }} />
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
          <GlassCard sx={{ position: "sticky", top: 16 }}>
            <Typography variant="overline" color="text.secondary">Companion digest</Typography>
            <Typography variant="body2" sx={{ mt: 0.5 }}>{summary}</Typography>
            <Button size="small" sx={{ mt: 1 }} href="#/companion">Ask your companion →</Button>
          </GlassCard>
          <GlassCard sx={{ mt: 2 }}>
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
