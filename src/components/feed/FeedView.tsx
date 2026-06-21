import { useEffect, useState, useCallback } from "react";
import { Box, ToggleButtonGroup, ToggleButton, Stack, Typography, Button, useMediaQuery, LinearProgress, Chip, CircularProgress } from "@mui/material";
import Composer from "./Composer";
import PostCard from "./PostCard";
import GlassCard from "@/components/common/GlassCard";
import { feedService } from "@/services/feedService";
import { companionService } from "@/services/companionService";
import { rssService } from "@/services/rssService";
import { storage } from "@/services/storage";
import { useStore } from "@/store/useStore";
import { bus } from "@/lib/events";
import type { Post, RecommendationReason, FeedAlgorithm } from "@/types";

const ALGOS: { id: FeedAlgorithm; label: string }[] = [
  { id: "ai-curated", label: "✦ For You" },
  { id: "chronological", label: "Newest" },
  { id: "trending", label: "Trending" },
  { id: "discovery", label: "Discovery" },
  { id: "friends", label: "Circle" },
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

  const algo = settings.feedAlgorithm;

  const refresh = useCallback(async () => {
    const { posts, reasons } = await feedService.generate(algo, { moderation: settings.moderationProfile });
    setPosts(posts);
    setReasons(reasons);
    setSummary(companionService.summarizeFeed(posts));
    // group replies under their parent post
    const map = new Map<string, Post[]>();
    for (const p of await storage.allPosts()) if (p.replyTo) { const a = map.get(p.replyTo) ?? []; a.push(p); map.set(p.replyTo, a); }
    for (const a of map.values()) a.sort((x, y) => x.createdAt - y.createdAt);
    setReplies(map);
  }, [algo, settings.moderationProfile]);

  useEffect(() => { refresh(); const off = bus.on("feed:updated", refresh); return off; }, [refresh]);
  useEffect(() => { const off = bus.on("rss:refreshing", setRefreshing); return off; }, []);
  useEffect(() => { rssService.refresh().catch(() => {}); }, []); // top up RSS Bot stories (throttled)

  return (
    <Box sx={{ display: "grid", gridTemplateColumns: compact ? "1fr" : "minmax(0,1fr) 300px", gap: 2, maxWidth: 1100, mx: "auto" }}>
      <Box sx={{ minWidth: 0 }}>
        <ToggleButtonGroup
          exclusive size="small" value={algo}
          onChange={(_, v) => v && setSettings({ feedAlgorithm: v })}
          sx={{ mb: 2, flexWrap: "wrap", "& .MuiToggleButton-root": { border: "1px solid rgba(58,155,240,0.18)", color: "text.secondary", "&.Mui-selected": { background: "linear-gradient(135deg,#39c6f5,#3a7bf0)", color: "#031426" } } }}
        >
          {ALGOS.map((a) => <ToggleButton key={a.id} value={a.id}>{a.label}</ToggleButton>)}
        </ToggleButtonGroup>

        <Composer />

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

        {posts.length === 0 && (
          <GlassCard><Typography color="text.secondary">No posts match this view yet. Switch algorithms or post something — your feed is generated locally.</Typography></GlassCard>
        )}
        {posts.map((p) => <PostCard key={p.id} post={p} reason={reasons.get(p.id)} replies={replies.get(p.id) ?? []} />)}
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
              Posts are ranked by an embedding model running <b>on this device</b>. Tap the <b>insights</b> icon on any post to see exactly why it surfaced. Nothing is sent to a server.
            </Typography>
          </GlassCard>
        </Box>
      )}
    </Box>
  );
}
