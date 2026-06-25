import { useRef, useState, useEffect } from "react";
import { Stack, TextField, Button, IconButton, Box, Chip, Tooltip, Typography, Select, MenuItem, useMediaQuery } from "@mui/material";
import type { Theme } from "@mui/material";
import ImageRoundedIcon from "@mui/icons-material/ImageRounded";
import GifBoxRoundedIcon from "@mui/icons-material/GifBoxRounded";
import AudiotrackRoundedIcon from "@mui/icons-material/AudiotrackRounded";
import CodeRoundedIcon from "@mui/icons-material/CodeRounded";
import AutoFixHighRoundedIcon from "@mui/icons-material/AutoFixHighRounded";
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import GlassCard from "@/components/common/GlassCard";
import GifPicker from "@/components/common/GifPicker";
import HtmlComposer from "./HtmlComposer";
import { compressPostImage } from "@/lib/image";
import { feedService } from "@/services/feedService";
import { nostrService } from "@/services/nostrService";
import { peerService } from "@/services/peerService";
import { companionService } from "@/services/companionService";
import { moderationService } from "@/services/moderationService";
import { useStore } from "@/store/useStore";
import UserAvatar from "@/components/common/UserAvatar";
import { toast } from "@/lib/events";
import type { MediaRef } from "@/types";

