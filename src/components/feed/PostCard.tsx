import { useState, useEffect, useRef } from "react";
import { Stack, Box, Typography, IconButton, Chip, Popover, Tooltip, TextField, Button } from "@mui/material";
import AddReactionRoundedIcon from "@mui/icons-material/AddReactionRounded";
import VerifiedRoundedIcon from "@mui/icons-material/VerifiedRounded";
import ReplyRoundedIcon from "@mui/icons-material/ReplyRounded";
import ChatBubbleOutlineRoundedIcon from "@mui/icons-material/ChatBubbleOutlineRounded";
import AddReactionOutlinedIcon from "@mui/icons-material/AddReactionOutlined";
import AutoAwesomeRoundedIcon from "@mui/icons-material/AutoAwesomeRounded";
import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";
import PauseRoundedIcon from "@mui/icons-material/PauseRounded";
import MoreVertRoundedIcon from "@mui/icons-material/MoreVertRounded";
import GavelRoundedIcon from "@mui/icons-material/GavelRounded";
import ImageRoundedIcon from "@mui/icons-material/ImageRounded";
import GifBoxRoundedIcon from "@mui/icons-material/GifBoxRounded";
import { Menu, MenuItem, LinearProgress } from "@mui/material";
import { linkPreviewService, type Preview } from "@/services/linkPreviewService";
import { trustService } from "@/services/trustService";
import { audioPlayerService } from "@/services/audioPlayerService";
import { watchRoomService } from "@/services/watchRoomService";
import { companionService } from "@/services/companionService";
import { factCheckService, type FactCheck } from "@/services/factCheckService";
import FactCheckRoundedIcon from "@mui/icons-material/FactCheckRounded";
import ReportProblemRoundedIcon from "@mui/icons-material/ReportProblemRounded";
import { emojify } from "@/lib/emoticons";
import { compressPostImage } from "@/lib/image";
import GifPicker from "@/components/common/GifPicker";
import { bus, toast } from "@/lib/events";
import { newId } from "@/lib/id";
import type { ModerationVerdict, MediaRef } from "@/types";
import GlassCard from "@/components/common/GlassCard";
import WhyRecommended from "./WhyRecommended";
import UserAvatar from "@/components/common/UserAvatar";
import { relativeTime } from "@/lib/time";
import { feedService } from "@/services/feedService";
import { peerService } from "@/services/peerService";
import { useNavigate } from "react-router-dom";
import { useStore } from "@/store/useStore";
import type { Post, RecommendationReason } from "@/types";

const REACTIONS = ["⭐", "🔥", "🚀", "💜", "😂", "👀", "👎", "😠"];

const YT_RE = /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/i;
const IMG_RE = /\.(png|jpe?g|gif|webp|avif|bmp|svg)(\?[^\s]*)?$/i;
// Spotify share links: track / album / playlist / episode / show.
const SPOTIFY_RE = /open\.spotify\.com\/(?:intl-[a-z]+\/)?(track|album|playlist|episode|show|artist)\/([A-Za-z0-9]+)/i;
function firstYouTube(text: string): string | null { return text.match(YT_RE)?.[1] ?? null; }
function firstSpotify(text: string): { kind: string; id: string } | null {
  const m = text.match(SPOTIFY_RE);
  return m ? { kind: m[1].toLowerCase(), id: m[2] } : null;
}
function firstLink(text: string): string | null {
  const urls = text.match(/https?:\/\/[^\s]+/g) ?? [];
  return urls.find((u) => !IMG_RE.test(u) && !YT_RE.test(u) && !SPOTIFY_RE.test(u)) ?? null;
}

