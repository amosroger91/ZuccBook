import { useState, useEffect } from "react";
import { Stack, Box, Typography, IconButton, Chip, Popover, Tooltip, TextField, Button } from "@mui/material";
import AddReactionRoundedIcon from "@mui/icons-material/AddReactionRounded";
import VerifiedRoundedIcon from "@mui/icons-material/VerifiedRounded";
import ReplyRoundedIcon from "@mui/icons-material/ReplyRounded";
import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";
import { linkPreviewService, type Preview } from "@/services/linkPreviewService";
import GlassCard from "@/components/common/GlassCard";
import WhyRecommended from "./WhyRecommended";
import UserAvatar from "@/components/common/UserAvatar";
import { relativeTime } from "@/lib/time";
import { feedService } from "@/services/feedService";
import { peerService } from "@/services/peerService";
import { useNavigate } from "react-router-dom";
import { useStore } from "@/store/useStore";
import type { Post, RecommendationReason } from "@/types";

const REACTIONS = ["⭐", "🔥", "🚀", "💜", "😂", "👀"];

const YT_RE = /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/i;
const IMG_RE = /\.(png|jpe?g|gif|webp|avif|bmp|svg)(\?[^\s]*)?$/i;
function firstYouTube(text: string): string | null { return text.match(YT_RE)?.[1] ?? null; }
function firstLink(text: string): string | null {
  const urls = text.match(/https?:\/\/[^\s]+/g) ?? [];
  return urls.find((u) => !IMG_RE.test(u) && !YT_RE.test(u)) ?? null;
}

