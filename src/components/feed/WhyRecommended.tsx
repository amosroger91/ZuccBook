import { useState, memo } from "react";
import { IconButton, Popover, Box, Typography, Stack, LinearProgress, Tooltip, Chip, Divider, ToggleButton, ToggleButtonGroup, Switch, FormControlLabel, Button } from "@mui/material";
import InsightsRoundedIcon from "@mui/icons-material/InsightsRounded";
import BlockRoundedIcon from "@mui/icons-material/BlockRounded";
import { useStore } from "@/store/useStore";
import { nsfwService } from "@/services/nsfwService";
import { spamService } from "@/services/spamService";
import type { RecommendationReason, Post, ModerationVerdict, ContentMode } from "@/types";

const BOT = (a: string) => a === "rss-bot" || a === "system" || a === "ai-bot";

function WhyRecommendedPopover({
  anchor,
  onClose,
  reason,
  post,
  verdict,
  onBlock,
}: {
  anchor: HTMLElement;
  onClose: () => void;
  reason: RecommendationReason;
  post: Post;
  verdict?: ModerationVerdict;
  onBlock?: () => void;
}) {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const me = useStore((s) => s.me?.publicKey ?? "");

  const max = Math.max(1, ...reason.factors.map((f) => Math.abs(f.weight)));
  const ours = post.author === me || BOT(post.author);
  const textFlag = nsfwService.isAdultText(post.text);
  const spamFlag = !ours && spamService.isJunk(post.id, post.text ?? "");
  const modAction = verdict?.action ?? "allow";

  const Row = ({ label, on, status, good }: { label: string; on: string; status: string; good: boolean }) => (
    <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1} sx={{ py: 0.5 }}>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>{label}</Typography>
        <Typography variant="caption" color="text.secondary">{on}</Typography>
      </Box>
      <Chip size="small" label={status} sx={{ height: 20, fontSize: 11, fontWeight: 700, flexShrink: 0, bgcolor: good ? "rgba(84,201,90,0.16)" : "rgba(232,146,12,0.18)", color: good ? "#2f8f3a" : "#a86708" }} />
    </Stack>
  );

  return (
    <Popover open={!!anchor} anchorEl={anchor} onClose={onClose} anchorOrigin={{ vertical: "bottom", horizontal: "right" }} transformOrigin={{ vertical: "top", horizontal: "right" }}>
      <Box sx={{ p: 2, width: 340, maxHeight: "80vh", overflowY: "auto" }}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
          <Typography variant="subtitle2">Why you're seeing this</Typography>
          <Chip size="small" label={reason.algorithm} />
        </Stack>
        <Typography variant="caption" color="text.secondary">Score {reason.score.toFixed(2)} · everything below runs on your device.</Typography>

        {/* ranking factors (these sum to the score) */}
        <Stack spacing={1.1} sx={{ mt: 1.5 }}>
          {reason.factors.map((f, i) => (
            <Box key={i}>
              <Stack direction="row" justifyContent="space-between">
                <Typography variant="body2" sx={{ fontWeight: 600 }}>{f.label}</Typography>
                <Typography variant="caption" color={f.weight < 0 ? "error" : "text.secondary"}>{f.weight >= 0 ? "+" : ""}{f.weight.toFixed(1)}</Typography>
              </Stack>
              <LinearProgress variant="determinate" value={Math.min(100, (Math.abs(f.weight) / max) * 100)} sx={{ height: 6, borderRadius: 3, mt: 0.5, opacity: f.weight < 0 ? 0.5 : 1 }} />
              {f.detail && <Typography variant="caption" color="text.secondary">{f.detail}</Typography>}
            </Box>
          ))}
        </Stack>

        {/* what every on-device scan/filter said about this post */}
        <Divider sx={{ my: 1.5 }} />
        <Typography variant="overline" color="text.secondary">Filters &amp; scans for this post</Typography>
        <Stack sx={{ mt: 0.5 }} divider={<Divider flexItem />}>
          <Row label="Moderation" on={`profile: ${settings.moderationProfile}`}
            status={modAction === "allow" ? "allowed" : verdict ? `${modAction} · ${Math.round(verdict.confidence * 100)}%` : modAction} good={modAction === "allow"} />
          <Row label="Adult content (NSFW)" on={`${settings.nsfwMode ?? "screen"} · images + text`}
            status={textFlag ? "text flagged" : "clean"} good={!textFlag} />
          <Row label="Foul language" on={`${settings.profanityMode ?? "show"}`}
            status={textFlag ? "flagged" : "clean"} good={!textFlag} />
          <Row label="Spam / scam / bot" on={settings.hideSpam ? "filter on" : "filter off"}
            status={ours ? "not checked (ours)" : spamFlag ? "flagged" : "clean"} good={!spamFlag} />
        </Stack>

        {/* one-tap controls for what you see going forward */}
        <Divider sx={{ my: 1.5 }} />
        <Typography variant="overline" color="text.secondary">Don't want to see this?</Typography>
        <Stack spacing={1.25} sx={{ mt: 0.75 }}>
          <Box>
            <Typography variant="caption" color="text.secondary">Adult content (NSFW)</Typography>
            <ToggleButtonGroup exclusive fullWidth size="small" value={settings.nsfwMode ?? "screen"} onChange={(_, v) => v && setSettings({ nsfwMode: v as ContentMode })} sx={{ mt: 0.25 }}>
              <ToggleButton value="show">Show</ToggleButton><ToggleButton value="screen">Screen</ToggleButton><ToggleButton value="hide">Hide</ToggleButton>
            </ToggleButtonGroup>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">Foul language</Typography>
            <ToggleButtonGroup exclusive fullWidth size="small" value={settings.profanityMode ?? "show"} onChange={(_, v) => v && setSettings({ profanityMode: v as ContentMode })} sx={{ mt: 0.25 }}>
              <ToggleButton value="show">Show</ToggleButton><ToggleButton value="screen">Screen</ToggleButton><ToggleButton value="hide">Hide</ToggleButton>
            </ToggleButtonGroup>
          </Box>
          <FormControlLabel sx={{ ml: 0 }} control={<Switch size="small" checked={settings.hideSpam === true} onChange={(e) => setSettings({ hideSpam: e.target.checked })} />} label={<Typography variant="body2">Hide spam, scams &amp; bots</Typography>} />
          {onBlock && !BOT(post.author) && post.author !== me && (
            <Button size="small" color="error" variant="outlined" startIcon={<BlockRoundedIcon />} onClick={() => { onBlock(); onClose(); }}>
              Block {post.authorName}
            </Button>
          )}
        </Stack>
      </Box>
    </Popover>
  );
}

/** "Why am I seeing this?" — fully transparent: the local ranking score, every
 *  on-device filter/scan this post passed through, and one-tap ways to change
 *  what you see (the three content settings, or block the author). */
export const WhyRecommended = memo(function WhyRecommended({ reason, post, verdict, onBlock }: { reason?: RecommendationReason; post: Post; verdict?: ModerationVerdict; onBlock?: () => void }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  if (!reason) return null;

  return (
    <>
      <Tooltip title="Why am I seeing this?">
        <IconButton size="small" onClick={(e) => setAnchor(e.currentTarget)}><InsightsRoundedIcon fontSize="small" /></IconButton>
      </Tooltip>
      {anchor && (
        <WhyRecommendedPopover
          anchor={anchor}
          onClose={() => setAnchor(null)}
          reason={reason}
          post={post}
          verdict={verdict}
          onBlock={onBlock}
        />
      )}
    </>
  );
});

export default WhyRecommended;
