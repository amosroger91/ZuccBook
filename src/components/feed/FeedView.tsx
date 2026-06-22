import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { Box, ToggleButtonGroup, ToggleButton, Stack, Typography, Button, useMediaQuery, LinearProgress, Chip, CircularProgress, TextField, InputAdornment, IconButton, Avatar } from "@mui/material";
import type { Theme } from "@mui/material";
import AutoAwesomeRoundedIcon from "@mui/icons-material/AutoAwesomeRounded";
import KeyboardArrowUpRoundedIcon from "@mui/icons-material/KeyboardArrowUpRounded";
import RefreshRoundedIcon from "@mui/icons-material/RefreshRounded";
import ArrowDownwardRoundedIcon from "@mui/icons-material/ArrowDownwardRounded";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import ClearRoundedIcon from "@mui/icons-material/ClearRounded";
import { useSearchParams, useNavigate } from "react-router-dom";
import Composer from "./Composer";
import PostCard from "./PostCard";
import GlassCard from "@/components/common/GlassCard";
import { feedService } from "@/services/feedService";
import { companionService } from "@/services/companionService";
import { rssService } from "@/services/rssService";
import { changelogService } from "@/services/changelogService";
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
  const compact = useMediaQuery((theme: Theme) => theme.breakpoints.down("md"));
  const [posts, setPosts] = useState<Post[]>([]);
  const [reasons, setReasons] = useState<Map<string, RecommendationReason>>(new Map());
  const [refreshing, setRefreshing] = useState(false);
  const [rssProg, setRssProg] = useState<{ done: number; total: number; posted: number }>({ done: 0, total: 0, posted: 0 });
  const [replies, setReplies] = useState<Map<string, Post[]>>(new Map());
  const [verdicts, setVerdicts] = useState<Map<string, import("@/types").ModerationVerdict>>(new Map());
  const [filter, setFilter] = useState<ContentFilter>("all");
  const [query, setQuery] = useState("");
  const [scrolledDeep, setScrolledDeep] = useState(false);
  const [pull, setPull] = useState(0);   // pull-to-refresh progress (0..1.6)

  // show "back to top" once you've scrolled past roughly one screenful
  useEffect(() => {
    const el = document.getElementById("app-scroll");
    if (!el) return;
    const onScroll = () => setScrolledDeep(el.scrollTop > el.clientHeight);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);
  const backToTop = () => document.getElementById("app-scroll")?.scrollTo({ top: 0, behavior: "smooth" });
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

  // Render the (already in-memory) feed incrementally: mount a small window of
  // PostCards up front and grow it as you approach the end. PostCards are heavy
  // (media, embeds, link-preview fetches), so rendering hundreds at once is what
  // makes the first paint and scrolling slow. This is purely a render-time
  // window — no extra network; we're just deferring DOM/work, not data.
  const PAGE = 12;
  const [visibleCount, setVisibleCount] = useState(PAGE);
  // Reset the window when the feed's identity changes (algorithm/filter/search/group).
  useEffect(() => { setVisibleCount(PAGE); }, [algo, filter, query, community]);
  const visiblePosts = useMemo(() => shown.slice(0, visibleCount), [shown, visibleCount]);
  const hasMore = visibleCount < shown.length;
  // Latest `shown` for non-reactive handlers (e.g. deep-link focus below).
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!hasMore) return;
    const root = document.getElementById("app-scroll");
    const el = sentinelRef.current;
    if (!el) return;
    // rootMargin pre-loads the next batch ~one screen early so scrolling never stalls.
    const io = new IntersectionObserver((es) => { if (es[0].isIntersecting) setVisibleCount((v) => v + PAGE); }, { root, rootMargin: "1200px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, shown.length]);

  const refresh = useCallback(async () => {
    const cfg = await rssService.config();
    const { posts, reasons, verdicts } = await feedService.generate(algo, { moderation: settings.moderationProfile, subscribedTopics: cfg.topics, mutedTopics: cfg.mutedTopics, mutedFeeds: cfg.mutedFeeds });
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
    // The feed is windowed for performance — if the target is past the current
    // window, reveal enough to mount it before we try to scroll to it.
    const idx = shownRef.current.findIndex((p) => p.id === postId);
    if (idx >= 0) setVisibleCount((v) => Math.max(v, idx + 3));
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

  // Manual + pull-to-refresh: force fresh feeds/commits and re-rank the timeline.
  const doRefresh = useCallback(async () => {
    setPull(0);
    rssService.refresh(true).catch(() => {});
    changelogService.refresh(true).catch(() => {});
    await refresh();
  }, [refresh]);

  // The Ledger logo (and anything else) can force a feed refresh via the bus.
  useEffect(() => bus.on("feed:refresh", () => { doRefresh(); }), [doRefresh]);

  // Pull/scroll-to-refresh on the app scroll container (touch on mobile, wheel on desktop).
  useEffect(() => {
    const el = document.getElementById("app-scroll");
    if (!el) return;
    const THRESH = 80;
    const st = { startY: 0, dragging: false, val: 0, accum: 0 };
    let decay: any;
    const set = (v: number) => { st.val = v; setPull(v); };
    const fire = () => { if (st.val >= 1) doRefresh(); else set(0); st.accum = 0; };
    const onTouchStart = (e: TouchEvent) => { if (el.scrollTop <= 0) { st.startY = e.touches[0].clientY; st.dragging = true; } };
    const onTouchMove = (e: TouchEvent) => {
      if (!st.dragging) return;
      const dy = e.touches[0].clientY - st.startY;
      if (dy > 0 && el.scrollTop <= 0) set(Math.min(1.6, dy / THRESH));
      else if (dy <= 0) { st.dragging = false; set(0); }
    };
    const onTouchEnd = () => { if (st.dragging) { st.dragging = false; fire(); } };
    const onWheel = (e: WheelEvent) => {
      if (el.scrollTop <= 0 && e.deltaY < 0) {
        st.accum += -e.deltaY;
        set(Math.min(1.6, st.accum / 200));
        clearTimeout(decay);
        if (st.accum > 200) fire();
        else decay = setTimeout(() => set(0), 700);
      } else if (st.val) { st.accum = 0; set(0); }
    };
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("wheel", onWheel, { passive: true });
    return () => { el.removeEventListener("touchstart", onTouchStart); el.removeEventListener("touchmove", onTouchMove); el.removeEventListener("touchend", onTouchEnd); el.removeEventListener("wheel", onWheel); clearTimeout(decay); };
  }, [doRefresh]);

  return (
    <Box sx={{ display: "grid", gridTemplateColumns: compact ? "1fr" : "minmax(0, 1fr) clamp(260px, 24%, 340px)", gap: { xs: 2, md: 3 }, maxWidth: 1800, mx: "auto", px: { xs: 1, sm: 2, md: 0 } }}>
      <Box sx={{ minWidth: 0 }}>
        {/* pull / scroll-to-refresh indicator */}
        {pull > 0 && (
          <Box sx={{ overflow: "hidden", height: Math.round(pull * 36), transition: "height .05s linear", display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
            <Stack direction="row" alignItems="center" spacing={0.5} sx={{ color: pull >= 1 ? "#1668e0" : "text.disabled", pb: 0.5 }}>
              <ArrowDownwardRoundedIcon fontSize="small" sx={{ transition: "transform .2s", transform: pull >= 1 ? "rotate(180deg)" : "none" }} />
              <Typography variant="caption" sx={{ fontWeight: 600 }}>{pull >= 1 ? "Release to refresh" : "Keep pulling to refresh…"}</Typography>
            </Stack>
          </Box>
        )}
        {community && (
          <GlassCard sx={{ mb: 1.5, display: "flex", alignItems: "center", gap: 1, background: "linear-gradient(135deg, rgba(58,155,240,0.12), rgba(54,224,196,0.1))" }}>
            <Typography variant="body2" sx={{ flex: 1 }}>Viewing posts from <b>{communityName ?? "this group"}</b> only.</Typography>
            <Button size="small" startIcon={<ClearRoundedIcon />} onClick={() => nav("/")}>Clear</Button>
          </GlassCard>
        )}
        <Composer community={community ?? undefined} />

        {/* Controls: Row 1 = Search, Row 2 = Tabs + Filter Chips + Refresh */}
        <Stack spacing={1} sx={{ mb: 2 }}>
          <TextField
            size="small" fullWidth placeholder="Search posts, people, #tags…" value={query}
            onChange={(e) => setQuery(e.target.value)}
            InputProps={{
              startAdornment: <InputAdornment position="start"><SearchRoundedIcon fontSize="small" /></InputAdornment>,
              endAdornment: query ? <InputAdornment position="end"><IconButton size="small" onClick={() => setQuery("")}><ClearRoundedIcon fontSize="small" /></IconButton></InputAdornment> : undefined,
            }}
          />

          <Stack direction="row" alignItems="center" spacing={1} sx={{ flexWrap: "wrap", gap: { xs: 1, md: 1 } }}>
            <Box sx={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', mr: 1, '& .MuiToggleButton-root': { whiteSpace: 'nowrap' } }}>
              <ToggleButtonGroup
                exclusive size="small" value={algo}
                onChange={(_, v) => v && setSettings({ feedAlgorithm: v })}
                sx={{ display: 'inline-flex', flexWrap: 'nowrap', '& .MuiToggleButton-root': { border: '1px solid rgba(58,155,240,0.18)', color: 'text.secondary', fontSize: { xs: '0.72rem', sm: '0.875rem' }, px: { xs: 0.5, sm: 1 }, '&.Mui-selected': { background: 'linear-gradient(135deg,#3f97ff,#1668e0)', color: '#ffffff' } } }}
              >
                {ALGOS.map((a) => <ToggleButton key={a.id} value={a.id}>{a.label}</ToggleButton>)}
              </ToggleButtonGroup>
            </Box>

            <Box sx={{ display: 'flex', overflowX: 'auto', WebkitOverflowScrolling: 'touch', gap: 0.5, ml: 0.5, px: 0.5, '& > *': { flex: '0 0 auto' } }}>
              {FILTERS.map((f) => (
                <Chip key={f.id} label={f.label} size="small" onClick={() => setFilter(f.id)}
                  variant={filter === f.id ? "filled" : "outlined"}
                  sx={filter === f.id
                    ? { background: "linear-gradient(135deg,#3f97ff,#1668e0)", color: "#fff", fontWeight: 700 }
                    : { borderColor: "rgba(58,155,240,0.3)", color: "text.secondary" }} />
              ))}
            </Box>

            <Box sx={{ flex: 1 }} />
            <Button size="small" variant="outlined" startIcon={<RefreshRoundedIcon sx={{ animation: refreshing ? "zbspin 1s linear infinite" : "none", "@keyframes zbspin": { to: { transform: "rotate(360deg)" } } }} />} onClick={doRefresh} disabled={refreshing} sx={{ textTransform: "none", fontWeight: 600, flex: { xs: "1 1 auto", sm: "0 0 auto" }, minWidth: { xs: 0, sm: "auto" }, fontSize: { xs: "0.75rem", sm: "0.875rem" } }}>
              {refreshing ? "Refreshing…" : "Refresh"}
            </Button>
          </Stack>
        </Stack>

        {refreshing && (
          <GlassCard sx={{ mb: 1.5, p: 0, overflow: "hidden" }}>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 2, py: 1 }}>
              <CircularProgress size={16} />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" color="text.secondary">
                  Fetching feeds the network needs{rssProg.total ? ` · ${rssProg.done}/${rssProg.total}` : "…"}{rssProg.posted ? ` · ${rssProg.posted} new` : ""}
                </Typography>
                <Typography variant="caption" color="text.secondary">⚡ Sharing your device's compute — pulling only the feeds you follow that nobody's refreshed in the last hour.</Typography>
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
        {visiblePosts.map((p) => (
          // content-visibility:auto lets the browser skip rendering/layout for
          // cards scrolled off-screen; contain-intrinsic-size "auto 480px"
          // remembers each card's real height so the scrollbar doesn't jump.
          // (Progressive enhancement — older browsers just render normally.)
          <Box key={p.id} sx={{ contentVisibility: "auto", containIntrinsicSize: "auto 480px" }}>
            <PostCard post={p} reason={reasons.get(p.id)} replies={replies.get(p.id) ?? []} replyMap={replies} verdict={verdicts.get(p.id)} />
          </Box>
        ))}
        {hasMore && <Box ref={sentinelRef} aria-hidden sx={{ height: 1 }} />}
      </Box>

      {!compact && (
        <Box sx={{ position: "sticky", top: 16, alignSelf: "start" }}>
          <GlassCard sx={{ p: 0, overflow: "hidden" }}>
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
              {scrolledDeep && (
                <Button fullWidth size="small" startIcon={<KeyboardArrowUpRoundedIcon />} onClick={backToTop} sx={{ mt: 1, textTransform: "none", fontWeight: 700, color: "text.secondary" }}>Back to top</Button>
              )}
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