// Click-to-play YouTube card (loads the iframe only when you press play).
function YouTubeCard({ id, thumb }: { id: string; thumb?: string }) {
  const [play, setPlay] = useState(false);
  return (
    <Box sx={{ position: "relative", pt: "56.25%", mt: 1, borderRadius: 1, overflow: "hidden", border: "1px solid var(--bl-line)", bgcolor: "#000" }}>
      {play ? (
        <Box component="iframe" src={`https://www.youtube.com/embed/${id}?autoplay=1&rel=0`} title="YouTube" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen sx={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }} />
      ) : (
        <Box onClick={() => setPlay(true)} sx={{ position: "absolute", inset: 0, cursor: "pointer", backgroundImage: `url(${thumb || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`})`, backgroundSize: "cover", backgroundPosition: "center", display: "grid", placeItems: "center" }}>
          <Box sx={{ width: 64, height: 46, borderRadius: 2, bgcolor: "rgba(0,0,0,0.72)", display: "grid", placeItems: "center" }}><PlayArrowRoundedIcon sx={{ color: "#fff", fontSize: 36 }} /></Box>
        </Box>
      )}
    </Box>
  );
}

// Open-Graph link preview card for any shared link.
function LinkCard({ url }: { url: string }) {
  const [d, setD] = useState<Preview | null>(null);
  useEffect(() => { let on = true; linkPreviewService.preview(url).then((p) => on && setD(p)).catch(() => {}); return () => { on = false; }; }, [url]);
  let host = url; try { host = new URL(url).hostname.replace(/^www\./, ""); } catch {}
  return (
    <Box component="a" href={url} target="_blank" rel="noopener noreferrer" sx={{ display: "block", mt: 1, border: "1px solid var(--bl-line)", borderRadius: 1, overflow: "hidden", textDecoration: "none", color: "inherit", bgcolor: "var(--bl-white)" }}>
      {d?.image && <Box component="img" src={d.image} loading="lazy" sx={{ width: "100%", maxHeight: 240, objectFit: "cover", display: "block" }} />}
      <Box sx={{ p: 1 }}>
        <Typography variant="caption" color="text.secondary">{d?.site || host}</Typography>
        <Typography variant="body2" sx={{ fontWeight: 700 }} noWrap>{d?.title || host}</Typography>
        {d?.description && <Typography variant="caption" color="text.secondary" sx={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{d.description}</Typography>}
      </Box>
    </Box>
  );
}

// Render text with clickable links (used for RSS Bot story links, etc.).
function renderText(text: string) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return parts.map((p, i) =>
    /^https?:\/\//.test(p)
      ? <a key={i} href={p} target="_blank" rel="noopener noreferrer" style={{ color: "#0a55cf", wordBreak: "break-all" }}>{p}</a>
      : <span key={i}>{p}</span>,
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

export default function PostCard({ post, reason, replies = [] }: { post: Post; reason?: RecommendationReason; replies?: Post[] }) {
  const me = useStore((s) => s.me);
  const mePk = me?.publicKey ?? "";
  const nav = useNavigate();
  const canVisit = !!post.author && post.author !== "rss-bot" && post.author !== "system" && !post.author.startsWith("demo_");
  const visit = () => canVisit && nav(`/u/${post.author}`);
  const [react, setReact] = useState<{ el: HTMLElement; id: string } | null>(null);
  const [showReplies, setShowReplies] = useState(false);
  const [replyText, setReplyText] = useState("");

  const sourceColor = post.source === "self" ? "#54c95a" : post.source === "relay" || post.source === "peer" ? "#3f97ff" : "#7a85a8";

  async function sendReply() {
    const t = replyText.trim();
    if (!t) return;
    const p = await feedService.createPost({ text: t, replyTo: post.id });
    peerService.publishPost(p);
    setReplyText(""); setShowReplies(true);
  }

  return (
    <GlassCard sx={{ mb: 1.5 }}>
      <Stack direction="row" spacing={1.5}>
        <Box onClick={visit} sx={{ cursor: canVisit ? "pointer" : "default" }}>
          <UserAvatar pk={post.author} name={post.authorName} avatar={post.authorAvatar} />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" alignItems="center" spacing={1}>
            <Typography onClick={visit} sx={{ fontWeight: 700, cursor: canVisit ? "pointer" : "default", "&:hover": canVisit ? { textDecoration: "underline" } : {} }} noWrap>{post.authorName}</Typography>
            {post.author === "rss-bot"
              ? <Chip size="small" label="BOT" sx={{ height: 16, fontSize: 9, bgcolor: "rgba(58,123,240,0.2)", color: "#0a55cf" }} />
              : <Tooltip title="Cryptographically signed by author"><VerifiedRoundedIcon sx={{ fontSize: 15, color: "#3f97ff" }} /></Tooltip>}
            <Typography variant="caption" color="text.secondary">· {relativeTime(post.createdAt)}</Typography>
            <Box sx={{ flex: 1 }} />
            <Chip size="small" label={post.source} sx={{ height: 18, fontSize: 10, color: sourceColor, borderColor: sourceColor }} variant="outlined" />
            <WhyRecommended reason={reason} />
          </Stack>

          {post.text && <Typography component="div" sx={{ mt: 0.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{renderText(post.text)}</Typography>}

          {(() => {
            const ytId = firstYouTube(post.text ?? "");
            const linkUrl = ytId ? null : firstLink(post.text ?? "");
            if (ytId) return <YouTubeCard id={ytId} thumb={post.media?.[0]?.url} />;
            if (linkUrl) return <LinkCard url={linkUrl} />;
            // uploaded images (no link in text)
            return post.media?.map((m, i) => (m.type === "image" ? <Box key={i} component="img" src={m.url} sx={{ mt: 1, maxWidth: "100%", maxHeight: 360, borderRadius: 2, border: "1px solid var(--bl-line)" }} /> : null));
          })()}

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

          {post.tags.length > 0 && (
            <Stack direction="row" spacing={0.5} sx={{ mt: 1, flexWrap: "wrap", gap: 0.5 }}>
              {post.tags.map((t) => <Chip key={t} size="small" label={"#" + t} sx={{ bgcolor: "rgba(58,123,240,0.12)", color: "#1668e0" }} />)}
            </Stack>
          )}

          <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: 0.5 }}>
            <Box sx={{ flex: 1 }}><ReactRow post={post} me={mePk} onAdd={(el, id) => setReact({ el, id })} /></Box>
            <Button size="small" startIcon={<ReplyRoundedIcon fontSize="small" />} onClick={() => setShowReplies((v) => !v)} sx={{ color: "text.secondary", flex: "0 0 auto" }}>
              {replies.length ? `${replies.length} ` : ""}Reply
            </Button>
          </Stack>

          {showReplies && (
            <Box sx={{ mt: 1, pl: 2, borderLeft: "2px solid rgba(58,155,240,0.25)" }}>
              {replies.map((r) => (
                <Stack key={r.id} direction="row" spacing={1} sx={{ mb: 1 }}>
                  <UserAvatar pk={r.author} name={r.authorName} avatar={r.authorAvatar} size={26} />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Stack direction="row" spacing={0.5} alignItems="center">
                      <Typography variant="body2" sx={{ fontWeight: 700 }} noWrap>{r.authorName}</Typography>
                      <Typography variant="caption" color="text.secondary">· {relativeTime(r.createdAt)}</Typography>
                    </Stack>
                    {r.text && <Typography component="div" variant="body2" sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{renderText(r.text)}</Typography>}
                    {r.media?.map((m, i) => m.type === "image" ? <Box key={i} component="img" src={m.url} sx={{ mt: 0.5, maxWidth: "100%", maxHeight: 240, borderRadius: 1.5 }} /> : null)}
                    <ReactRow post={r} me={mePk} onAdd={(el, id) => setReact({ el, id })} />
                  </Box>
                </Stack>
              ))}
              <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                <TextField fullWidth size="small" placeholder={`Reply to ${post.authorName}…`} value={replyText} onChange={(e) => setReplyText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendReply()} />
                <Button variant="contained" onClick={sendReply} disabled={!replyText.trim()}>Reply</Button>
              </Stack>
            </Box>
          )}
        </Box>
      </Stack>

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
