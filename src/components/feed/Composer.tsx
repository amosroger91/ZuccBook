import { useRef, useState } from "react";
import { Stack, TextField, Button, IconButton, Box, Avatar, Chip, Tooltip } from "@mui/material";
import ImageRoundedIcon from "@mui/icons-material/ImageRounded";
import AutoFixHighRoundedIcon from "@mui/icons-material/AutoFixHighRounded";
import GlassCard from "@/components/common/GlassCard";
import { feedService } from "@/services/feedService";
import { peerService } from "@/services/peerService";
import { companionService } from "@/services/companionService";
import { moderationService } from "@/services/moderationService";
import { useStore } from "@/store/useStore";
import { avatarGradient, initials } from "@/components/common/avatar";
import { toast } from "@/lib/events";
import type { MediaRef } from "@/types";

export default function Composer() {
  const me = useStore((s) => s.me);
  const moderation = useStore((s) => s.settings.moderationProfile);
  const [text, setText] = useState("");
  const [media, setMedia] = useState<MediaRef[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  async function attach(file?: File) {
    if (!file) return;
    const url = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.readAsDataURL(file); });
    setMedia((m) => [...m, { type: "image", url, mime: file.type, bytes: file.size }]);
  }

  async function post() {
    const body = text.trim();
    if (!body && !media.length) return;
    const verdict = moderationService.classify(body, moderation);
    if (!verdict.allowed) { toast(`Held by your "${moderation}" filter (${verdict.reason})`, "warn"); return; }
    const p = await feedService.createPost({ text: body, media: media.length ? media : undefined });
    peerService.publishPost(p);
    setText(""); setMedia([]);
    toast("Posted & signed ✦", "success");
  }

  return (
    <GlassCard sx={{ mb: 2 }}>
      <Stack direction="row" spacing={1.5}>
        <Avatar sx={{ background: avatarGradient(me?.publicKey ?? ""), color: "#04121a", fontWeight: 800 }}>{initials(me?.username ?? "?")}</Avatar>
        <Box sx={{ flex: 1 }}>
          <TextField
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Broadcast to the swarm…  (#tags work, every post is signed)"
            fullWidth multiline minRows={2} maxRows={8} variant="standard"
            InputProps={{ disableUnderline: true, sx: { fontSize: 18 } }}
          />
          {media.length > 0 && (
            <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: "wrap" }}>
              {media.map((m, i) => (
                <Box key={i} component="img" src={m.url} sx={{ width: 84, height: 84, objectFit: "cover", borderRadius: 2, border: "1px solid rgba(110,231,255,0.2)" }} onClick={() => setMedia((x) => x.filter((_, j) => j !== i))} />
              ))}
            </Stack>
          )}
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: 1 }}>
            <Tooltip title="Attach image"><IconButton size="small" onClick={() => fileRef.current?.click()}><ImageRoundedIcon fontSize="small" /></IconButton></Tooltip>
            <Tooltip title="Companion: draft something"><IconButton size="small" onClick={() => setText((t) => t || "Just discovered Nebula — a social platform with no servers. Your feed is ranked on your own device 🤯 #decentralization")}><AutoFixHighRoundedIcon fontSize="small" /></IconButton></Tooltip>
            <Box sx={{ flex: 1 }} />
            <Chip size="small" variant="outlined" label="local-only until posted" sx={{ opacity: 0.6 }} />
            <Button variant="contained" onClick={post} disabled={!text.trim() && !media.length}>Post</Button>
          </Stack>
        </Box>
      </Stack>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => attach(e.target.files?.[0])} />
    </GlassCard>
  );
}
