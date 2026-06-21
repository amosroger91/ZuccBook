import { useEffect, useState, useCallback } from "react";
import { Box, ToggleButtonGroup, ToggleButton, Stack, Typography, Button, useMediaQuery } from "@mui/material";
import Composer from "./Composer";
import PostCard from "./PostCard";
import GlassCard from "@/components/common/GlassCard";
import { feedService } from "@/services/feedService";
import { companionService } from "@/services/companionService";
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

  const algo = settings.feedAlgorithm;

  const refresh = useCallback(async () => {
    const { posts, reasons } = await feedService.generate(algo, { moderation: settings.moderationProfile });
    setPosts(posts);
    setReasons(reasons);
    setSummary(companionService.summarizeFeed(posts));
  }, [algo, settings.moderationProfile]);

  useEffect(() => { refresh(); const off = bus.on("feed:updated", refresh); return off; }, [refresh]);

  return (
    <Box sx={{ display: "grid", gridTemplateColumns: compact ? "1fr" : "minmax(0,1fr) 300px", gap: 2, maxWidth: 1100, mx: "auto" }}>
      <Box sx={{ minWidth: 0 }}>
        <ToggleButtonGroup
          exclusive size="small" value={algo}
          onChange={(_, v) => v && setSettings({ feedAlgorithm: v })}
          sx={{ mb: 2, flexWrap: "wrap", "& .MuiToggleButton-root": { border: "1px solid rgba(110,231,255,0.18)", color: "text.secondary", "&.Mui-selected": { background: "linear-gradient(135deg,#6ee7ff,#a78bfa)", color: "#04121a" } } }}
        >
          {ALGOS.map((a) => <ToggleButton key={a.id} value={a.id}>{a.label}</ToggleButton>)}
        </ToggleButtonGroup>

        <Composer />

        {posts.length === 0 && (
          <GlassCard><Typography color="text.secondary">No posts match this view yet. Switch algorithms or post something — your feed is generated locally.</Typography></GlassCard>
        )}
        {posts.map((p) => <PostCard key={p.id} post={p} reason={reasons.get(p.id)} />)}
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
