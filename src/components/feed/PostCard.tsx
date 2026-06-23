import { useState, useEffect, useRef, useMemo, Fragment, type ReactNode } from "react";
import { Stack, Box, Typography, IconButton, Chip, Popover, Tooltip, TextField, Button } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";
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
import TranslateRoundedIcon from "@mui/icons-material/TranslateRounded";
import { translateService, langName, probablyNotEnglish } from "@/services/translateService";
import { emojify } from "@/lib/emoticons";
import { isOff } from "@/lib/flags";
import { decodeEntities } from "@/lib/htmlEntities";
import { compressPostImage } from "@/lib/image";
import { nsfwService } from "@/services/nsfwService";
import { htmlPostDoc } from "./htmlPost";
import GifPicker from "@/components/common/GifPicker";
import { bus, toast } from "@/lib/events";
import { newId } from "@/lib/id";
import type { ModerationVerdict, MediaRef } from "@/types";
import GlassCard from "@/components/common/GlassCard";
import WhyRecommended from "./WhyRecommended";
import UserAvatar from "@/components/common/UserAvatar";
import { relativeTime } from "@/lib/time";
import { feedService } from "@/services/feedService";
import { nostrService } from "@/services/nostrService";
import { peerService } from "@/services/peerService";
import { useNavigate } from "react-router-dom";
import { useStore } from "@/store/useStore";
import type { Post, RecommendationReason } from "@/types";

const REACTIONS = ["❤️", "🔥", "😂", "😮", "💀", "🏳️‍🌈", "👀", "👎", "😠"];

