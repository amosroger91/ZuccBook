import { useEffect, useRef, useState, useCallback } from "react";
import { Box, Stack, Typography, TextField, IconButton, Avatar, Chip } from "@mui/material";
import SendRoundedIcon from "@mui/icons-material/SendRounded";
import GlassCard from "@/components/common/GlassCard";
import { storage } from "@/services/storage";
import { peerService } from "@/services/peerService";
import { identityService } from "@/services/identityService";
import { useStore } from "@/store/useStore";
import { bus } from "@/lib/events";
import { avatarGradient, initials } from "@/components/common/avatar";
import { clockTime } from "@/lib/time";
import { newId } from "@/lib/id";
import type { ChatMessage } from "@/types";

export default function MessagesView() {
  const me = useStore((s) => s.me);
  const presence = useStore((s) => s.presence);
  const [channel, setChannel] = useState("swarm");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  const channels = [{ id: "swarm", label: "🛰️ Swarm Lounge" }, ...presence.map((p) => ({ id: dmChannel(me?.publicKey ?? "", p.pk), label: p.username }))];

  const load = useCallback(() => { storage.messages(channel).then(setMessages); }, [channel]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const off = bus.on("chat:message", (m) => { if (m.channel === channel) load(); });
    return off;
  }, [channel, load]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  async function send() {
    const t = input.trim();
    if (!t) return;
    const msg: ChatMessage = {
      id: newId("msg"), channel, author: identityService.pk, authorName: me?.username ?? "me",
      text: t, reactions: {}, createdAt: Date.now(),
    };
    await storage.putMessage(msg);
    peerService.sendDM(msg);
    setInput(""); load();
  }

  return (
    <Box sx={{ maxWidth: 1000, mx: "auto", display: "grid", gridTemplateColumns: { xs: "1fr", sm: "220px 1fr" }, gap: 2, height: "100%" }}>
      <GlassCard sx={{ display: { xs: "none", sm: "block" } }}>
        <Typography variant="overline" color="text.secondary">Conversations</Typography>
        <Stack spacing={0.5} sx={{ mt: 1 }}>
          {channels.map((c) => (
            <Box key={c.id} onClick={() => setChannel(c.id)} sx={{ px: 1.2, py: 0.9, borderRadius: 1.5, cursor: "pointer", fontWeight: 600, background: channel === c.id ? "rgba(110,231,255,0.14)" : "transparent", "&:hover": { background: "rgba(110,231,255,0.07)" } }}>
              {c.label}
            </Box>
          ))}
        </Stack>
      </GlassCard>

      <Box sx={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
          <Typography variant="h6">{channels.find((c) => c.id === channel)?.label ?? "Chat"}</Typography>
          <Chip size="small" label={channel === "swarm" ? "public relay" : "direct (E2E in Phase 2)"} variant="outlined" sx={{ opacity: 0.7 }} />
        </Stack>
        <GlassCard sx={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 1 }}>
          {messages.length === 0 && <Typography color="text.secondary">No messages yet. Say hi to the swarm 👋</Typography>}
          {messages.map((m) => {
            const mine = m.author === me?.publicKey;
            return (
              <Stack key={m.id} direction="row" spacing={1} justifyContent={mine ? "flex-end" : "flex-start"}>
                {!mine && <Avatar sx={{ width: 28, height: 28, fontSize: 12, background: avatarGradient(m.author), color: "#04121a", fontWeight: 800 }}>{initials(m.authorName)}</Avatar>}
                <Box sx={{ maxWidth: "70%", px: 1.5, py: 0.9, borderRadius: 2, background: mine ? "linear-gradient(135deg,#6ee7ff,#a78bfa)" : "rgba(255,255,255,0.06)", color: mine ? "#04121a" : "text.primary" }}>
                  {!mine && <Typography variant="caption" sx={{ fontWeight: 700 }}>{m.authorName}</Typography>}
                  <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>{m.text}</Typography>
                  <Typography variant="caption" sx={{ opacity: 0.6 }}>{clockTime(m.createdAt)}</Typography>
                </Box>
              </Stack>
            );
          })}
          <div ref={endRef} />
        </GlassCard>
        <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
          <TextField fullWidth size="small" value={input} placeholder="Message…" onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} />
          <IconButton color="primary" onClick={send}><SendRoundedIcon /></IconButton>
        </Stack>
      </Box>
    </Box>
  );
}

function dmChannel(a: string, b: string) { return "dm:" + [a, b].sort().join(":"); }
