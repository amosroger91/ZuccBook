import { useState } from "react";
import { Stack, Box, Typography, IconButton, Chip, Popover, Tooltip, TextField, Button } from "@mui/material";
import AddReactionRoundedIcon from "@mui/icons-material/AddReactionRounded";
import VerifiedRoundedIcon from "@mui/icons-material/VerifiedRounded";
import ReplyRoundedIcon from "@mui/icons-material/ReplyRounded";
import GlassCard from "@/components/common/GlassCard";
import WhyRecommended from "./WhyRecommended";
import UserAvatar from "@/components/common/UserAvatar";
import { relativeTime } from "@/lib/time";
import { feedService } from "@/services/feedService";
import { peerService } from "@/services/peerService";
import { useStore } from "@/store/useStore";
import type { Post, RecommendationReason } from "@/types";

const REACTIONS = ["⭐", "🔥", "🚀", "💜", "😂", "👀"];

// Render text with clickable links (used for RSS Bot story links, etc.).
function renderText(text: string) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return parts.map((p, i) =>
    /^https?:\/\//.test(p)
      ? <a key={i} href={p} target="_blank" rel="noopener noreferrer" style={{ color: "#9fd0ff", wordBreak: "break-all" }}>{p}</a>
      : <span key={i}>{p}</span>,
  );
}

function ReactRow({ post, me, onAdd }: { post: Post; me: string; onAdd: (el: HTMLElement, id: string) => void }) {
  return (
    <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mt: 1, flexWrap: "wrap", gap: 0.5 }}>
      {Object.entries(post.reactions).filter(([, v]) => v.length).map(([emoji, voters]) => (
        <Chip key={emoji} size="small" label={`${emoji} ${voters.length}`} onClick={() => feedService.react(post.id, emoji)}
          sx={{ bgcolor: voters.includes(me) ? "rgba(58,155,240,0.2)" : "rgba(255,255,255,0.05)", cursor: "pointer" }} />
      ))}
      <IconButton size="small" onClick={(e) => onAdd(e.currentTarget, post.id)}><AddReactionRoundedIcon fontSize="small" /></IconButton>
    </Stack>
  );
}

export default function PostCard({ post, reason, replies = [] }: { post: Post; reason?: RecommendationReason; replies?: Post[] }) {
  const me = useStore((s) => s.me);
  const mePk = me?.publicKey ?? "";
  const [react, setReact] = useState<{ el: HTMLElement; id: string } | null>(null);
  const [showReplies, setShowReplies] = useState(false);
  const [replyText, setReplyText] = useState("");

  const sourceColor = post.source === "self" ? "#54c95a" : post.source === "relay" || post.source === "peer" ? "#39c6f5" : "#7a85a8";

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
        <UserAvatar pk={post.author} name={post.authorName} avatar={post.authorAvatar} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" alignItems="center" spacing={1}>
            <Typography sx={{ fontWeight: 700 }} noWrap>{post.authorName}</Typography>
            {post.author === "rss-bot"
              ? <Chip size="small" label="BOT" sx={{ height: 16, fontSize: 9, bgcolor: "rgba(58,123,240,0.2)", color: "#9fd0ff" }} />
              : <Tooltip title="Cryptographically signed by author"><VerifiedRoundedIcon sx={{ fontSize: 15, color: "#39c6f5" }} /></Tooltip>}
            <Typography variant="caption" color="text.secondary">· {relativeTime(post.createdAt)}</Typography>
            <Box sx={{ flex: 1 }} />
            <Chip size="small" label={post.source} sx={{ height: 18, fontSize: 10, color: sourceColor, borderColor: sourceColor }} variant="outlined" />
            <WhyRecommended reason={reason} />
          </Stack>

          {post.text && <Typography component="div" sx={{ mt: 0.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{renderText(post.text)}</Typography>}

          {post.media?.map((m, i) => (
            m.type === "image" ? <Box key={i} component="img" src={m.url} sx={{ mt: 1, maxWidth: "100%", maxHeight: 360, borderRadius: 2, border: "1px solid rgba(58,155,240,0.15)" }} /> : null
          ))}

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
              {post.tags.map((t) => <Chip key={t} size="small" label={"#" + t} sx={{ bgcolor: "rgba(58,123,240,0.12)", color: "#3a7bf0" }} />)}
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
