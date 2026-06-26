import { useEffect, useState, useCallback, useMemo, useRef, useLayoutEffect, memo } from "react";
import { Box, ToggleButtonGroup, ToggleButton, Stack, Typography, Button, useMediaQuery, LinearProgress, Chip, CircularProgress, Avatar, Select, MenuItem, IconButton, Tooltip, Divider } from "@mui/material";
import FilterListRoundedIcon from "@mui/icons-material/FilterListRounded";
import type { Theme } from "@mui/material";
import AutoAwesomeRoundedIcon from "@mui/icons-material/AutoAwesomeRounded";
import KeyboardArrowUpRoundedIcon from "@mui/icons-material/KeyboardArrowUpRounded";
import RefreshRoundedIcon from "@mui/icons-material/RefreshRounded";
import ArrowDownwardRoundedIcon from "@mui/icons-material/ArrowDownwardRounded";
import ClearRoundedIcon from "@mui/icons-material/ClearRounded";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
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
import { isOff } from "@/lib/flags";
import { useVirtualizer } from "@tanstack/react-virtual";
import { matchesFilter, type ContentFilter } from "@/lib/postType";
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

// One sponsored slot is interleaved after every AD_EVERY posts (so no real post is
// replaced). A-ADS is a privacy-respecting network — no cookies, no tracking,
// crypto-paid — which fits the local-first ethos. Disable with ?off=ads.
type FeedItem = { type: "post"; post: Post } | { type: "ad"; id: string };
const AD_EVERY = 10;

const EMPTY_REPLIES: Post[] = [];

const AdUnit = memo(function AdUnit() {
  // A-ADS is on every ad-blocker list. PROBE an a-ads asset first (an <img> the blockers
  // also kill): if it can't load — blocked, or hung past the timeout — render NOTHING so
  // the whole slot disappears instead of leaving an empty "Sponsored" box. This is more
  // robust than watching the iframe's onLoad (some blockers swap in about:blank, which
  // fires onLoad). Only once a-ads is confirmed reachable do we mount the ad iframe.
  const [reachable, setReachable] = useState<boolean | null>(null); // null = probing
  useEffect(() => {
    let alive = true;
    const img = new Image();
    const t = setTimeout(() => { if (alive) setReachable(false); }, 4000); // hung = treat as blocked
    const done = (v: boolean) => { if (alive) { clearTimeout(t); setReachable(v); } };
    img.onload = () => done(true);
    img.onerror = () => done(false);
    img.src = "https://ad.a-ads.com/assets/default_logo.svg?_=" + Math.random().toString(36).slice(2);
    return () => { alive = false; clearTimeout(t); };
  }, []);
  if (!reachable) return null; // probing or blocked → the whole node is hidden
  return (
    <Box sx={{ mb: 1.5 }}>
      <GlassCard sx={{ p: 1 }}>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 0.5 }}>
          <Typography variant="caption" color="text.secondary" sx={{ textTransform: "uppercase", letterSpacing: 0.6, fontSize: 10, opacity: 0.7 }}>Sponsored</Typography>
          {/* Why am I seeing ads? → the Support page explains it (and how to turn them off). */}
          <Box component="a" href={`${import.meta.env.BASE_URL}support.html`} target="_blank" rel="noopener noreferrer"
            sx={{ display: "inline-flex", alignItems: "center", gap: 0.3, textDecoration: "none", color: "text.secondary", fontSize: 10, opacity: 0.7, lineHeight: 1, "&:hover": { opacity: 1, color: "primary.main" } }}>
            <InfoOutlinedIcon sx={{ fontSize: 12 }} />
            <Box component="span">Why am I seeing ads?</Box>
          </Box>
        </Box>
        <Box component="iframe" data-aa="2445453" src="https://acceptable.a-ads.com/2445453/?size=Adaptive"
          title="Sponsored" referrerPolicy="no-referrer"
          sx={{ border: 0, p: 0, width: "100%", height: 110, display: "block", overflow: "hidden", borderRadius: 1.5 }} />
      </GlassCard>
    </Box>
  );
});

