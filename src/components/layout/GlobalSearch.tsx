// ============================================================
//  GlobalSearch — one box that searches everything: users/profiles,
//  posts, groups, chatrooms, and radio genres + live stations. Opens
//  as a command-palette dialog from the title bar. All matching is
//  local/instant except radio stations (a debounced Radio Browser
//  query), so results appear as you type with no backend.
// ============================================================
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Box, Stack, Typography, Dialog, TextField, InputAdornment, IconButton, CircularProgress } from "@mui/material";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import PersonRoundedIcon from "@mui/icons-material/PersonRounded";
import ArticleRoundedIcon from "@mui/icons-material/ArticleRounded";
import GroupsRoundedIcon from "@mui/icons-material/GroupsRounded";
import ForumRoundedIcon from "@mui/icons-material/ForumRounded";
import RadioRoundedIcon from "@mui/icons-material/RadioRounded";
import GraphicEqRoundedIcon from "@mui/icons-material/GraphicEqRounded";
import { storage } from "@/services/storage";
import { communityService } from "@/services/communityService";
import { nostrService } from "@/services/nostrService";
import { listenTogetherService, GENRES, flagOf, type Station } from "@/services/listenTogetherService";
import { useStore } from "@/store/useStore";
import { bus } from "@/lib/events";
import { relativeTime } from "@/lib/time";
import UserAvatar from "@/components/common/UserAvatar";
import type { Post, Profile, Community } from "@/types";

// Mirrors the static room list in ChatroomView (no public catalog to import).
const ROOMS = ["lounge", "gaming", "music", "study", "late-night", "tech-talk"];
const BOTS = new Set(["rss-bot", "system", "ai-bot"]);
const isBot = (pk: string) => BOTS.has(pk) || pk.startsWith("demo_");
const CAP = { users: 5, posts: 5, groups: 4, rooms: 4, genres: 5, stations: 6 };

interface Row { icon: React.ReactNode; primary: string; secondary?: string; onClick: () => void; }