// Spotify — click to activate, then the global Spotify player owns the embed so
// it persists into a floating mini player when you scroll away (its own
// controls let you pause). Activating it stops any other playing media.
function SpotifyCard({ kind, id }: { kind: string; id: string }) {
  const tall = kind === "playlist" || kind === "album" || kind === "show";
  const dockId = useRef("spd-" + newId());
  const [active, setActive] = useState(false);
  useEffect(() => {
    const off = bus.on("spotify:play", ({ dockId: d }) => { if (d !== dockId.current) setActive(false); });
    // Revert to the overlay when any non-Spotify source takes over (mp3, video…).
    const offMedia = bus.on("media:play", ({ id }) => { if (id !== "spotify") setActive(false); });
    return () => { off(); offMedia(); };
  }, []);
  const start = () => { setActive(true); bus.emit("spotify:play", { embedUrl: `https://open.spotify.com/embed/${kind}/${id}?utm_source=zuccbook`, dockId: dockId.current }); };
  return (
    <Box sx={{ mt: 1, position: "relative", height: tall ? 380 : 80, borderRadius: 1.5, overflow: "hidden", border: "1px solid var(--bl-line)" }}>
      {active ? (
        <Box id={dockId.current} sx={{ position: "absolute", inset: 0 }} />
      ) : (
        <Box onClick={start} sx={{ position: "absolute", inset: 0, cursor: "pointer", display: "flex", alignItems: "center", gap: 1.5, px: 2, color: "#fff", background: "linear-gradient(135deg,#1db954,#0a7d35)" }}>
          <Box sx={{ width: 44, height: 44, borderRadius: "50%", bgcolor: "rgba(0,0,0,0.25)", display: "grid", placeItems: "center" }}><PlayArrowRoundedIcon /></Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontWeight: 800 }} noWrap>Play on Spotify</Typography>
            <Typography variant="caption" sx={{ opacity: 0.85 }}>{kind} · keeps playing in a mini player as you scroll</Typography>
          </Box>
        </Box>
      )}
    </Box>
  );
}

