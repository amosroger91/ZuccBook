import { useRef, useState, useEffect } from "react";
import { Stack, TextField, Button, IconButton, Box, Chip, Tooltip, Typography } from "@mui/material";
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
  const [text, setText] = useState("");
  const [media, setMedia] = useState<MediaRef[]>([]);
  const [gifOpen, setGifOpen] = useState(false);
  const [htmlOpen, setHtmlOpen] = useState(false);
  const [showPermanentWarning, setShowPermanentWarning] = useState<boolean>(() => {
    try { return localStorage.getItem("composer:permanentWarningDismissed") !== "1"; } catch { return true; }
  });
  const fileRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLInputElement>(null);

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
    const p = await feedService.createPost({ text: body, media: media.length ? media : undefined, community });
    peerService.publishPost(p);
    setText(""); setMedia([]);
    toast(community ? "Posted to the group — it's permanent now ✦" : "Posted & signed — it's out there forever ✦", "success");
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
            <Box sx={{ flex: 1, minWidth: 8 }} />
            <Chip size="small" variant="outlined" label="local-only until posted" sx={{ opacity: 0.6, display: { xs: "none", sm: "inline-flex" } }} />
            <Button variant="contained" onClick={post} disabled={!text.trim() && !media.length} sx={{ ml: "auto" }}>Post</Button>
          </Stack>
        </Box>
      </Stack>
      {showPermanentWarning && (
        // Full-bleed footer: negative margins cancel the card's padding on the
        // left/right/bottom so the banner spans the whole card and sits flush
        // with the bottom edge (overflow:hidden on the card rounds its corners).
        <Box role="status" aria-live="polite" sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: { xs: 1.5, sm: 2 }, mx: { xs: -1.5, sm: -2 }, mb: { xs: -1.5, sm: -2 }, px: { xs: 1.5, sm: 2 }, py: 0.75, bgcolor: 'rgba(255,243,205,0.98)', borderTop: '1px solid rgba(255,235,59,0.32)' }}>
          <Typography variant="caption" color="text.primary" sx={{ flex: 1, lineHeight: 1.25 }}>
            🔗 Posting is <b>permanent</b> — once it's out, it spreads across the network and can't be unsent or deleted. Post like it's forever, because it is.
          </Typography>
          <IconButton size="small" aria-label="Dismiss permanent posting warning" onClick={() => { try { localStorage.setItem("composer:permanentWarningDismissed", "1"); } catch {} setShowPermanentWarning(false); }} sx={{ mr: -0.5 }}>
            <CloseRoundedIcon fontSize="small" />
          </IconButton>
        </Box>
      )}
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => attach(e.target.files?.[0])} />
      <input ref={audioRef} type="file" accept="audio/*,.mp3" hidden onChange={(e) => attachAudio(e.target.files?.[0])} />
      <GifPicker open={gifOpen} onClose={() => setGifOpen(false)} onPick={(url) => setMedia((m) => [...m, { type: "image", url, mime: "image/gif" }])} />
      <HtmlComposer open={htmlOpen} onClose={() => setHtmlOpen(false)} onPost={postHtml} />
    </GlassCard>
  );
}
