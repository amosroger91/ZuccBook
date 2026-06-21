import { useState } from "react";
import { IconButton, Popover, Box, Typography, Stack, LinearProgress, Tooltip, Chip } from "@mui/material";
import InsightsRoundedIcon from "@mui/icons-material/InsightsRounded";
import type { RecommendationReason } from "@/types";

/** "Why am I seeing this?" — the recommendation is fully transparent. */
export default function WhyRecommended({ reason }: { reason?: RecommendationReason }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  if (!reason) return null;
  const max = Math.max(1, ...reason.factors.map((f) => Math.abs(f.weight)));

  return (
    <>
      <Tooltip title="Why am I seeing this?">
        <IconButton size="small" onClick={(e) => setAnchor(e.currentTarget)}><InsightsRoundedIcon fontSize="small" /></IconButton>
      </Tooltip>
      <Popover open={!!anchor} anchorEl={anchor} onClose={() => setAnchor(null)} anchorOrigin={{ vertical: "bottom", horizontal: "right" }} transformOrigin={{ vertical: "top", horizontal: "right" }}>
        <Box sx={{ p: 2, width: 320 }}>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
            <Typography variant="subtitle2">Why you're seeing this</Typography>
            <Chip size="small" label={reason.algorithm} />
          </Stack>
          <Typography variant="caption" color="text.secondary">Score {reason.score.toFixed(2)} · computed locally on your device</Typography>
          <Stack spacing={1.2} sx={{ mt: 1.5 }}>
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
        </Box>
      </Popover>
    </>
  );
}