export default function GlobalSearch({ compact }: { compact?: boolean }) {
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [comms, setComms] = useState<Community[]>([]);
  const [stations, setStations] = useState<Station[]>([]);
  const [loadingSt, setLoadingSt] = useState(false);
  const [loadingNostr, setLoadingNostr] = useState(false);
  const nostrEnabled = useStore((s) => s.settings.nostrEnabled !== false);

  // Load the local datasets each time the palette opens, so results are fresh.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    Promise.all([storage.allProfiles(), storage.allPosts(), communityService.list()])
      .then(([pf, ps, cm]) => { if (alive) { setProfiles(pf); setPosts(ps); setComms(cm); } })
      .catch(() => {});
    return () => { alive = false; };
  }, [open]);

  // Radio stations come from the network — debounce and only on a real query.
  useEffect(() => {
    const ql = q.trim();
    if (!open || ql.length < 2) { setStations([]); setLoadingSt(false); return; }
    let alive = true; setLoadingSt(true);
    const h = setTimeout(() => {
      listenTogetherService.browse({ q: ql, limit: CAP.stations })
        .then((list) => { if (alive) { setStations(list.slice(0, CAP.stations)); setLoadingSt(false); } })
        .catch(() => { if (alive) { setStations([]); setLoadingSt(false); } });
    }, 350);
    return () => { alive = false; clearTimeout(h); };
  }, [q, open]);

  // Search Nostr too (NIP-50 / hashtag / npub) — ingest matches, then reload
  // posts so the freshly-pulled Nostr notes surface in the "Posts" results.
  useEffect(() => {
    const ql2 = q.trim();
    if (!open || ql2.length < 2 || !nostrEnabled) { setLoadingNostr(false); return; }
    let alive = true; setLoadingNostr(true);
    const h = setTimeout(() => {
      nostrService.search(ql2)
        .then(() => storage.allPosts())
        .then((ps) => { if (alive) setPosts(ps); })
        .catch(() => {})
        .finally(() => { if (alive) setLoadingNostr(false); });
    }, 450);
    return () => { alive = false; clearTimeout(h); };
  }, [q, open, nostrEnabled]);

  function close() { setOpen(false); setQ(""); setStations([]); }
  const goUser = (pk: string) => { close(); nav(`/u/${pk}`); };
  const goPost = (id: string) => { close(); nav("/"); setTimeout(() => bus.emit("focus:post", { postId: id }), 250); };
  const goGroup = (c: Community) => { close(); nav(`/?community=${c.id}`); };
  const goRoom = (r: string) => { close(); nav(`/chatroom?room=${r}`); };
  const goGenre = (g: string) => { close(); nav(`/listen?tag=${encodeURIComponent(g)}`); };
  const goStation = async (s: Station) => { close(); nav("/listen"); listenTogetherService.play(s).catch(() => {}); };

  // Unique user directory: known profiles + anyone seen authoring a post.
  const users = useMemo(() => {
    const m = new Map<string, { pk: string; name: string; avatar?: string }>();
    for (const p of profiles) if (!isBot(p.pk)) m.set(p.pk, { pk: p.pk, name: p.username || "Someone", avatar: p.avatar });
    for (const po of posts) if (po.author && !isBot(po.author) && !m.has(po.author)) m.set(po.author, { pk: po.author, name: po.authorName || "Someone", avatar: po.authorAvatar });
    return [...m.values()];
  }, [profiles, posts]);

  const ql = q.trim().toLowerCase();
  const sections = useMemo(() => {
    if (!ql) return [] as { label: string; rows: Row[] }[];
    const out: { label: string; rows: Row[] }[] = [];

    const u = users.filter((x) => x.name.toLowerCase().includes(ql) || x.pk.toLowerCase().includes(ql)).slice(0, CAP.users);
    if (u.length) out.push({ label: "People", rows: u.map((x) => ({ icon: <UserAvatar pk={x.pk} name={x.name} avatar={x.avatar} size={28} />, primary: x.name, secondary: "View profile", onClick: () => goUser(x.pk) })) });

    const ps = posts.filter((p) => !!p.text && (`${p.text} ${p.authorName} ${p.tags.join(" ")}`).toLowerCase().includes(ql)).slice(0, CAP.posts);
    if (ps.length) out.push({ label: "Posts", rows: ps.map((p) => ({ icon: <ArticleRoundedIcon fontSize="small" />, primary: (p.text ?? "").replace(/\s+/g, " ").trim().slice(0, 80), secondary: `${p.authorName} · ${relativeTime(p.createdAt)}`, onClick: () => goPost(p.id) })) });

    const g = comms.filter((c) => `${c.name} ${c.description}`.toLowerCase().includes(ql)).slice(0, CAP.groups);
    if (g.length) out.push({ label: "Groups", rows: g.map((c) => ({ icon: <Box sx={{ fontSize: 20 }}>{c.icon || "🌐"}</Box>, primary: c.name, secondary: `${c.members.length} member${c.members.length === 1 ? "" : "s"}`, onClick: () => goGroup(c) })) });

    const r = ROOMS.filter((x) => x.includes(ql)).slice(0, CAP.rooms);
    if (r.length) out.push({ label: "Chatrooms", rows: r.map((x) => ({ icon: <ForumRoundedIcon fontSize="small" />, primary: `#${x}`, secondary: "Open chatroom", onClick: () => goRoom(x) })) });

    const ge = GENRES.filter((x) => x.includes(ql)).slice(0, CAP.genres);
    if (ge.length) out.push({ label: "Radio genres", rows: ge.map((x) => ({ icon: <GraphicEqRoundedIcon fontSize="small" />, primary: x, secondary: "Browse stations", onClick: () => goGenre(x) })) });

    if (stations.length) out.push({ label: "Radio stations", rows: stations.map((s) => ({ icon: <RadioRoundedIcon fontSize="small" />, primary: s.name, secondary: `${flagOf(s.countryCode)} ${s.country || "—"} · ${s.genre}`, onClick: () => goStation(s) })) });

    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ql, users, posts, comms, stations]);

  const total = sections.reduce((n, s) => n + s.rows.length, 0);

  return (
    <>
      {/* trigger — a search pill on desktop, an icon on mobile */}
      {compact ? (
        <IconButton onClick={() => setOpen(true)} sx={{ color: "#fff" }} aria-label="Search"><SearchRoundedIcon /></IconButton>
      ) : (
        <Box
          onClick={() => setOpen(true)} role="button" aria-label="Search everything"
          sx={{ flex: 1, maxWidth: 440, display: "flex", alignItems: "center", gap: 1, px: 1.5, py: 0.55, borderRadius: 2, cursor: "text", color: "#fff", bgcolor: "rgba(255,255,255,0.18)", border: "1px solid rgba(255,255,255,0.25)", transition: "background .15s", "&:hover": { bgcolor: "rgba(255,255,255,0.28)" } }}
        >
          <SearchRoundedIcon fontSize="small" />
          <Typography variant="body2" sx={{ opacity: 0.9 }} noWrap>Search everything…</Typography>
        </Box>
      )}

      <Dialog
        open={open} onClose={close} fullWidth maxWidth="sm"
        PaperProps={{ sx: { position: "fixed", top: { xs: 12, sm: 64 }, m: 0, mx: "auto", borderRadius: 3, backgroundImage: "none", width: "100%" } }}
      >
        <Box sx={{ p: 1.25, borderBottom: "1px solid var(--bl-line)" }}>
          <TextField
            autoFocus fullWidth size="small" placeholder="Search people, posts, groups, radio + Nostr…"
            value={q} onChange={(e) => setQ(e.target.value)}
            InputProps={{
              startAdornment: <InputAdornment position="start"><SearchRoundedIcon fontSize="small" sx={{ color: "text.disabled" }} /></InputAdornment>,
              endAdornment: (loadingSt || loadingNostr) ? <InputAdornment position="end"><CircularProgress size={15} /></InputAdornment> : undefined,
            }}
          />
        </Box>

        <Box sx={{ maxHeight: "min(64vh, 520px)", overflowY: "auto", p: 1 }}>
          {!ql && (
            <Typography variant="body2" color="text.secondary" sx={{ p: 2, textAlign: "center" }}>
              Search across <b>people, posts, groups, chatrooms</b> and <b>radio</b> — all in one place.
            </Typography>
          )}
          {ql && total === 0 && !loadingSt && (
            <Typography variant="body2" color="text.secondary" sx={{ p: 2, textAlign: "center" }}>No matches for “{q.trim()}”.</Typography>
          )}
          {sections.map((sec) => (
            <Box key={sec.label} sx={{ mb: 0.5 }}>
              <Typography variant="overline" color="text.secondary" sx={{ px: 1.25 }}>{sec.label}</Typography>
              {sec.rows.map((row, i) => (
                <Stack
                  key={i} direction="row" spacing={1.25} alignItems="center" onClick={row.onClick}
                  sx={{ px: 1.25, py: 0.85, borderRadius: 1.5, cursor: "pointer", "&:hover": { bgcolor: "rgba(58,155,240,0.10)" } }}
                >
                  <Box sx={{ width: 30, display: "flex", justifyContent: "center", color: "text.secondary", flex: "0 0 auto" }}>{row.icon}</Box>
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>{row.primary}</Typography>
                    {row.secondary && <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>{row.secondary}</Typography>}
                  </Box>
                </Stack>
              ))}
            </Box>
          ))}
        </Box>
      </Dialog>
    </>
  );
}