export default function FeedView() {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const compact = useMediaQuery((theme: Theme) => theme.breakpoints.down("md")); // ≤ md → single column + the feed controls become compact dropdowns
  const [posts, setPosts] = useState<Post[]>([]);
  const [reasons, setReasons] = useState<Map<string, RecommendationReason>>(new Map());
  const [refreshing, setRefreshing] = useState(false);
  const [rssProg, setRssProg] = useState<{ done: number; total: number; posted: number }>({ done: 0, total: 0, posted: 0 });
  const [replies, setReplies] = useState<Map<string, Post[]>>(new Map());
  const [verdicts, setVerdicts] = useState<Map<string, import("@/types").ModerationVerdict>>(new Map());
  const [filter, setFilter] = useState<ContentFilter>("all");
  const [scrolledDeep, setScrolledDeep] = useState(false);
  const [pull, setPull] = useState(0);   // pull-to-refresh progress (0..1.6)
  const [newCount, setNewCount] = useState(0); // new posts held behind the pill (kept out of the feed you're reading)

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

  const digest = useMemo(() => isOff("digest") ? { count: 0, people: 0, reactions: 0, themes: [] as string[], top: null } : companionService.feedDigest(posts), [posts]);

  // Client-side content-type + keyword (+ group) filtering over the ranked feed.
  const shown = useMemo(
    () => posts.filter((p) => (!community || p.community === community) && matchesFilter(p, filter)),
    [posts, filter, community],
  );

  // Latest `shown` for non-reactive handlers (e.g. deep-link focus below).
  const shownRef = useRef(shown);
  shownRef.current = shown;
  // Interleave a sponsored slot after every AD_EVERY posts. Ads are keyed by ordinal
  // (ad-0, ad-1…) so they keep their identity — and don't reload the iframe — as the
  // feed reorders around them.
  const adsOff = isOff("ads") || settings.showAds === false; // user can turn ads off in Settings
  const feedItems = useMemo<FeedItem[]>(() => {
    const out: FeedItem[] = [];
    let adN = 0;
    shown.forEach((p, i) => {
      out.push({ type: "post", post: p });
      if (!adsOff && (i + 1) % AD_EVERY === 0) out.push({ type: "ad", id: `ad-${adN++}` });
    });
    return out;
  }, [shown, adsOff]);
  const feedItemsRef = useRef(feedItems);
  feedItemsRef.current = feedItems;
  // TRUE virtualization (TanStack Virtual): render only the cards in/near the viewport and
  // UNMOUNT the rest, so the DOM — and every card's effects (the NSFW image check, embeds,
  // link-preview fetches) — stays constant no matter how far you scroll. The list shares
  // the app's #app-scroll container with the composer/controls above it, so we hand the
  // virtualizer that scroll element plus a `scrollMargin` = the list's offset within it
  // (re-measured when the header above changes height). Explicit offset control is exactly
  // what the shared-scroll layout needs (react-virtuoso's auto-measure couldn't do it).
  const listRef = useRef<HTMLDivElement>(null);
  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null);
  useEffect(() => { setScrollEl(document.getElementById("app-scroll")); }, []);
  const [scrollMargin, setScrollMargin] = useState(0);
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || !scrollEl) return;
    const measure = () => {
      const top = list.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top + scrollEl.scrollTop;
      setScrollMargin((m) => (Math.abs(m - top) > 1 ? Math.max(0, Math.round(top)) : m));
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (list.parentElement) ro.observe(list.parentElement);   // header above the list grows/shrinks → re-measure offset
    return () => ro.disconnect();
  }, [scrollEl, shown.length > 0]);
  const virtualizer = useVirtualizer({
    count: feedItems.length,
    getScrollElement: () => scrollEl,
    estimateSize: (i) => (feedItems[i]?.type === "ad" ? 140 : 480), // rough first guess; measureElement corrects each
    overscan: 4,                    // a few extra cards above/below so fast scrolling never flashes blank
    scrollMargin,
    getItemKey: (i) => { const it = feedItems[i]; return it ? (it.type === "ad" ? it.id : it.post.id) : i; },
  });

  // Build the ranked feed (pure — no state writes). Reused by the full refresh and
  // the background reconcile below.
  const generateFeed = useCallback(async () => {
    const cfg = await rssService.config();
    return feedService.generate(algo, { moderation: settings.moderationProfile, subscribedTopics: cfg.topics, mutedTopics: cfg.mutedTopics, mutedFeeds: cfg.mutedFeeds, includeNostr: settings.nostrEnabled !== false, community: community ?? undefined, limit: 400, hideJunk: settings.hideSpam === true, hideFlaggedText: settings.nsfwMode === "hide" || settings.profanityMode === "hide" });
  }, [algo, settings.moderationProfile, settings.nostrEnabled, settings.hideSpam, settings.nsfwMode, settings.profanityMode, community]);

  // Latest displayed posts + the held ranking, for the async background reconcile
  // (refs avoid stale closures across awaits).
  const postsRef = useRef<Post[]>([]);
  postsRef.current = posts;
  const pendingRef = useRef<Awaited<ReturnType<typeof generateFeed>> | null>(null);

  // FULL refresh: re-rank and replace the feed. Expected when YOU act or change the
  // algorithm/group/explicit pull. Clears the "new posts" pill.
  const refresh = useCallback(async () => {
    const res = await generateFeed();
    setPosts(res.posts); setReasons(res.reasons); setVerdicts(res.verdicts); setReplies(res.replies);
    pendingRef.current = null; setNewCount(0);
  }, [generateFeed]);

  // BACKGROUND reconcile: a feed you're reading must NOT reorder under you as the
  // Nostr/RSS firehose streams in — that churn feels broken. So while you're scrolled
  // down we keep the displayed posts in their CURRENT order, only refreshing their
  // data in place (reaction counts, etc.), and hold genuinely-new posts behind a
  // "N new posts" pill. At the very top (nothing scrolled past) new posts just flow
  // in, which is what you'd expect there.
  const applyBackground = useCallback(async () => {
    const res = await generateFeed();
    const prev = postsRef.current;
    const el = document.getElementById("app-scroll");
    const atTop = !el || el.scrollTop < 40;
    // Fill freely while the feed is empty/sparse (a fresh account loading from the
    // mesh) or while you're at the top; only FREEZE + hold behind the pill once the
    // feed is substantial AND you've scrolled down into it.
    if (prev.length < 25 || atTop) {
      setPosts(res.posts); pendingRef.current = null; setNewCount(0);
    } else {
      const fresh = new Map(res.posts.map((p) => [p.id, p]));
      setPosts(prev.map((p) => fresh.get(p.id) ?? p));   // same order, fresh data
      const prevIds = new Set(prev.map((p) => p.id));
      pendingRef.current = res;
      setNewCount(res.posts.filter((p) => !prevIds.has(p.id)).length);
    }
    setReasons(res.reasons); setVerdicts(res.verdicts); setReplies(res.replies);
  }, [generateFeed]);

  // Clicking the "N new posts" pill: jump all the way to the top of the app AND pull a
  // fresh content update — a full re-rank of everything that's arrived (not just the
  // snapshot held when the pill appeared). refresh() clears the pill (pendingRef +
  // newCount); we scroll to the top up front and re-pin once the new feed has settled.
  const applyPending = useCallback(() => {
    const el = document.getElementById("app-scroll");
    el?.scrollTo({ top: 0, behavior: "smooth" });
    refresh().then(() => el?.scrollTo({ top: 0 }));
  }, [refresh]);

  // Full refresh on mount / algo / group change. Background bus updates use a leading
  // THROTTLE feeding the reconcile above: the first update after an idle gap applies
  // at once, a burst coalesces to ≤1 reconcile per GAP, and it never starves.
  useEffect(() => {
    refresh();
    const GAP = 1200;   // coalesce the relay/Nostr firehose hard — re-ranking every 400ms while it floods pinned the thread
    const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
    let timer: ReturnType<typeof setTimeout> | null = null;
    let last = 0;
    const fire = () => { last = now(); timer = null; applyBackground(); };
    const onUpdate = () => {
      const elapsed = now() - last;
      if (elapsed >= GAP) { if (timer) clearTimeout(timer); fire(); }
      else if (!timer) timer = setTimeout(fire, GAP - elapsed);
    };
    const off = bus.on("feed:updated", onUpdate);
    // Your OWN top-level post surfaces at the top immediately; a reply (or AI comment)
    // just folds into its thread in place — neither should wait behind the pill, and a
    // reply must NOT reorder the feed you're reading.
    const offPost = bus.on("feed:post", (post) => { if (post && !post.replyTo) refresh(); else applyBackground(); });
    return () => { off(); offPost(); if (timer) clearTimeout(timer); };
  }, [refresh, applyBackground]);
  // Scroll to & highlight a post when an alert deep-links to it.
  useEffect(() => bus.on("focus:post", ({ postId }) => {
    // Virtualized feed: ask the virtualizer to scroll the row into view so it mounts,
    // then highlight it once it's in the DOM.
    const idx = feedItemsRef.current.findIndex((it) => it.type === "post" && it.post.id === postId);
    if (idx >= 0) virtualizer.scrollToIndex(idx, { align: "center" });
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
    <Box sx={{ display: "grid", gridTemplateColumns: compact ? "1fr" : "minmax(0, 1fr) clamp(260px, 22%, 320px)", gap: { xs: 2, md: 3 }, maxWidth: 1100, mx: "auto", px: { xs: 0, sm: 0, md: 0 } }}>
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

        {/* Controls. Phone: two compact dropdowns (feed algorithm + content filter)
            and no Refresh button — pull-to-refresh handles reloads. Larger screens
            keep the full toggle tabs + filter chips + Refresh. */}
        {compact ? (
          <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
            <Select size="small" value={algo} onChange={(e) => setSettings({ feedAlgorithm: e.target.value as FeedAlgorithm })}
              sx={{ flex: 1, bgcolor: "var(--bl-face)", fontWeight: 700, "& .MuiSelect-select": { py: 1 } }}>
              {ALGOS.map((a) => <MenuItem key={a.id} value={a.id}>{a.label}</MenuItem>)}
            </Select>
            <Select size="small" value={filter} onChange={(e) => setFilter(e.target.value as ContentFilter)}
              renderValue={(v) => (
                <Stack direction="row" alignItems="center" spacing={0.5} sx={{ minWidth: 0 }}>
                  <FilterListRoundedIcon sx={{ fontSize: 17, color: "text.secondary", flexShrink: 0 }} />
                  <Box component="span" sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{FILTERS.find((f) => f.id === v)?.label}</Box>
                </Stack>
              )}
              sx={{ flex: 1, bgcolor: "var(--bl-face)", fontWeight: 700, "& .MuiSelect-select": { py: 1 } }}>
              {FILTERS.map((f) => <MenuItem key={f.id} value={f.id}>{f.label}</MenuItem>)}
            </Select>
          </Stack>
        ) : (
          // Unified single-row control bar: algo tabs | divider | content-type select | refresh icon
          <Box sx={{
            display: "flex", alignItems: "center", gap: 1, mb: 2,
            bgcolor: "var(--bl-face)", border: "1px solid var(--bl-line)",
            borderRadius: 2, px: 1, py: 0.5, minHeight: 44,
          }}>
            {/* Algo toggle tabs — horizontally scrollable, no wrapping */}
            <Box sx={{ flex: 1, overflowX: "auto", WebkitOverflowScrolling: "touch", "&::-webkit-scrollbar": { display: "none" }, scrollbarWidth: "none" }}>
              <ToggleButtonGroup
                exclusive size="small" value={algo}
                onChange={(_, v) => v && setSettings({ feedAlgorithm: v })}
                sx={{
                  display: "inline-flex", gap: 0.25, p: 0,
                  "& .MuiToggleButtonGroup-grouped": { border: "none !important", borderRadius: "6px !important" },
                  "& .MuiToggleButton-root": {
                    border: "none", borderRadius: "6px", fontSize: "0.82rem", fontWeight: 600,
                    px: 1.4, py: 0.55, whiteSpace: "nowrap", color: "text.secondary", textTransform: "none",
                    "&.Mui-selected": {
                      background: "linear-gradient(135deg,#3f97ff,#1668e0)",
                      color: "#fff",
                      boxShadow: "0 2px 6px rgba(58,155,240,0.35)",
                    },
                    "&:hover:not(.Mui-selected)": { bgcolor: "rgba(58,155,240,0.07)" },
                  },
                }}
              >
                {ALGOS.map((a) => <ToggleButton key={a.id} value={a.id}>{a.label}</ToggleButton>)}
              </ToggleButtonGroup>
            </Box>

            {/* Divider */}
            <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />

            {/* Content-type compact select */}
            <Tooltip title="Filter by content type">
              <Select
                size="small" value={filter}
                onChange={(e) => setFilter(e.target.value as ContentFilter)}
                variant="outlined"
                renderValue={(v) => (
                  <Stack direction="row" alignItems="center" spacing={0.5}>
                    <FilterListRoundedIcon sx={{ fontSize: 15, color: "text.secondary" }} />
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{FILTERS.find((f) => f.id === v)?.label}</span>
                  </Stack>
                )}
                sx={{
                  height: 34, fontSize: 13, minWidth: 120, maxWidth: 160,
                  bgcolor: filter !== "all" ? "rgba(58,155,240,0.07)" : undefined,
                  "& .MuiOutlinedInput-notchedOutline": { borderColor: "var(--bl-line)" },
                  "& .MuiSelect-select": { py: 0.5, pr: "28px !important" },
                }}
              >
                {FILTERS.map((f) => <MenuItem key={f.id} value={f.id} sx={{ fontSize: 13 }}>{f.label}</MenuItem>)}
              </Select>
            </Tooltip>

            {/* Refresh icon-only button */}
            <Tooltip title={refreshing ? "Refreshing…" : "Refresh feed"}>
              <span>
                <IconButton
                  size="small" onClick={doRefresh} disabled={refreshing} aria-label="Refresh feed"
                  sx={{ color: "text.secondary", "&:hover": { color: "primary.main", bgcolor: "rgba(58,155,240,0.08)" } }}
                >
                  <RefreshRoundedIcon sx={{ fontSize: 20, animation: refreshing ? "zbspin 1s linear infinite" : "none", "@keyframes zbspin": { to: { transform: "rotate(360deg)" } } }} />
                </IconButton>
              </span>
            </Tooltip>
          </Box>
        )}

        {refreshing && (
          <GlassCard sx={{ mb: 1.5, p: 0, overflow: "hidden" }}>
            <Stack direction="row" alignItems="flex-start" spacing={1.5} sx={{ px: 2, py: 1.5 }}>
              <CircularProgress size={18} sx={{ flexShrink: 0, mt: 0.25 }} />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                  <Typography variant="body2" sx={{ fontWeight: 700, color: "text.primary" }}>
                    Fetching feeds the network needs{rssProg.total ? ` · ${rssProg.done}/${rssProg.total}` : "…"}{rssProg.posted ? ` · ${rssProg.posted} new` : ""}
                  </Typography>
                  <Chip size="small" label="live" sx={{ height: 18, fontSize: 10, bgcolor: "rgba(84,201,90,0.16)", color: "#54c95a", fontWeight: 700, border: "1px solid rgba(84,201,90,0.3)" }} />
                </Stack>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", lineHeight: 1.4 }}>
                  ⚡ Sharing your device's compute — pulling only the feeds you follow that nobody's refreshed in the last hour.
                </Typography>
              </Box>
            </Stack>
            <LinearProgress variant={rssProg.total ? "determinate" : "indeterminate"} value={rssProg.total ? (rssProg.done / rssProg.total) * 100 : undefined} sx={{ height: 3 }} />
          </GlassCard>
        )}

        {/* New posts that arrived while you were scrolled down — held here so the feed
            you're reading never reorders under you. Tap to fold them in and jump up. */}
        {newCount > 0 && (
          <Box sx={{ position: "sticky", top: 8, zIndex: 6, display: "flex", justifyContent: "center", mb: 1.5, pointerEvents: "none" }}>
            <Button onClick={applyPending} variant="contained" size="small" startIcon={<KeyboardArrowUpRoundedIcon />}
              sx={{ pointerEvents: "auto", borderRadius: 999, textTransform: "none", fontWeight: 800, px: 2.5, boxShadow: 4, background: "linear-gradient(135deg,#3f97ff,#1668e0)", "&:hover": { background: "linear-gradient(135deg,#3f97ff,#0a55cf)" } }}>
              {newCount} new post{newCount > 1 ? "s" : ""}
            </Button>
          </Box>
        )}

        {shown.length === 0 && (
          <GlassCard><Typography color="text.secondary">
            {posts.length === 0
              ? "No posts match this view yet. Switch algorithms or post something — your feed is generated locally."
              : (filter !== "all")
                ? "No posts match this content filter. Try a different type."
                : "No posts to show."}
          </Typography></GlassCard>
        )}
        {!isOff("cards") && shown.length > 0 && (
          // The list container spans the FULL virtual height (so the scrollbar is correct);
          // only the windowed cards are mounted inside it, absolutely positioned at their
          // measured offset. translateY subtracts scrollMargin because the container already
          // sits that far down the scroll (below the composer/controls).
          <Box ref={listRef} sx={{ position: "relative", width: "100%" }} style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((vi) => {
              const item = feedItems[vi.index];
              if (!item) return null;
              return (
                <Box
                  key={vi.key}
                  data-index={vi.index}
                  ref={virtualizer.measureElement}
                  sx={{ position: "absolute", top: 0, left: 0, width: "100%" }}
                  style={{ transform: `translateY(${vi.start - virtualizer.options.scrollMargin}px)` }}
                >
                  {item.type === "ad"
                    ? <AdUnit />
                    : <PostCard post={item.post} reason={reasons.get(item.post.id)} replies={replies.get(item.post.id) ?? EMPTY_REPLIES} replyMap={replies} verdict={verdicts.get(item.post.id)} />}
                </Box>
              );
            })}
          </Box>
        )}
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
                <Box onClick={() => digest.top && nav(`/post/${encodeURIComponent(digest.top.id)}`)} title="Open this post"
                  sx={{ mt: 1.5, p: 1, borderRadius: 1.5, bgcolor: "rgba(0,0,0,0.03)", cursor: "pointer", transition: "background .15s ease", "&:hover": { bgcolor: "rgba(58,155,240,0.08)" } }}>
                  <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>🔥 Most-reacted</Typography>
                  <Typography variant="body2" sx={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", mt: 0.25 }}>
                    "{(digest.top.text ?? "").split("\n")[0].slice(0, 110)}" — {digest.top.authorName}
                  </Typography>
                </Box>
              )}
              <Button fullWidth variant="outlined" size="small" startIcon={<AutoAwesomeRoundedIcon />} sx={{ mt: 1.5, textTransform: "none", fontWeight: 700 }} onClick={() => bus.emit("companion:open", undefined)}>Ask AI</Button>
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