const YT_RE = /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/i;
const IMG_RE = /\.(png|jpe?g|gif|webp|avif|bmp|svg)(\?[^\s]*)?$/i;
// Spotify share links: track / album / playlist / episode / show.
const SPOTIFY_RE = /open\.spotify\.com\/(?:intl-[a-z]+\/)?(track|album|playlist|episode|show|artist)\/([A-Za-z0-9]+)/i;
const TIKTOK_RE = /https?:\/\/(?:www\.|m\.|vm\.|vt\.)?tiktok\.com\/[^\s]+/i;
function firstYouTube(text: string): string | null { return text.match(YT_RE)?.[1] ?? null; }
function firstSpotify(text: string): { kind: string; id: string } | null {
  const m = text.match(SPOTIFY_RE);
  return m ? { kind: m[1].toLowerCase(), id: m[2] } : null;
}
function firstTikTok(text: string): string | null {
  const u = (text.match(/https?:\/\/[^\s]+/g) ?? []).find((x) => TIKTOK_RE.test(x));
  return u ? u.replace(/[)\].,]+$/, "") : null;
}
export function firstLink(text: string): string | null {
  const urls = text.match(/https?:\/\/[^\s]+/g) ?? [];
  return urls.find((u) => !IMG_RE.test(u) && !YT_RE.test(u) && !SPOTIFY_RE.test(u) && !TIKTOK_RE.test(u)) ?? null;
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
  const start = () => { setActive(true); bus.emit("spotify:play", { embedUrl: `https://open.spotify.com/embed/${kind}/${id}?utm_source=ledger`, dockId: dockId.current }); };
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
function FactCheckCard({ fc, postId, text, onChange }: { fc: FactCheck; postId: string; text: string; onChange: (fc: FactCheck | null) => void }) {
  const [checking, setChecking] = useState(false);
  const color = (fc.ruling && RULING_COLOR[fc.ruling]) || "#51606e";
  // "Is this in error?" — re-run the on-device algorithmic match against the
  // latest PolitiFact index. Same article → keep; a closer one → update; nothing → remove.
  async function recheck() {
    setChecking(true);
    toast("Re-checking on your device ⚡ (local match — no AI)", "info");
    const found = await factCheckService.checkPost(text);
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

// A pure-HTML post. Rendered in a sandboxed iframe with NO same-origin access,
// so embeds (maps, games, custom markup) can run while being unable to read the
// user's keys/data. Expandable for taller content.
function HtmlCard({ html }: { html: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <Box sx={{ mt: 1, border: "1px solid var(--bl-line)", borderRadius: 2, overflow: "hidden", bgcolor: "#fff", position: "relative" }}>
      <Box component="iframe" title="HTML post" srcDoc={htmlPostDoc(html)}
        sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-modals allow-presentation"
        sx={{ width: "100%", height: expanded ? 640 : 320, border: 0, display: "block" }} />
      <Button size="small" onClick={() => setExpanded((v) => !v)}
        sx={{ position: "absolute", bottom: 6, right: 6, minWidth: 0, px: 1, py: 0.25, fontSize: 11, textTransform: "none", bgcolor: "rgba(255,255,255,0.9)", border: "1px solid var(--bl-line)", color: "text.secondary", "&:hover": { bgcolor: "#fff" } }}>
        {expanded ? "Collapse" : "Expand"}
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
    window.location.hash = "#/listen";                    // open Watch and listen
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
        Watch and listen
      </Button>
    </Box>
  );
}

// TikTok preview — vertical cover thumbnail via oEmbed, click opens TikTok.
function TikTokCard({ url }: { url: string }) {
  const [d, setD] = useState<Preview | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => { let on = true; linkPreviewService.tiktok(url).then((p) => on && setD(p)).catch(() => {}); return () => { on = false; }; }, [url]);
  return (
    <Box component="a" href={url} target="_blank" rel="noopener noreferrer" sx={{ display: "block", mt: 1.25, border: "1px solid var(--bl-line)", borderRadius: 2.5, overflow: "hidden", textDecoration: "none", color: "inherit", bgcolor: "var(--bl-white)", "&:hover": { bgcolor: "rgba(58,155,240,0.04)" } }}>
      <Box sx={{ position: "relative", bgcolor: "#000", display: "grid", placeItems: "center", minHeight: d?.image && !failed ? 0 : 160 }}>
        {d?.image && !failed && (
          <Box component="img" src={d.image} loading="lazy" onError={() => setFailed(true)}
            sx={{ width: "100%", maxHeight: 460, objectFit: "cover", display: "block" }} />
        )}
        <Box sx={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none" }}>
          <Box sx={{ width: 60, height: 60, borderRadius: "50%", bgcolor: "rgba(0,0,0,0.55)", display: "grid", placeItems: "center" }}>
            <PlayArrowRoundedIcon sx={{ color: "#fff", fontSize: 34 }} />
          </Box>
        </Box>
        <Chip size="small" label="TikTok" sx={{ position: "absolute", top: 8, left: 8, height: 20, fontWeight: 800, fontSize: 11, bgcolor: "rgba(0,0,0,0.7)", color: "#fff" }} />
      </Box>
      <Box sx={{ p: 1.25 }}>
        <Typography variant="caption" sx={{ color: "text.secondary", textTransform: "uppercase", letterSpacing: 0.4, fontSize: 11 }}>TikTok{d?.description ? ` · ${d.description}` : ""}</Typography>
        <Typography variant="body2" sx={{ fontWeight: 700, lineHeight: 1.3, mt: 0.25, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{d?.title || "Watch on TikTok"}</Typography>
      </Box>
    </Box>
  );
}

// Open-Graph link preview card for any shared link.
export function LinkCard({ url }: { url: string }) {
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

// An <img> that, when the on-device adult-content filter is on, is classified
// by nsfwjs and kept blurred until it's cleared — or, if flagged, until the
// viewer taps "view". The classification runs locally; the image never leaves
// the device. With the filter off it's just a plain image.
export function SafeImage({ src, alt, sx }: { src: string; alt?: string; sx?: SxProps<Theme> }) {
  const filter = useStore((s) => s.settings.filterNsfw);
  const [status, setStatus] = useState<"ok" | "checking" | "nsfw">(filter ? "checking" : "ok");
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    if (!filter) { setStatus("ok"); return; }
    let on = true;
    setStatus("checking");
    nsfwService.isAdultImage(src).then((bad) => { if (on) setStatus(bad ? "nsfw" : "ok"); }).catch(() => { if (on) setStatus("ok"); });
    return () => { on = false; };
  }, [src, filter]);
  const blurred = filter && !revealed && status !== "ok";
  return (
    <Box sx={{ position: "relative", display: "inline-block", maxWidth: "100%", lineHeight: 0 }}>
      <Box component="img" src={src} alt={alt} loading="lazy" sx={{ ...sx, filter: blurred ? "blur(26px)" : "none", transition: "filter .25s ease" }} />
      {blurred && (
        <Box onClick={() => { if (status === "nsfw") setRevealed(true); }}
          sx={{ position: "absolute", inset: 0, borderRadius: 1.5, display: "grid", placeItems: "center", textAlign: "center", p: 1, color: "#fff", background: "rgba(0,0,0,0.32)", cursor: status === "nsfw" ? "pointer" : "default" }}>
          {status === "checking"
            ? <Typography variant="caption" sx={{ fontWeight: 700 }}>Scanning image…</Typography>
            : <Box><Typography variant="caption" sx={{ fontWeight: 800, display: "block" }}>Sensitive content</Typography><Typography variant="caption" sx={{ opacity: 0.85 }}>Tap to view</Typography></Box>}
        </Box>
      )}
    </Box>
  );
}

// Render text with clickable links. Direct image links (incl. Tenor GIFs) are
// rendered inline as images (NSFW-gated); non-link spans get emoticons
// translated to emoji and, when `censor` is on, profanity masked (f**k).
function renderText(text: string, censor: boolean) {
  const parts = decodeEntities(text).split(/(https?:\/\/[^\s]+)/g);
  return parts.map((p, i) => {
    if (/^https?:\/\//.test(p)) {
      if (IMG_RE.test(p)) {
        return <SafeImage key={i} src={p} sx={{ display: "block", mt: 0.5, maxWidth: "100%", maxHeight: 320, borderRadius: 1.5, border: "1px solid var(--bl-line)" }} />;
      }
      return <a key={i} href={p} target="_blank" rel="noopener noreferrer" style={{ color: "#0a55cf", wordBreak: "break-all" }}>{p}</a>;
    }
    return <span key={i}>{emojify(censor ? nsfwService.censorText(p) : p)}</span>;
  });
}

// Nostr notes (and long-form) commonly use markdown-style formatting. We render
// a safe subset as React nodes (text is escaped by React, never injected as
// HTML): **bold**/__bold__, *italic*/_italic_, ~~strike~~, `code`, [text](url),
// bare URLs/images, #hashtags and nostr: references, plus headings, bullet/
// numbered lists and blockquotes at the start of a line.
const RICH_RE = /(\*\*|__)([^\n]+?)\1|(\*|_)(\S(?:[^*_\n]*\S)?)\3|~~([^\n]+?)~~|`([^`\n]+)`|\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s]+)|(#[A-Za-z0-9_]+)|nostr:((?:npub|note|nevent|nprofile|naddr)1[a-z0-9]+)/g;
const CODE_SX = { fontFamily: "ui-monospace, Menlo, Consolas, monospace", bgcolor: "rgba(0,0,0,0.06)", borderRadius: "4px", px: 0.5, fontSize: "0.92em" } as const;

function richInline(str: string, censor: boolean): ReactNode[] {
  const nodes: ReactNode[] = [];
  const txt = (s: string) => emojify(censor ? nsfwService.censorText(s) : s);
  let last = 0;
  let m: RegExpExecArray | null;
  // A FRESH regex per call — never the shared global RICH_RE. This function recurses
  // (bold/italic/strike/link content), and a `/g` regex carries mutable `lastIndex`
  // state: a recursive call would reset the parent's iterator mid-loop, so the outer
  // loop re-scans the same span and re-recurses, blowing up to O(n²⁺) on ANY line with
  // nested/repeated markup. That froze the feed for tens of seconds on real (markdown-
  // heavy) Nostr posts; plain English with no markup never recursed, so it hid in tests.
  const re = new RegExp(RICH_RE.source, "g");
  while ((m = re.exec(str))) {
    if (m.index > last) nodes.push(<Fragment key={nodes.length}>{txt(str.slice(last, m.index))}</Fragment>);
    if (m[1]) nodes.push(<strong key={nodes.length}>{richInline(m[2], censor)}</strong>);
    else if (m[3]) nodes.push(<em key={nodes.length}>{richInline(m[4], censor)}</em>);
    else if (m[5] !== undefined) nodes.push(<s key={nodes.length}>{richInline(m[5], censor)}</s>);
    else if (m[6] !== undefined) nodes.push(<Box key={nodes.length} component="code" sx={CODE_SX}>{m[6]}</Box>);
    else if (m[7] !== undefined) nodes.push(<a key={nodes.length} href={m[8]} target="_blank" rel="noopener noreferrer" style={{ color: "#0a55cf" }}>{richInline(m[7], censor)}</a>);
    else if (m[9] !== undefined) nodes.push(IMG_RE.test(m[9])
      ? <SafeImage key={nodes.length} src={m[9]} sx={{ display: "block", mt: 0.5, maxWidth: "100%", maxHeight: 320, borderRadius: 1.5, border: "1px solid var(--bl-line)" }} />
      : <a key={nodes.length} href={m[9]} target="_blank" rel="noopener noreferrer" style={{ color: "#0a55cf", wordBreak: "break-all" }}>{m[9]}</a>);
    else if (m[10] !== undefined) nodes.push(<span key={nodes.length} style={{ color: "#1668e0", fontWeight: 600 }}>{m[10]}</span>);
    else if (m[11] !== undefined) nodes.push(<a key={nodes.length} href={`https://njump.me/${m[11]}`} target="_blank" rel="noopener noreferrer" style={{ color: "#0a55cf" }}>@{m[11].slice(0, 10)}…</a>);
    last = re.lastIndex;
    if (re.lastIndex === m.index) re.lastIndex++;   // never loop on a zero-width match
  }
  if (last < str.length) nodes.push(<Fragment key={nodes.length}>{txt(str.slice(last))}</Fragment>);
  return nodes;
}