// Optional PolitiFact fact-check context for RSS-Bot stories. Matched locally
// against PolitiFact's recent ratings; only shown on a confident keyword hit.
const RULING_COLOR: Record<string, string> = {
  "true": "#2f9e44", "mostly true": "#5cb85c", "half true": "#e8920c",
  "mostly false": "#e8590c", "barely true": "#e8590c", "false": "#d23b2f", "pants on fire": "#a8071a",
};
function FactCheckCard({ fc, postId, title, onChange }: { fc: FactCheck; postId: string; title: string; onChange: (fc: FactCheck | null) => void }) {
  const [checking, setChecking] = useState(false);
  const color = (fc.ruling && RULING_COLOR[fc.ruling]) || "#51606e";
  // "Is this in error?" — re-derive keywords on the user's device and re-search
  // PolitiFact. Same article → keep; a closer one → update; nothing → remove.
  async function recheck() {
    setChecking(true);
    toast("Re-checking on your device ⚡ (thanks for the compute!)", "info");
    const { keywords } = await companionService.keywords(title);
    const found = factCheckService.searchByKeywords(keywords);
    setChecking(false);
    if (found) { await factCheckService.setFor(postId, found); onChange(found); toast(found.link === fc.link ? "Confirmed — still the best match." : "Updated to a closer fact-check.", "success"); }
    else { await factCheckService.removeFor(postId); onChange(null); toast("No current PolitiFact match — removed.", "info"); }
  }
  return (
    <Box sx={{ mt: 1, p: 1, borderRadius: 1.5, border: `1px solid ${color}55`, bgcolor: `${color}10` }}>
      <Stack direction="row" alignItems="center" spacing={1}>
        <FactCheckRoundedIcon sx={{ color, fontSize: 18 }} />
        <Typography variant="caption" sx={{ fontWeight: 800, color, flex: 1 }}>Fact check · PolitiFact</Typography>
        {fc.ruling && <Chip size="small" label={fc.ruling} sx={{ height: 18, fontSize: 10, textTransform: "capitalize", bgcolor: color, color: "#fff", fontWeight: 700 }} />}
      </Stack>
      <Box component="a" href={fc.link} target="_blank" rel="noopener noreferrer" sx={{ textDecoration: "none", color: "inherit" }}>
        <Typography variant="body2" sx={{ mt: 0.5, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{fc.claim}</Typography>
      </Box>
      <Button size="small" startIcon={<ReportProblemRoundedIcon fontSize="small" />} disabled={checking} onClick={recheck} sx={{ mt: 0.5, color: "text.secondary" }}>
        {checking ? "Checking…" : "Is this in error?"}
      </Button>
    </Box>
  );
}

// A shared mp3 attached to a post/reply. Tapping plays it in the global audio
// bar (play/pause/seek/volume), which persists across scroll and navigation.
function AudioCard({ url, title }: { url: string; title: string }) {
  const [playing, setPlaying] = useState(audioPlayerService.isCurrent(url) && audioPlayerService.playing);
  useEffect(() => bus.on("audio:now", (s) => setPlaying(s.url === url && s.playing)), [url]);
  const toggle = () => { if (audioPlayerService.isCurrent(url)) audioPlayerService.toggle(); else audioPlayerService.play({ url, title }); };
  return (
    <Box onClick={toggle} sx={{ mt: 1, p: 1, display: "flex", alignItems: "center", gap: 1.5, borderRadius: 1.5, border: "1px solid var(--bl-line)", bgcolor: "var(--bl-white)", cursor: "pointer" }}>
      <Box sx={{ width: 40, height: 40, flex: "0 0 auto", borderRadius: 1.5, display: "grid", placeItems: "center", color: "#fff", background: "linear-gradient(135deg,#7c5cff,#4a1fd0)" }}>
        {playing ? <PauseRoundedIcon /> : <PlayArrowRoundedIcon />}
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2" sx={{ fontWeight: 700 }} noWrap>{title || "Audio track"}</Typography>
        <Typography variant="caption" color="text.secondary">{playing ? "Playing — controls in the bottom bar" : "Tap to play · mp3"}</Typography>
      </Box>
    </Box>
  );
}

// Click-to-play YouTube card. The thumbnail is derived from the video id
// (always valid) with an <img> + onError fallback, rather than trusting the
// RSS feed's media URL which is sometimes not an image.
function YouTubeCard({ id }: { id: string }) {
  // When playing, the global feed-video player docks into #dockId; on scroll
  // away it floats as a bottom-right mini player and keeps playing.
  const dockId = useRef("ytd-" + newId());
  const [active, setActive] = useState(false);
  useEffect(() => {
    const off = bus.on("feedvideo:play", ({ dockId: d }) => { if (d !== dockId.current) setActive(false); });
    const offMedia = bus.on("media:play", ({ id }) => { if (id !== "feedvideo") setActive(false); });
    return () => { off(); offMedia(); };
  }, []);
  const start = () => { setActive(true); bus.emit("feedvideo:play", { videoId: id, dockId: dockId.current }); };
  const watchTogether = () => {
    watchRoomService.set(watchRoomService.forVideo(id));  // open a room for this video
    bus.emit("watch:start", { videoId: id });             // start it in that room
    bus.emit("media:play", { id: "watch" });              // pause the feed player
    setActive(false);
    window.location.hash = "#/listen";                    // open Watch with friends
    toast("Opened a watch room — share it so friends can join 🍿", "success");
  };
  return (
    <Box sx={{ mt: 1 }}>
      <Box sx={{ position: "relative", pt: "56.25%", borderRadius: 1, overflow: "hidden", border: "1px solid var(--bl-line)", bgcolor: "#000" }}>
        {active ? (
          // The global player positions itself over this slot.
          <Box id={dockId.current} sx={{ position: "absolute", inset: 0 }} />
        ) : (
          <Box onClick={start} sx={{ position: "absolute", inset: 0, cursor: "pointer" }}>
            <Box component="img" src={`https://i.ytimg.com/vi/${id}/hqdefault.jpg`} alt="" loading="lazy"
              onError={(e) => { const t = e.currentTarget as HTMLImageElement; if (!t.dataset.fb) { t.dataset.fb = "1"; t.src = `https://i.ytimg.com/vi/${id}/mqdefault.jpg`; } }}
              sx={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
            <Box sx={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
              <Box sx={{ width: 64, height: 46, borderRadius: 2, bgcolor: "rgba(0,0,0,0.72)", display: "grid", placeItems: "center" }}><PlayArrowRoundedIcon sx={{ color: "#fff", fontSize: 36 }} /></Box>
            </Box>
          </Box>
        )}
      </Box>
      <Button size="small" startIcon={<span style={{ fontSize: 15 }}>🍿</span>} onClick={watchTogether} sx={{ mt: 0.5, color: "text.secondary" }}>
        Watch with friends
      </Button>
    </Box>
  );
}

// Open-Graph link preview card for any shared link.
function LinkCard({ url }: { url: string }) {
  const [d, setD] = useState<Preview | null>(null);
  useEffect(() => { let on = true; linkPreviewService.preview(url).then((p) => on && setD(p)).catch(() => {}); return () => { on = false; }; }, [url]);
  let host = url; try { host = new URL(url).hostname.replace(/^www\./, ""); } catch {}
  return (
    <Box component="a" href={url} target="_blank" rel="noopener noreferrer" sx={{ display: "block", mt: 1.25, border: "1px solid var(--bl-line)", borderRadius: 2.5, overflow: "hidden", textDecoration: "none", color: "inherit", bgcolor: "var(--bl-white)", transition: "background .15s ease", "&:hover": { bgcolor: "rgba(58,155,240,0.04)" } }}>
      {d?.image && <Box component="img" src={d.image} loading="lazy" sx={{ width: "100%", maxHeight: 260, objectFit: "cover", display: "block" }} />}
      <Box sx={{ p: 1.25 }}>
        <Typography variant="caption" sx={{ color: "text.secondary", textTransform: "uppercase", letterSpacing: 0.4, fontSize: 11 }}>{d?.site || host}</Typography>
        <Typography variant="body2" sx={{ fontWeight: 700, lineHeight: 1.3, mt: 0.25, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{d?.title || host}</Typography>
        {d?.description && <Typography variant="caption" color="text.secondary" sx={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", mt: 0.25 }}>{d.description}</Typography>}
      </Box>
    </Box>
  );
}

// Render text with clickable links. Direct image links (incl. Tenor GIFs) are
// rendered inline as images; non-link spans get emoticons translated to emoji.
function renderText(text: string) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return parts.map((p, i) => {
    if (/^https?:\/\//.test(p)) {
      if (IMG_RE.test(p)) {
        return <Box key={i} component="a" href={p} target="_blank" rel="noopener noreferrer" sx={{ display: "block" }}>
          <Box component="img" src={p} loading="lazy" sx={{ display: "block", mt: 0.5, maxWidth: "100%", maxHeight: 320, borderRadius: 1.5, border: "1px solid var(--bl-line)" }} />
        </Box>;
      }
      return <a key={i} href={p} target="_blank" rel="noopener noreferrer" style={{ color: "#0a55cf", wordBreak: "break-all" }}>{p}</a>;
    }
    return <span key={i}>{emojify(p)}</span>;
  });
}

// A reply composer (text + image + GIF) reused at every nesting level.
function ReplyComposer({ parentId, placeholder, autoFocus, onPosted }: { parentId: string; placeholder: string; autoFocus?: boolean; onPosted?: () => void }) {
  const [text, setText] = useState("");
  const [media, setMedia] = useState<MediaRef[]>([]);
  const [gifOpen, setGifOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  async function attach(file?: File) {
    if (!file) return;
    const url = await compressPostImage(file);   // keep it small so it persists/syncs
    setMedia((m) => [...m, { type: "image", url, mime: file.type === "image/gif" ? "image/gif" : "image/jpeg", bytes: url.length }]);
  }
  async function send() {
    const t = text.trim();
    if (!t && !media.length) return;
    const p = await feedService.createPost({ text: t, replyTo: parentId, media: media.length ? media : undefined });
    peerService.publishPost(p);
    setText(""); setMedia([]);
    onPosted?.();
  }
  return (
    <Box sx={{ mt: 1 }}>
      {media.length > 0 && (
        <Stack direction="row" spacing={1} sx={{ mb: 1, flexWrap: "wrap" }}>
          {media.map((m, i) => <Box key={i} component="img" src={m.url} onClick={() => setMedia((x) => x.filter((_, j) => j !== i))} sx={{ width: 64, height: 64, objectFit: "cover", borderRadius: 1.5, cursor: "pointer", border: "1px solid var(--bl-line)" }} />)}
        </Stack>
      )}
      <Stack direction="row" spacing={0.5} alignItems="center">
        <Tooltip title="Attach image"><IconButton size="small" onClick={() => fileRef.current?.click()}><ImageRoundedIcon fontSize="small" /></IconButton></Tooltip>
        <Tooltip title="Add a GIF"><IconButton size="small" onClick={() => setGifOpen(true)}><GifBoxRoundedIcon fontSize="small" /></IconButton></Tooltip>
        <TextField fullWidth size="small" autoFocus={autoFocus} placeholder={placeholder} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") send(); }} />
        <Button variant="contained" size="small" onClick={send} disabled={!text.trim() && !media.length}>Reply</Button>
      </Stack>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => attach(e.target.files?.[0])} />
      <GifPicker open={gifOpen} onClose={() => setGifOpen(false)} onPick={(url) => setMedia((m) => [...m, { type: "image", url, mime: "image/gif" }])} />
    </Box>
  );
}

// A single reply, recursively rendering its own sub-replies. Supports likes
// (reactions) and replying at any depth.
function ReplyNode({ reply, replyMap, mePk, onReact, depth }: { reply: Post; replyMap: Map<string, Post[]>; mePk: string; onReact: (el: HTMLElement, id: string) => void; depth: number }) {
  const [showBox, setShowBox] = useState(false);
  const children = replyMap.get(reply.id) ?? [];
  return (
    <Box sx={{ mb: 1 }}>
      <Stack direction="row" spacing={1}>
        <UserAvatar pk={reply.author} name={reply.authorName} avatar={reply.authorAvatar} size={26} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={0.5} alignItems="center">
            <Typography variant="body2" sx={{ fontWeight: 700 }} noWrap>{reply.authorName}</Typography>
            <Typography variant="caption" color="text.secondary">· {relativeTime(reply.createdAt)}</Typography>
          </Stack>
          {reply.text && <Typography component="div" variant="body2" sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{renderText(reply.text)}</Typography>}
          {reply.media?.map((m, i) => m.type === "image"
            ? <Box key={i} component="img" src={m.url} loading="lazy" sx={{ mt: 0.5, maxWidth: "100%", maxHeight: 240, borderRadius: 1.5, border: "1px solid var(--bl-line)" }} />
            : m.type === "audio" ? <AudioCard key={i} url={m.url} title={m.alt || "Audio track"} /> : null)}
          <Stack direction="row" alignItems="center" spacing={1}>
            <Box sx={{ flex: 1 }}><ReactRow post={reply} me={mePk} onAdd={onReact} /></Box>
            <Button size="small" startIcon={<ReplyRoundedIcon fontSize="small" />} onClick={() => setShowBox((v) => !v)} sx={{ color: "text.secondary", flex: "0 0 auto" }}>
              {children.length ? `${children.length} ` : ""}Reply
            </Button>
          </Stack>
          {showBox && <ReplyComposer parentId={reply.id} autoFocus placeholder={`Reply to ${reply.authorName}…`} onPosted={() => setShowBox(false)} />}
          {children.length > 0 && (
            <Box sx={{ mt: 1, pl: depth < 4 ? 1.5 : 0, borderLeft: depth < 4 ? "2px solid rgba(58,155,240,0.2)" : "none" }}>
              {children.map((c) => <ReplyNode key={c.id} reply={c} replyMap={replyMap} mePk={mePk} onReact={onReact} depth={depth + 1} />)}
            </Box>
          )}
        </Box>
      </Stack>
    </Box>
  );
}

function ReactRow({ post, me, onAdd }: { post: Post; me: string; onAdd: (el: HTMLElement, id: string) => void }) {
  return (
    <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mt: 1, flexWrap: "wrap", gap: 0.5 }}>
      {Object.entries(post.reactions).filter(([, v]) => v.length).map(([emoji, voters]) => (
        <Chip key={emoji} size="small" label={`${emoji} ${voters.length}`} onClick={() => feedService.react(post.id, emoji)}
          sx={{ bgcolor: voters.includes(me) ? "rgba(58,155,240,0.2)" : "rgba(0,0,0,0.04)", cursor: "pointer" }} />
      ))}
      <IconButton size="small" onClick={(e) => onAdd(e.currentTarget, post.id)}><AddReactionRoundedIcon fontSize="small" /></IconButton>
    </Stack>
  );
}

// Transparency popover — the moderation verdict, its signals and confidence.
function ModInfo({ verdict }: { verdict: ModerationVerdict }) {
  const [a, setA] = useState<HTMLElement | null>(null);
  const color = verdict.action === "flag" ? "#d23b2f" : verdict.action === "reduce" || verdict.action === "review" ? "#e8920c" : "#51606e";
  return (
    <>
      <Chip size="small" variant="outlined" icon={<GavelRoundedIcon />} label={verdict.action} onClick={(e) => setA(e.currentTarget)} sx={{ height: 20, fontSize: 10, color, borderColor: color, cursor: "pointer" }} />
      <Popover open={!!a} anchorEl={a} onClose={() => setA(null)} anchorOrigin={{ vertical: "bottom", horizontal: "right" }} transformOrigin={{ vertical: "top", horizontal: "right" }}>
        <Box sx={{ p: 1.5, width: 300 }}>
          <Typography variant="subtitle2">Moderation · {verdict.action}</Typography>
          <Typography variant="caption" color="text.secondary">{verdict.reasoning} — {Math.round(verdict.confidence * 100)}% confidence · advisory, you decide.</Typography>
          <Stack spacing={0.75} sx={{ mt: 1 }}>
            {verdict.signals.slice(0, 6).map((s, i) => (
              <Box key={i}>
                <Stack direction="row" justifyContent="space-between"><Typography variant="caption">{s.label}{s.detail ? ` — ${s.detail}` : ""}</Typography><Typography variant="caption" sx={{ color: s.weight < 0 ? "success.main" : "text.secondary" }}>{s.weight >= 0 ? "+" : ""}{s.weight.toFixed(2)}</Typography></Stack>
                <LinearProgress variant="determinate" value={Math.min(100, Math.abs(s.weight) * 80)} sx={{ height: 4, borderRadius: 2, opacity: s.weight < 0 ? 0.5 : 1 }} />
              </Box>
            ))}
          </Stack>
        </Box>
      </Popover>
    </>
  );
}

export default function PostCard({ post, reason, replies = [], replyMap, verdict }: { post: Post; reason?: RecommendationReason; replies?: Post[]; replyMap?: Map<string, Post[]>; verdict?: ModerationVerdict }) {
  const me = useStore((s) => s.me);
  const mePk = me?.publicKey ?? "";
  const showFactChecks = useStore((s) => s.settings.showFactChecks);
  const nav = useNavigate();
  const canVisit = !!post.author && post.author !== "rss-bot" && post.author !== "system" && !post.author.startsWith("demo_");
  const visit = () => canVisit && nav(`/u/${post.author}`);
  const [react, setReact] = useState<{ el: HTMLElement; id: string } | null>(null);
  const [showReplies, setShowReplies] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [authMenu, setAuthMenu] = useState<HTMLElement | null>(null);
  const [factCheck, setFactCheck] = useState<FactCheck | null>(() => factCheckService.getFor(post.id));
  const [fcBusy, setFcBusy] = useState(false);
  const restricted = !!verdict && (verdict.action === "reduce" || verdict.action === "review" || verdict.action === "flag");
  const childMap = replyMap ?? new Map<string, Post[]>();

  // User-triggered fact-check: derive keywords on-device (their compute), search PolitiFact.
  async function runFactCheck() {
    setFcBusy(true);
    const headline = (post.text ?? "").split("\n")[0] || (post.text ?? "");
    toast("Deriving keywords on your device & checking PolitiFact ⚡", "info");
    const { keywords, usedLLM } = await companionService.keywords(headline);
    const found = factCheckService.searchByKeywords(keywords);
    setFcBusy(false);
    if (found) { await factCheckService.setFor(post.id, found); setFactCheck(found); toast(`Fact-check linked${usedLLM ? " (AI-assisted)" : ""}. Thanks for contributing compute!`, "success"); }
    else toast("No relevant PolitiFact fact-check found.", "info");
  }

  // Hand the post (with its reactions + comments) to the on-device Companion.
  function askCompanion() {
    const reactions = Object.entries(post.reactions).filter(([, v]) => v.length).map(([e, v]) => `${e}×${v.length}`).join(", ");
    const comments = replies.slice(0, 6).map((r) => `- ${r.authorName}: ${(r.text ?? "").slice(0, 200)}`).join("\n");
    const prompt = [
      "Give me your honest, brief take on this post.",
      "",
      `${post.authorName} posted: "${(post.text ?? "").slice(0, 700)}"`,
      reactions ? `Reactions so far: ${reactions}` : "",
      comments ? `Comments:\n${comments}` : "",
      "",
      "What do you make of it — and what do the reactions/comments say about how it's landing?",
    ].filter(Boolean).join("\n");
    bus.emit("companion:prompt", { text: prompt });
    toast("Asked your Companion to weigh in 🤖", "info");
  }

  async function trust(kind: "vouch" | "report" | "mute") {
    setAuthMenu(null);
    await trustService[kind](post.author);
    toast(kind === "vouch" ? `Vouched for ${post.authorName}` : kind === "mute" ? `Muted ${post.authorName}` : `Reported ${post.authorName}`, kind === "vouch" ? "success" : "info");
    bus.emit("feed:updated", undefined); // re-evaluate the feed with the new trust signal
  }

  return (
    <GlassCard id={`post-${post.id}`} sx={{ mb: 1.5, p: { xs: 1.5, sm: 2 }, scrollMarginTop: 70, transition: "box-shadow .25s ease, border-color .25s ease", "&:hover": { boxShadow: "0 4px 18px rgba(20,40,80,0.08)" }, "&.zb-focus": { boxShadow: "0 0 0 3px rgba(58,155,240,0.7)" } }}>
      <Stack direction="row" spacing={1.25}>
        <Box onClick={visit} sx={{ cursor: canVisit ? "pointer" : "default", flex: "0 0 auto" }}>
          <UserAvatar pk={post.author} name={post.authorName} avatar={post.authorAvatar} size={44} />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {/* identity line — name + badge, with a muted meta subline underneath */}
          <Stack direction="row" alignItems="flex-start" spacing={0.5}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Stack direction="row" alignItems="center" spacing={0.5}>
                <Typography onClick={visit} sx={{ fontWeight: 700, fontSize: 15, lineHeight: 1.2, cursor: canVisit ? "pointer" : "default", "&:hover": canVisit ? { textDecoration: "underline" } : {} }} noWrap>{post.authorName}</Typography>
                {post.author === "rss-bot"
                  ? <Chip size="small" label="BOT" sx={{ height: 15, fontSize: 9, fontWeight: 700, "& .MuiChip-label": { px: 0.6 }, bgcolor: "rgba(58,123,240,0.14)", color: "#0a55cf" }} />
                  : <Tooltip title="Cryptographically signed by author"><VerifiedRoundedIcon sx={{ fontSize: 15, color: "#3f97ff" }} /></Tooltip>}
                {verdict && verdict.action !== "allow" && <ModInfo verdict={verdict} />}
              </Stack>
              <Tooltip title={new Date(post.createdAt).toLocaleString()} placement="bottom-start">
                <Typography component="span" variant="caption" color="text.secondary" sx={{ display: "inline-block", lineHeight: 1.3, fontSize: 12 }}>
                  {relativeTime(post.createdAt)}{post.author === "rss-bot" && post.tags[0] ? ` · #${post.tags[0]}` : ""}
                </Typography>
              </Tooltip>
            </Box>
            <WhyRecommended reason={reason} />
            <IconButton size="small" sx={{ mt: -0.25, color: "text.disabled" }} onClick={(e) => setAuthMenu(e.currentTarget)}><MoreVertRoundedIcon fontSize="small" /></IconButton>
          </Stack>

          {restricted && !revealed && (
            <Box sx={{ mt: 1, p: 1.5, borderRadius: 1, bgcolor: "rgba(232,146,12,0.08)", border: "1px solid rgba(232,146,12,0.45)" }}>
              <Typography variant="body2"><b>{verdict!.action === "flag" ? "Flagged" : verdict!.action === "review" ? "Pending community review" : "Reduced"}</b> — {verdict!.reasoning}</Typography>
              <Typography variant="caption" color="text.secondary">Advisory · {Math.round(verdict!.confidence * 100)}% confidence · the network didn't delete it — you decide.</Typography>
              <Box><Button size="small" sx={{ mt: 0.5 }} onClick={() => setRevealed(true)}>Show anyway</Button></Box>
            </Box>
          )}

          {(!restricted || revealed) && (<>
          {post.text && <Typography component="div" sx={{ mt: 1, fontSize: 15, lineHeight: 1.55, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{renderText(post.text)}</Typography>}

          {(() => {
            const ytId = firstYouTube(post.text ?? "");
            const spotify = ytId ? null : firstSpotify(post.text ?? "");
            const linkUrl = ytId || spotify ? null : firstLink(post.text ?? "");
            if (ytId) return <YouTubeCard id={ytId} />;
            if (spotify) return <SpotifyCard kind={spotify.kind} id={spotify.id} />;
            if (linkUrl) return <LinkCard url={linkUrl} />;
            // uploaded images (no link in text)
            return post.media?.map((m, i) => (m.type === "image" ? <Box key={i} component="img" src={m.url} sx={{ mt: 1, maxWidth: "100%", maxHeight: 360, borderRadius: 2, border: "1px solid var(--bl-line)" }} /> : null));
          })()}

          {post.media?.filter((m) => m.type === "audio").map((m, i) => <AudioCard key={i} url={m.url} title={m.alt || "Audio track"} />)}

          {showFactChecks && factCheck && <FactCheckCard fc={factCheck} postId={post.id} title={(post.text ?? "").split("\n")[0]} onChange={setFactCheck} />}

          {post.poll && (
            <Stack spacing={0.5} sx={{ mt: 1 }}>
              <Typography variant="subtitle2">{post.poll.question}</Typography>
              {post.poll.options.map((o) => (
                <Box key={o.id} sx={{ px: 1.5, py: 0.75, borderRadius: 1.5, border: "1px solid rgba(58,155,240,0.2)" }}>
                  <Typography variant="body2">{o.label} · {o.votes.length}</Typography>
                </Box>
              ))}
            </Stack>
          )}

          {/* hashtags — understated inline links, not loud chips */}
          {post.author !== "rss-bot" && post.tags.length > 0 && (
            <Box sx={{ mt: 0.75, display: "flex", flexWrap: "wrap", gap: 1 }}>
              {post.tags.map((t) => <Typography key={t} component="span" variant="body2" sx={{ color: "#3f7bd0", fontWeight: 600, cursor: "pointer", "&:hover": { textDecoration: "underline" } }}>#{t}</Typography>)}
            </Box>
          )}

          </>)}
        </Box>
      </Stack>

      {/* full-width footer — reaction summary, action bar & comments span the whole card */}
      {(!restricted || revealed) && (
        <Box sx={{ mt: 1 }}>
          {Object.values(post.reactions).some((v) => v.length) && (
            <Box sx={{ mb: 1, display: "flex", flexWrap: "wrap", gap: 0.5 }}>
              {Object.entries(post.reactions).filter(([, v]) => v.length).map(([emoji, voters]) => (
                <Chip key={emoji} size="small" label={`${emoji} ${voters.length}`} onClick={() => feedService.react(post.id, emoji)}
                  sx={{ height: 26, fontSize: 13, cursor: "pointer", border: voters.includes(mePk) ? "1px solid rgba(58,155,240,0.5)" : "1px solid transparent",
                    bgcolor: voters.includes(mePk) ? "rgba(58,155,240,0.14)" : "rgba(0,0,0,0.045)", "& .MuiChip-label": { px: 1 }, "&:hover": { bgcolor: "rgba(58,155,240,0.12)" } }} />
              ))}
            </Box>
          )}

          {/* action bar — clean, evenly split, hover-highlighted (Twitter × Facebook) */}
          <Stack direction="row" spacing={0.5} sx={{ pt: 0.75, borderTop: "1px solid var(--bl-line)" }}>
            <Button fullWidth disableRipple onClick={(e) => setReact({ el: e.currentTarget, id: post.id })}
              startIcon={<AddReactionOutlinedIcon sx={{ fontSize: 19 }} />}
              sx={{ flex: 1, color: "text.secondary", fontWeight: 600, fontSize: 13.5, textTransform: "none", py: 0.7, borderRadius: 2, "&:hover": { bgcolor: "rgba(58,155,240,0.09)", color: "#1668e0" } }}>
              React
            </Button>
            <Button fullWidth disableRipple onClick={() => setShowReplies((v) => !v)}
              startIcon={<ChatBubbleOutlineRoundedIcon sx={{ fontSize: 18 }} />}
              sx={{ flex: 1, color: showReplies ? "#1668e0" : "text.secondary", fontWeight: 600, fontSize: 13.5, textTransform: "none", py: 0.7, borderRadius: 2, "&:hover": { bgcolor: "rgba(58,155,240,0.09)", color: "#1668e0" } }}>
              {replies.length ? `${replies.length} ${replies.length === 1 ? "Comment" : "Comments"}` : "Comment"}
            </Button>
            <Button fullWidth disableRipple onClick={askCompanion}
              startIcon={<AutoAwesomeRoundedIcon sx={{ fontSize: 17 }} />}
              sx={{ flex: 1, color: "text.secondary", fontWeight: 600, fontSize: 13.5, textTransform: "none", py: 0.7, borderRadius: 2, "&:hover": { bgcolor: "rgba(124,92,255,0.1)", color: "#6a43d8" } }}>
              Ask AI
            </Button>
          </Stack>

          {showReplies && (
            <Box sx={{ mt: 1, pl: 2, borderLeft: "2px solid rgba(58,155,240,0.25)" }}>
              {replies.map((r) => (
                <ReplyNode key={r.id} reply={r} replyMap={childMap} mePk={mePk} onReact={(el, id) => setReact({ el, id })} depth={0} />
              ))}
              <ReplyComposer parentId={post.id} placeholder={`Reply to ${post.authorName}…`} />
            </Box>
          )}
        </Box>
      )}

      <Menu open={!!authMenu} anchorEl={authMenu} onClose={() => setAuthMenu(null)}>
        {showFactChecks && !factCheck && <MenuItem disabled={fcBusy} onClick={() => { setAuthMenu(null); runFactCheck(); }}>🔎 {fcBusy ? "Checking…" : "Fact-check this"}</MenuItem>}
        {canVisit && <MenuItem onClick={() => trust("vouch")}>🤝 Vouch for {post.authorName}</MenuItem>}
        {canVisit && <MenuItem onClick={() => trust("report")}>🚩 Report</MenuItem>}
        {canVisit && <MenuItem onClick={() => trust("mute")}>🔇 Mute — hide from your feed</MenuItem>}
        {canVisit && <MenuItem onClick={() => { setAuthMenu(null); visit(); }}>👤 View profile</MenuItem>}
      </Menu>

      <Popover open={!!react} anchorEl={react?.el} onClose={() => setReact(null)}>
        <Stack direction="row" sx={{ p: 1 }}>
          {REACTIONS.map((e) => (
            <IconButton key={e} onClick={() => { if (react) feedService.react(react.id, e); setReact(null); }}>
              <span style={{ fontSize: 20 }}>{e}</span>
            </IconButton>
          ))}
        </Stack>
      </Popover>
    </GlassCard>
  );
}
