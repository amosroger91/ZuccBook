import { useEffect, useRef, useState, useCallback } from "react";
import { Box, Stack, Typography, TextField, IconButton, Avatar, Chip } from "@mui/material";
import SendRoundedIcon from "@mui/icons-material/SendRounded";
import GlassCard from "@/components/common/GlassCard";
import { storage } from "@/services/storage";
import { peerService } from "@/services/peerService";
import { identityService } from "@/services/identityService";
import { useStore } from "@/store/useStore";
import { bus } from "@/lib/events";
import UserAvatar from "@/components/common/UserAvatar";
import { clockTime } from "@/lib/time";
import { newId } from "@/lib/id";
import type { ChatMessage } from "@/types";

export default function MessagesView({ fullWidth }: { fullWidth?: boolean } = {}) {
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
      id: newId("msg"), channel, author: identityService.pk, authorName: me?.username ?? "me", authorAvatar: me?.avatar,
      text: t, reactions: {}, createdAt: Date.now(),
    };
    await storage.putMessage(msg);
    peerService.sendDM(msg);                 // live relay
    if (channel === "swarm") bus.emit("swarm:publish", msg);  // durable (Gun)
    setInput(""); load();
  }

  return (
    <Box sx={{ width: "100%", display: "grid", gridTemplateColumns: { xs: "1fr", sm: "220px 1fr" }, gap: 2, height: "100%", minHeight: 0 }}>
      <GlassCard sx={{ display: { xs: "none", sm: "block" }, height: "fit-content" }}>
        <Typography variant="overline" color="text.secondary">Conversations</Typography>
        <Stack spacing={0.5} sx={{ mt: 1 }}>
          {channels.map((c) => (
            <Box key={c.id} onClick={() => setChannel(c.id)} sx={{ px: 1.2, py: 0.9, borderRadius: 1.5, cursor: "pointer", fontWeight: 600, background: channel === c.id ? "rgba(58,155,240,0.14)" : "transparent", "&:hover": { background: "rgba(58,155,240,0.07)" } }}>
              {c.label}
            </Box>
          ))}
        </Stack>
      </GlassCard>

      <Box sx={{ display: "flex", flexDirection: "column", minHeight: 0, height: "100%" }}>
        {/* on phones the sidebar is hidden — pick a conversation here */}
        <TextField select size="small" value={channel} onChange={(e) => setChannel(e.target.value)} sx={{ mb: 1, display: { xs: "block", sm: "none" } }} SelectProps={{ native: true }}>
          {channels.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </TextField>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1, flexWrap: "wrap" }}>
          <Typography variant="h6" sx={{ flex: 1, minWidth: 0, wordBreak: "break-word" }}>{channels.find((c) => c.id === channel)?.label ?? "Chat"}</Typography>
          <Chip size="small" label={channel === "swarm" ? "public relay" : "direct (E2E in Phase 2)"} variant="outlined" sx={{ opacity: 0.7 }} />
        </Stack>
        <GlassCard sx={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 1, minHeight: 0 }}>
          {messages.length === 0 && <Typography color="text.secondary">No messages yet. Say hi to the swarm 👋</Typography>}
          {messages.map((m) => {
            const mine = m.author === me?.publicKey;
            return (
              <Stack key={m.id} direction="row" spacing={1} justifyContent={mine ? "flex-end" : "flex-start"}>
                {!mine && <UserAvatar pk={m.author} name={m.authorName} avatar={m.authorAvatar} size={28} />}
                <Box sx={{ maxWidth: "70%", px: 1.5, py: 0.9, borderRadius: 2, background: mine ? "linear-gradient(135deg,#3f97ff,#1668e0)" : "#ffffff", color: mine ? "#ffffff" : "text.primary" }}>
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