function renderRichText(text: string, censor: boolean) {
  return decodeEntities(text).split("\n").map((line, i) => {
    let mm: RegExpMatchArray | null;
    let content: ReactNode;
    if ((mm = line.match(/^(#{1,3})\s+(.+)$/))) content = <Box component="span" sx={{ fontWeight: 800, fontSize: mm[1].length === 1 ? "1.12em" : "1.04em" }}>{richInline(mm[2], censor)}</Box>;
    else if ((mm = line.match(/^\s*[-*•]\s+(.+)$/))) content = <>{"•  "}{richInline(mm[1], censor)}</>;
    else if ((mm = line.match(/^\s*(\d+)\.\s+(.+)$/))) content = <>{mm[1] + ".  "}{richInline(mm[2], censor)}</>;
    else if ((mm = line.match(/^>\s?(.*)$/))) content = <Box component="span" sx={{ fontStyle: "italic", color: "text.secondary" }}>{richInline(mm[1], censor)}</Box>;
    else content = <>{richInline(line, censor)}</>;
    return <Fragment key={i}>{i > 0 ? "\n" : null}{content}</Fragment>;
  });
}

// A fenced ``` code block (GitHub-style). A line of ``` — optionally with a
// language tag, e.g. ```js — opens it; the next line that is just ``` closes it
// (an unclosed fence runs to the end of the post). The block renders VERBATIM in a
// scrollable monospace box; its contents are never parsed for markdown/links and
// never censored. Handled here, not in RICH_RE, because a fence spans multiple
// lines — and applied to EVERY post (below) so code blocks work on your own posts,
// not just Nostr markdown.
const CODE_BLOCK_SX = {
  my: 1, p: 1.25, borderRadius: 1.5, overflowX: "auto",
  bgcolor: "rgba(0,0,0,0.06)", border: "1px solid var(--bl-line)",
  fontFamily: "ui-monospace, Menlo, Consolas, monospace",
  fontSize: "0.84em", lineHeight: 1.5, whiteSpace: "pre", tabSize: 2,
} as const;

export function renderBody(text: string, censor: boolean, rich: boolean): ReactNode {
  const prose = (s: string) => (rich ? renderRichText(s, censor) : renderText(s, censor));
  if (!text.includes("```")) return prose(text); // fast path — the vast majority of posts
  const lines = text.split("\n");
  const out: ReactNode[] = [];
  let buf: string[] = [];
  const flush = () => { if (buf.length) { out.push(<Fragment key={`p${out.length}`}>{prose(buf.join("\n"))}</Fragment>); buf = []; } };
  for (let i = 0; i < lines.length; ) {
    if (/^[ \t]*```/.test(lines[i])) {
      flush();
      i++; // consume the opening fence (and drop any language tag on it)
      const code: string[] = [];
      while (i < lines.length && !/^[ \t]*```[ \t]*$/.test(lines[i])) { code.push(lines[i]); i++; }
      i++; // consume the closing fence (or step past EOF for an unclosed block)
      out.push(<Box component="pre" key={`c${out.length}`} sx={CODE_BLOCK_SX}>{decodeEntities(code.join("\n"))}</Box>);
    } else { buf.push(lines[i]); i++; }
  }
  flush();
  return out;
}

// Post body with a "See more"/"See less" toggle for very long posts. When
// collapsed it clamps to a max height and fades out via a CSS mask (so it blends
// with any card background). Short posts render exactly as before, no button.
const LONG_THRESHOLD = 900;       // chars — "super super long"
const COLLAPSED_MAX = 340;        // px
function PostText({ text, censor, rich }: { text: string; censor: boolean; rich?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const autoTranslate = useStore((s) => s.settings.autoTranslate);

  // Translation state: a cached English version + which one we're showing.
  const [trans, setTrans] = useState<{ text: string; src: string } | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [failed, setFailed] = useState(false);
  // True once we know the post is actually English — either a heuristic
  // false-positive the translator corrected (detected source = en) or text that
  // came back unchanged. Hides the translate control so it ONLY ever shows on a
  // genuinely foreign post.
  const [confirmedEnglish, setConfirmedEnglish] = useState(false);
  const translatable = useMemo(() => probablyNotEnglish(text), [text]);

  async function doTranslate() {
    if (trans || translating) return;
    setTranslating(true); setFailed(false);
    try {
      const res = await translateService.toEnglish(text);
      const src = (res.src || "").toLowerCase();
      // The translator's own language detection is the source of truth: if the
      // text was already English (or came back unchanged), there's nothing to show.
      if (!src || src.startsWith("en") || res.text.trim() === text.trim()) setConfirmedEnglish(true);
      else setTrans(res);
    } catch { setFailed(true); }
    finally { setTranslating(false); }
  }
  // Auto-translate foreign-language posts to English (ON by default; the Settings
  // toggle opts out). Only the visible cards mount, so this stays bounded.
  useEffect(() => {
    if (autoTranslate !== false && translatable && !trans && !translating && !failed && !confirmedEnglish) doTranslate();
  }, [autoTranslate, translatable]);

  const showingTrans = !!trans && !showOriginal;
  const body = showingTrans ? trans!.text : text;
  const long = body.length > LONG_THRESHOLD || (body.match(/\n/g)?.length ?? 0) > 14;
  const clamp = long && !expanded;
  const fade = "linear-gradient(to bottom, #000 78%, transparent)";
  // Parse ONLY the text we actually show. A collapsed long post is CSS-clamped to
  // COLLAPSED_MAX px, but renderRichText still turned the ENTIRE body into React nodes
  // first — a long Nostr note (10–80KB) becomes thousands of MUI-styled nodes, and a few
  // of them in the first screenful froze the render for tens of seconds. The clamped
  // slice fills the collapsed height with room to spare; the full body renders on expand.
  const shownBody = clamp ? body.slice(0, 1600) : body;

  return (
    <Box>
      {showingTrans && (
        <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mt: 1, mb: 0.25 }}>
          <TranslateRoundedIcon sx={{ fontSize: 15, color: "#1668e0" }} />
          <Typography variant="caption" sx={{ color: "#1668e0", fontWeight: 700 }}>Translated from {langName(trans!.src)}</Typography>
          <Typography variant="caption" color="text.secondary">·</Typography>
          <Box component="button" onClick={() => setShowOriginal(true)}
            sx={{ background: "none", border: 0, p: 0, cursor: "pointer", font: "inherit", fontSize: 12, color: "text.secondary", fontWeight: 700, "&:hover": { textDecoration: "underline" } }}>
            Show original
          </Box>
        </Stack>
      )}
      <Typography
        component="div"
        sx={{
          mt: showingTrans ? 0 : 1, fontSize: 15, lineHeight: 1.55, whiteSpace: "pre-wrap", wordBreak: "break-word",
          ...(clamp ? { maxHeight: COLLAPSED_MAX, overflow: "hidden", maskImage: fade, WebkitMaskImage: fade } : {}),
        }}
      >
        {isOff("body") ? null : renderBody(shownBody, censor, !!rich)}
      </Typography>
      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ flexWrap: "wrap" }}>
        {long && (
          <Button size="small" disableRipple onClick={() => setExpanded((v) => !v)}
            sx={{ mt: 0.25, px: 0.5, textTransform: "none", fontWeight: 700, color: "#1668e0", "&:hover": { bgcolor: "transparent", textDecoration: "underline" } }}>
            {expanded ? "See less" : "See more"}
          </Button>
        )}
        {/* Translate control — ONLY on genuinely foreign posts (vanishes once the
            translator confirms English). Flips between original and translation. */}
        {(trans || (translatable && !confirmedEnglish)) && (
          trans
            ? <Button size="small" disableRipple startIcon={<TranslateRoundedIcon sx={{ fontSize: 16 }} />} onClick={() => setShowOriginal((v) => !v)}
                sx={{ mt: 0.25, px: 0.5, textTransform: "none", fontWeight: 700, color: "text.secondary", "&:hover": { bgcolor: "transparent", textDecoration: "underline" } }}>
                {showOriginal ? "Show translation" : "Show original"}
              </Button>
            : <Button size="small" disableRipple disabled={translating} startIcon={<TranslateRoundedIcon sx={{ fontSize: 16 }} />} onClick={doTranslate}
                sx={{ mt: 0.25, px: 0.5, textTransform: "none", fontWeight: 700, color: "#1668e0", "&:hover": { bgcolor: "transparent", textDecoration: "underline" } }}>
                {translating ? "Translating…" : failed ? "Translation unavailable — retry" : "Translate to English"}
              </Button>
        )}
      </Stack>
    </Box>
  );
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
  const censor = useStore((s) => s.settings.censorProfanity);
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
          {reply.text && <Typography component="div" variant="body2" sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{renderBody(reply.text, censor, reply.source === "nostr")}</Typography>}
          {reply.media?.map((m, i) => m.type === "image"
            ? <SafeImage key={i} src={m.url} sx={{ mt: 0.5, maxWidth: "100%", maxHeight: 240, borderRadius: 1.5, border: "1px solid var(--bl-line)" }} />
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

// Hashtags — understated inline links. Caps at 10 with a "show more" toggle so a
// note carrying dozens of tags (common on Nostr) doesn't flood the card.
const HASHTAG_MAX = 10;
function Hashtags({ tags }: { tags: string[] }) {
  const [expanded, setExpanded] = useState(false);
  // Dedupe — a post can carry the same tag twice (e.g. RSS topic + a Nostr #t),
  // which both renders "#news #news" and trips React's duplicate-key warning.
  const unique = useMemo(() => [...new Set(tags)], [tags]);
  const shown = expanded ? unique : unique.slice(0, HASHTAG_MAX);
  const extra = unique.length - HASHTAG_MAX;
  return (
    <Box sx={{ mt: 0.75, display: "flex", flexWrap: "wrap", gap: 1, alignItems: "center" }}>
      {shown.map((t) => <Typography key={t} component="span" variant="body2" sx={{ color: "#3f7bd0", fontWeight: 600, cursor: "pointer", "&:hover": { textDecoration: "underline" } }}>#{t}</Typography>)}
      {extra > 0 && (
        <Typography component="span" variant="body2" onClick={() => setExpanded((v) => !v)}
          sx={{ color: "text.secondary", fontWeight: 700, cursor: "pointer", "&:hover": { textDecoration: "underline" } }}>
          {expanded ? "show less" : `+${extra} more`}
        </Typography>
      )}
    </Box>
  );
}

export default function PostCard({ post, reason, replies = [], replyMap, verdict }: { post: Post; reason?: RecommendationReason; replies?: Post[]; replyMap?: Map<string, Post[]>; verdict?: ModerationVerdict }) {
  const me = useStore((s) => s.me);
  const mePk = me?.publicKey ?? "";
  const filterNsfw = useStore((s) => s.settings.filterNsfw);
  const censorProfanity = useStore((s) => s.settings.censorProfanity);
  const nav = useNavigate();
  const canVisit = !!post.author && post.author !== "rss-bot" && post.author !== "system" && !post.author.startsWith("demo_");
  const visit = () => canVisit && nav(`/u/${post.author}`);
  const [react, setReact] = useState<{ el: HTMLElement; id: string } | null>(null);
  const [showReplies, setShowReplies] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [authMenu, setAuthMenu] = useState<HTMLElement | null>(null);
  // When you mute/block/hide from this card, we collapse just THIS one in place
  // (with an Undo) instead of re-ranking the whole feed — so your scroll stays put.
  const [dismissed, setDismissed] = useState<null | { kind: "muted" | "blocked" | "hidden" }>(null);
  const [factCheck, setFactCheck] = useState<FactCheck | null>(() => factCheckService.getFor(post.id));
  const [fcBusy, setFcBusy] = useState(false);
  const restricted = !!verdict && (verdict.action === "reduce" || verdict.action === "review" || verdict.action === "flag");
  // On-device adult-content gate for explicit *text*. Images self-gate via
  // <SafeImage>. When either trips (and the post isn't already restricted by the
  // moderation layer) the body is hidden behind a "Show anyway" reveal.
  const textNsfw = filterNsfw && nsfwService.isAdultText(post.text);
  const gated = restricted || textNsfw;
  const childMap = replyMap ?? new Map<string, Post[]>();

  // User-triggered fact-check: purely algorithmic, on-device. We extract the
  // post's salient terms and rank PolitiFact's recent claims by IDF-weighted
  // lexical overlap — no AI involved; it links you to PolitiFact's own wording.
  async function runFactCheck() {
    setFcBusy(true);
    toast("Checking PolitiFact on your device ⚡ (local keyword match — no AI)", "info");
    const found = await factCheckService.checkPost(post.text ?? "");
    setFcBusy(false);
    if (found) { await factCheckService.setFor(post.id, found); setFactCheck(found); toast("Fact-check linked — matched locally against PolitiFact.", "success"); }
    else toast("No relevant PolitiFact fact-check found.", "info");
  }

  // Hand the post (with its reactions + comments) to the on-device Companion.
  function askCompanion() {
    const reactionEntries = Object.entries(post.reactions).filter(([, v]) => v.length);
    const totalReacts = reactionEntries.reduce((s, [, v]) => s + v.length, 0);
    const reactions = reactionEntries.map(([e, v]) => `${e}×${v.length}`).join(", ");
    const comments = replies.slice(0, 6).map((r) => `- ${r.authorName}: ${(r.text ?? "").slice(0, 200)}`).join("\n");
    const hasEngagement = totalReacts > 0 || replies.length > 0;
    const prompt = [
      "Give me your honest, brief take on this post. IMPORTANT: only describe engagement that is explicitly listed below. Do NOT invent, assume, or imply any reactions, comments, or how people received it beyond what's shown. If there are zero reactions and zero comments, treat it as having no engagement yet and do not speculate about an audience.",
      "",
      `Post by ${post.authorName}: "${(post.text ?? "").slice(0, 700)}"`,
      `Reactions: ${totalReacts > 0 ? `${totalReacts} (${reactions})` : "0 — none yet"}`,
      `Comments (${replies.length}): ${replies.length > 0 ? `\n${comments}` : "none yet"}`,
      "",
      hasEngagement
        ? "What do you make of it, and what does the actual engagement above suggest about how it's landing?"
        : "It currently has no reactions and no comments, so just give your own take on the post itself — don't describe any audience reaction.",
    ].join("\n");
    bus.emit("companion:prompt", { text: prompt });
    toast("Ledger AI is weighing in 🤖", "info");
    // …and the shared Ledger AI leaves its OWN independent public comment on the
    // post (once per post — it reads as the bot's take, not about who asked).
    postAiComment();
  }

  async function postAiComment() {
    if (post.author === "ai-bot") return;                       // don't comment on AI's own comments
    if (replies.some((r) => r.author === "ai-bot")) return;     // already commented
    try {
      const { text, modelLabel } = await companionService.commentOnPost(post);
      await feedService.commentAsAi(post.id, text, modelLabel);
      // Bridge to Nostr: mirror the original post there (once) and post the AI
      // comment as a reply. No-op unless Nostr is active.
      nostrService.bridgeAiComment(post, `${text}\n\n— 🤖 Ledger AI (${modelLabel})`).catch(() => {});
    } catch { /* best-effort */ }
  }

  async function trust(kind: "vouch" | "report" | "mute" | "block") {
    setAuthMenu(null);
    await trustService[kind](post.author);   // works for Nostr too (author = "nostr:<pubkey>")
    // Mute/block: collapse this card in place (you won't see their other posts
    // either, once the feed next re-ranks). Vouch/report: just confirm.
    if (kind === "mute" || kind === "block") { setDismissed({ kind: kind === "mute" ? "muted" : "blocked" }); return; }
    toast(kind === "vouch" ? `Vouched for ${post.authorName}` : `Reported ${post.authorName}`, kind === "vouch" ? "success" : "info");
  }

  // "Hide this post" — a per-device hide; collapse this one card (silent, no feed re-rank).
  async function hideThis() {
    setAuthMenu(null);
    await feedService.hidePost(post.id, true);
    setDismissed({ kind: "hidden" });
  }

  async function undoDismiss() {
    if (dismissed?.kind === "hidden") await feedService.unhidePost(post.id, true);
    else await trustService.clear(post.author);
    setDismissed(null);
  }

  if (dismissed) {
    const txt = dismissed.kind === "hidden" ? "Post hidden"
      : dismissed.kind === "blocked" ? `Blocked ${post.authorName} — you won't see their posts`
      : `Muted ${post.authorName} — you won't see their posts`;
    const icon = dismissed.kind === "hidden" ? "🙈" : dismissed.kind === "blocked" ? "🚫" : "🔇";
    return (
      <GlassCard id={`post-${post.id}`} sx={{ mb: 1.5, px: 2, py: 1, opacity: 0.72 }}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <Typography variant="body2" color="text.secondary" sx={{ flex: 1, minWidth: 0 }} noWrap>{icon} {txt}</Typography>
          <Button size="small" onClick={undoDismiss} sx={{ flex: "0 0 auto" }}>Undo</Button>
        </Stack>
      </GlassCard>
    );
  }

  return (
    <GlassCard id={`post-${post.id}`} sx={{ mb: 1.5, px: { xs: 1.5, sm: 2 }, py: "20px", scrollMarginTop: 70, transition: "box-shadow .25s ease, border-color .25s ease", "&:hover": { boxShadow: "0 4px 18px rgba(20,40,80,0.08)" }, "&.zb-focus": { boxShadow: "0 0 0 3px rgba(58,155,240,0.7)" } }}>
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
                {post.source === "nostr"
                  ? <Tooltip title="External Nostr user — bridged into Ledger"><Chip size="small" label="NOSTR" sx={{ height: 15, fontSize: 9, fontWeight: 800, "& .MuiChip-label": { px: 0.6 }, bgcolor: "rgba(138,43,226,0.16)", color: "#7a1fb8" }} /></Tooltip>
                  : post.author === "ai-bot"
                  ? <Chip size="small" label="AI" sx={{ height: 15, fontSize: 9, fontWeight: 700, "& .MuiChip-label": { px: 0.6 }, bgcolor: "rgba(124,92,255,0.16)", color: "#5a35d0" }} />
                  : post.author === "rss-bot" || post.author === "system"
                  ? <Chip size="small" label="BOT" sx={{ height: 15, fontSize: 9, fontWeight: 700, "& .MuiChip-label": { px: 0.6 }, bgcolor: "rgba(58,123,240,0.14)", color: "#0a55cf" }} />
                  : post.sig
                    ? <Tooltip title="Cryptographically signed by author — verified on arrival"><VerifiedRoundedIcon sx={{ fontSize: 15, color: "#3f97ff" }} /></Tooltip>
                    : <Tooltip title="Unsigned (legacy post) — authorship not verified"><VerifiedRoundedIcon sx={{ fontSize: 15, color: "rgba(0,0,0,0.22)" }} /></Tooltip>}
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

          {gated && !revealed && (restricted ? (
            <Box sx={{ mt: 1, p: 1.5, borderRadius: 1, bgcolor: "rgba(232,146,12,0.08)", border: "1px solid rgba(232,146,12,0.45)" }}>
              <Typography variant="body2"><b>{verdict!.action === "flag" ? "Flagged" : verdict!.action === "review" ? "Pending community review" : "Reduced"}</b> — {verdict!.reasoning}</Typography>
              <Typography variant="caption" color="text.secondary">Advisory · {Math.round(verdict!.confidence * 100)}% confidence · the network didn't delete it — you decide.</Typography>
              <Box><Button size="small" sx={{ mt: 0.5 }} onClick={() => setRevealed(true)}>Show anyway</Button></Box>
            </Box>
          ) : (
            <Box sx={{ mt: 1, p: 1.5, borderRadius: 1, bgcolor: "rgba(210,59,47,0.07)", border: "1px solid rgba(210,59,47,0.4)" }}>
              <Typography variant="body2"><b>Sensitive content hidden</b> — this post may contain adult or explicit language.</Typography>
              <Typography variant="caption" color="text.secondary">Filtered on your device · turn off "Filter adult content" in Settings.</Typography>
              <Box><Button size="small" sx={{ mt: 0.5 }} onClick={() => setRevealed(true)}>Show anyway</Button></Box>
            </Box>
          ))}

          {(!gated || revealed) && (<>
          {post.text && <PostText text={post.text} censor={censorProfanity} rich={post.source === "nostr"} />}

          {!isOff("embeds") && post.html && <HtmlCard html={post.html} />}

          {!isOff("embeds") && (() => {
            const ytId = firstYouTube(post.text ?? "");
            const spotify = ytId ? null : firstSpotify(post.text ?? "");
            const tiktok = ytId || spotify ? null : firstTikTok(post.text ?? "");
            const linkUrl = ytId || spotify || tiktok ? null : firstLink(post.text ?? "");
            if (ytId) return <YouTubeCard id={ytId} />;
            if (spotify) return <SpotifyCard kind={spotify.kind} id={spotify.id} />;
            if (tiktok) return <TikTokCard url={tiktok} />;
            if (linkUrl) return <LinkCard url={linkUrl} />;
            // uploaded images (no link in text)
            return post.media?.map((m, i) => (m.type === "image" ? <SafeImage key={i} src={m.url} sx={{ mt: 1, maxWidth: "100%", maxHeight: 360, borderRadius: 2, border: "1px solid var(--bl-line)" }} /> : null));
          })()}

          {post.media?.filter((m) => m.type === "audio").map((m, i) => <AudioCard key={i} url={m.url} title={m.alt || "Audio track"} />)}

          {factCheck && <FactCheckCard fc={factCheck} postId={post.id} text={post.text ?? ""} onChange={setFactCheck} />}

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

          {/* hashtags — understated inline links, capped with a "show more" */}
          {post.author !== "rss-bot" && post.tags.length > 0 && <Hashtags tags={post.tags} />}

          </>)}
        </Box>
      </Stack>

      {/* full-width footer — reaction summary, action bar & comments span the whole card */}
      {(!gated || revealed) && (
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
        {!!post.text?.trim() && !factCheck && <MenuItem disabled={fcBusy} onClick={() => { setAuthMenu(null); runFactCheck(); }}>🔎 {fcBusy ? "Checking…" : "Fact-check this"}</MenuItem>}
        <MenuItem onClick={hideThis}>🙈 Hide this post</MenuItem>
        {canVisit && <MenuItem onClick={() => trust("vouch")}>🤝 Vouch for {post.authorName}</MenuItem>}
        {canVisit && <MenuItem onClick={() => trust("report")}>🚩 Report</MenuItem>}
        {canVisit && <MenuItem onClick={() => trust("mute")}>🔇 Mute — hide from your feed</MenuItem>}
        {canVisit && <MenuItem onClick={() => trust("block")}>🚫 Block {post.authorName}</MenuItem>}
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