export default function Composer({ community }: { community?: string }) {
  const me = useStore((s) => s.me);
  const moderation = useStore((s) => s.settings.moderationProfile);
  const nostrEnabled = useStore((s) => s.settings.nostrEnabled !== false);
  const [target, setTarget] = useState<"ledger" | "both" | "nostr">("ledger");
  const [text, setText] = useState("");
  const [media, setMedia] = useState<MediaRef[]>([]);
  const [gifOpen, setGifOpen] = useState(false);
  const [htmlOpen, setHtmlOpen] = useState(false);
  const [showPermanentWarning, setShowPermanentWarning] = useState<boolean>(() => {
    try { return localStorage.getItem("composer:permanentWarningDismissed") !== "1"; } catch { return true; }
  });
  const fileRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLInputElement>(null);
  // Phone: the visibility picker + Post become a full-bleed bottom bar (two halves
  // spanning the whole card). Larger screens keep them inline in the toolbar.
  const phone = useMediaQuery((t: Theme) => t.breakpoints.down("sm"));

  async function attach(file?: File) {
    if (!file) return;
    // Downscale so the image is small enough to persist locally and sync over
    // the relay (full-res photos get dropped on round-trip).
    const url = await compressPostImage(file);
    setMedia((m) => [...m, { type: "image", url, mime: file.type === "image/gif" ? "image/gif" : "image/jpeg", bytes: url.length }]);
  }

  async function attachAudio(file?: File) {
    if (!file) return;
    // Audio is stored as a data URL (local-first, no server). Cap the size so a
    // huge file doesn't bloat the post as it syncs over the relay.
    if (file.size > 12 * 1024 * 1024) { toast("That mp3 is over 12 MB — pick a smaller file to share it on your timeline.", "warn"); return; }
    const url = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.readAsDataURL(file); });
    setMedia((m) => [...m, { type: "audio", url, mime: file.type || "audio/mpeg", bytes: file.size, alt: file.name.replace(/\.[^.]+$/, "") }]);
  }

  async function postHtml(html: string) {
    const p = await feedService.createPost({ html, community });
    peerService.publishPost(p);
    toast(community ? "HTML posted to the group — it's permanent now ✦" : "HTML posted — it's out there forever ✦", "success");
  }

  async function post() {
    const body = text.trim();
    if (!body && !media.length) return;
    const verdict = moderationService.classify(body, moderation);
    if (verdict.action === "flag" || verdict.action === "hide") { toast(`This would be flagged: ${verdict.reasoning} — edit and retry`, "warn"); return; }
    const toNostr = nostrEnabled && target !== "ledger";
    const toLedger = target !== "nostr";
    if (toLedger) {
      const p = await feedService.createPost({ text: body, media: media.length ? media : undefined, community });
      peerService.publishPost(p);
    }
    if (toNostr && body) {
      const tags = [...new Set((body.match(/#[a-z0-9_]+/gi) ?? []).map((t) => t.slice(1).toLowerCase()))];
      nostrService.publishNote(body, tags).catch(() => {});
    }
    setText(""); setMedia([]); setTarget("ledger");
    const where = toLedger && toNostr ? "Ledger + Nostr" : toNostr ? "Nostr" : community ? "the group" : "Ledger";
    toast(`Posted to ${where} — it's out there forever ✦`, "success");
  }

  return (
    <GlassCard sx={{ mb: 2, p: { xs: 1.5, sm: 2 }, overflow: "hidden" }}>
      <Stack direction="row" spacing={{ xs: 1, sm: 1.5 }}>
        <UserAvatar pk={me?.publicKey ?? ""} name={me?.username ?? "?"} avatar={me?.avatar} />
        <Box sx={{ flex: 1 }}>
          <TextField
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Broadcast to the swarm…  (#tags work, every post is signed)"
            fullWidth multiline minRows={3} maxRows={10} variant="standard"
            InputProps={{ disableUnderline: true, sx: { fontSize: 18, pt: 0.6, pb: 0.6 } }}
          />
          {media.length > 0 && (
            <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: "wrap", alignItems: "center" }}>
              {media.map((m, i) => (
                m.type === "audio"
                  ? <Chip key={i} icon={<AudiotrackRoundedIcon />} label={m.alt || "audio"} onDelete={() => setMedia((x) => x.filter((_, j) => j !== i))} sx={{ bgcolor: "rgba(124,92,255,0.12)" }} />
                  : <Box key={i} component="img" src={m.url} sx={{ width: { xs: 72, sm: 84 }, height: { xs: 72, sm: 84 }, objectFit: "cover", borderRadius: 2, border: "1px solid rgba(58,155,240,0.2)", cursor: "pointer" }} onClick={() => setMedia((x) => x.filter((_, j) => j !== i))} />
              ))}
            </Stack>
          )}
          <Stack direction="row" alignItems="center" useFlexGap flexWrap="wrap" spacing={0.5} sx={{ mt: 1, rowGap: 0.5 }}>
            <Tooltip title="Attach image"><IconButton size="small" onClick={() => fileRef.current?.click()}><ImageRoundedIcon fontSize="small" /></IconButton></Tooltip>
            <Tooltip title="Add a GIF"><IconButton size="small" onClick={() => setGifOpen(true)}><GifBoxRoundedIcon fontSize="small" /></IconButton></Tooltip>
            <Tooltip title="Share an mp3"><IconButton size="small" onClick={() => audioRef.current?.click()}><AudiotrackRoundedIcon fontSize="small" /></IconButton></Tooltip>
            <Tooltip title="HTML post / embed (map, game, custom)"><IconButton size="small" onClick={() => setHtmlOpen(true)}><CodeRoundedIcon fontSize="small" /></IconButton></Tooltip>
            <Tooltip title="Companion: draft a fresh post"><IconButton size="small" onClick={async () => { const { posts } = await feedService.generate("trending", { moderation }); setText(companionService.draftPost(posts)); }}><AutoFixHighRoundedIcon fontSize="small" /></IconButton></Tooltip>
            {/* Desktop: the visibility picker + Post sit inline, right-aligned, beside
                the toolbar icons. On phones they move to the full-bleed footer below. */}
            {!phone && (
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, ml: "auto" }}>
                {nostrEnabled && (
                  <Tooltip title="Where this post goes">
                    <Select size="small" value={target} onChange={(e) => setTarget(e.target.value as "ledger" | "both" | "nostr")}
                      sx={{ height: 32, fontSize: 13, "& .MuiSelect-select": { py: 0.4 } }}>
                      <MenuItem value="ledger">Ledger only</MenuItem>
                      <MenuItem value="both">Ledger + Nostr</MenuItem>
                      <MenuItem value="nostr">Nostr only</MenuItem>
                    </Select>
                  </Tooltip>
                )}
                <Button variant="contained" onClick={post} disabled={(!text.trim() && !media.length) || (target === "nostr" && !text.trim())}
                  sx={{ px: 2.5 }}>Post</Button>
              </Box>
            )}
          </Stack>
        </Box>
      </Stack>
      {showPermanentWarning && (
        // Full-bleed banner: negative margins cancel the card's padding on the
        // left/right so it spans the whole card (overflow:hidden rounds the corners).
        // On a phone the action bar sits below it, so it's only flush to the bottom
        // edge (mb negative) on larger screens where it IS the bottom element.
        <Box role="status" aria-live="polite" sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: { xs: 1.5, sm: 2 }, mx: { xs: -1.5, sm: -2 }, mb: { xs: 0, sm: -2 }, px: { xs: 1.5, sm: 2 }, py: 0.75, bgcolor: 'rgba(255,243,205,0.98)', borderTop: '1px solid rgba(255,235,59,0.32)' }}>
          <Typography variant="caption" color="text.primary" sx={{ flex: 1, lineHeight: 1.25 }}>
            🔗 Posting is <b>permanent</b> — once it's out, it spreads across the network and can't be unsent or deleted. Post like it's forever, because it is.
          </Typography>
          <IconButton size="small" aria-label="Dismiss permanent posting warning" onClick={() => { try { localStorage.setItem("composer:permanentWarningDismissed", "1"); } catch {} setShowPermanentWarning(false); }} sx={{ mr: -0.5 }}>
            <CloseRoundedIcon fontSize="small" />
          </IconButton>
        </Box>
      )}
      {phone && (
        // Phone action bar — full-bleed, flush to the bottom edge, two equal halves
        // (visibility picker | Post) spanning the whole card just like the banner. It
        // sits under the warning while that's shown, and becomes the bottom bar once
        // it's dismissed. Card overflow:hidden rounds the outer corners.
        <Box sx={{ display: "grid", gridTemplateColumns: nostrEnabled ? "1fr 1fr" : "1fr", mx: -1.5, mb: -1.5, mt: showPermanentWarning ? 0 : 1.5, borderTop: "1px solid var(--bl-line)" }}>
          {nostrEnabled && (
            <Select value={target} onChange={(e) => setTarget(e.target.value as "ledger" | "both" | "nostr")}
              variant="standard" disableUnderline
              sx={{ height: 52, px: 1.75, fontSize: 14, fontWeight: 600, color: "text.primary", bgcolor: "rgba(58,155,240,0.06)", borderRight: "1px solid var(--bl-line)",
                "& .MuiSelect-select": { display: "flex", alignItems: "center", height: "100%", py: 0, pr: 3.5, boxSizing: "border-box" }, "& .MuiSelect-icon": { right: 8 } }}>
              <MenuItem value="ledger">Ledger only</MenuItem>
              <MenuItem value="both">Ledger + Nostr</MenuItem>
              <MenuItem value="nostr">Nostr only</MenuItem>
            </Select>
          )}
          <Button variant="contained" onClick={post} disabled={(!text.trim() && !media.length) || (target === "nostr" && !text.trim())}
            sx={{ height: 52, borderRadius: 0, boxShadow: "none", fontSize: 15, fontWeight: 700 }}>Post</Button>
        </Box>
      )}
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => attach(e.target.files?.[0])} />
      <input ref={audioRef} type="file" accept="audio/*,.mp3" hidden onChange={(e) => attachAudio(e.target.files?.[0])} />
      <GifPicker open={gifOpen} onClose={() => setGifOpen(false)} onPick={(url) => setMedia((m) => [...m, { type: "image", url, mime: "image/gif" }])} />
      <HtmlComposer open={htmlOpen} onClose={() => setHtmlOpen(false)} onPost={postHtml} />
    </GlassCard>
  );
}
