import { useState } from "react";
import { Stack, Avatar, Box, Typography, IconButton, Chip, Popover, Tooltip } from "@mui/material";
import AddReactionRoundedIcon from "@mui/icons-material/AddReactionRounded";
import VerifiedRoundedIcon from "@mui/icons-material/VerifiedRounded";
import GlassCard from "@/components/common/GlassCard";
import WhyRecommended from "./WhyRecommended";
import { avatarGradient, initials } from "@/components/common/avatar";
import { relativeTime } from "@/lib/time";
import { feedService } from "@/services/feedService";
import { useStore } from "@/store/useStore";
import type { Post, RecommendationReason } from "@/types";

const REACTIONS = ["⭐", "🔥", "🚀", "💜", "😂", "👀"];

export default function PostCard({ post, reason }: { post: Post; reason?: RecommendationReason }) {
  const me = useStore((s) => s.me);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  const sourceColor = post.source === "self" ? "#5dffa0" : post.source === "relay" || post.source === "peer" ? "#6ee7ff" : "#7a85a8";

  return (
    <GlassCard sx={{ mb: 1.5 }}>
      <Stack direction="row" spacing={1.5}>
        <Avatar sx={{ background: avatarGradient(post.author), color: "#04121a", fontWeight: 800 }}>{initials(post.authorName)}</Avatar>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" alignItems="center" spacing={1}>
            <Typography sx={{ fontWeight: 700 }}>{post.authorName}</Typography>
            <Tooltip title="Cryptographically signed by author"><VerifiedRoundedIcon sx={{ fontSize: 15, color: "#6ee7ff" }} /></Tooltip>
            <Typography variant="caption" color="text.secondary">· {relativeTime(post.createdAt)}</Typography>
            <Box sx={{ flex: 1 }} />
            <Chip size="small" label={post.source} sx={{ height: 18, fontSize: 10, color: sourceColor, borderColor: sourceColor }} variant="outlined" />
            <WhyRecommended reason={reason} />
          </Stack>

          {post.text && <Typography sx={{ mt: 0.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{post.text}</Typography>}

          {post.media?.map((m, i) => (
            m.type === "image" ? <Box key={i} component="img" src={m.url} sx={{ mt: 1, maxWidth: "100%", maxHeight: 360, borderRadius: 2, border: "1px solid rgba(110,231,255,0.15)" }} /> : null
          ))}

          {post.poll && (
            <Stack spacing={0.5} sx={{ mt: 1 }}>
              <Typography variant="subtitle2">{post.poll.question}</Typography>
              {post.poll.options.map((o) => (
                <Box key={o.id} sx={{ px: 1.5, py: 0.75, borderRadius: 1.5, border: "1px solid rgba(110,231,255,0.2)" }}>
                  <Typography variant="body2">{o.label} · {o.votes.length}</Typography>
                </Box>
              ))}
            </Stack>
          )}

          {post.tags.length > 0 && (
            <Stack direction="row" spacing={0.5} sx={{ mt: 1, flexWrap: "wrap", gap: 0.5 }}>
              {post.tags.map((t) => <Chip key={t} size="small" label={"#" + t} sx={{ bgcolor: "rgba(167,139,250,0.12)", color: "#a78bfa" }} />)}
            </Stack>
          )}

          <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mt: 1 }}>
            {Object.entries(post.reactions).filter(([, v]) => v.length).map(([emoji, voters]) => (
              <Chip
                key={emoji} size="small"
                label={`${emoji} ${voters.length}`}
                onClick={() => feedService.react(post.id, emoji)}
                sx={{ bgcolor: voters.includes(me?.publicKey ?? "") ? "rgba(110,231,255,0.2)" : "rgba(255,255,255,0.05)", cursor: "pointer" }}
              />
            ))}
            <IconButton size="small" onClick={(e) => setAnchor(e.currentTarget)}><AddReactionRoundedIcon fontSize="small" /></IconButton>
          </Stack>
        </Box>
      </Stack>

      <Popover open={!!anchor} anchorEl={anchor} onClose={() => setAnchor(null)}>
        <Stack direction="row" sx={{ p: 1 }}>
          {REACTIONS.map((e) => (
            <IconButton key={e} onClick={() => { feedService.react(post.id, e); setAnchor(null); }}>
              <span style={{ fontSize: 20 }}>{e}</span>
            </IconButton>
          ))}
        </Stack>
      </Popover>
    </GlassCard>
  );
}
