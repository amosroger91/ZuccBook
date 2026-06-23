import { useEffect, useRef, useState } from "react";
import { Box, Stack, Typography, TextField, IconButton, Chip } from "@mui/material";
import SendRoundedIcon from "@mui/icons-material/SendRounded";
import PublicRoundedIcon from "@mui/icons-material/PublicRounded";
import GlassCard from "@/components/common/GlassCard";
import UserAvatar from "@/components/common/UserAvatar";
import { clockTime } from "@/lib/time";
import { joinGlobalChat, myGlobalAuthor, type GlobalChatController } from "@/services/globalChatService";
import type { ChatMessage } from "@/types";

// Full-page "Global Chat": a public Nostr (NIP-28) channel. Same service as the
// floating dock — anyone on Nostr (any NIP-28 client) shares this room with us.
export default function GlobalChatView() {
  const ctrl = useRef<GlobalChatController | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [mine, setMine] = useState("");
  const [input, setInput] = useState("");
  const [status, setStatus] = useState("connecting…");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    myGlobalAuthor().then((a) => { if (alive) setMine(a); });
    const render = (m: ChatMessage) => setMessages((prev) => {
      // Dedup/upsert against the LIVE list (never an external Set — that breaks under
      // React StrictMode's double-mount): multi-relay copies and the async display-name
      // upgrade update a message in place; a genuinely new message appends in time order.
      const i = prev.findIndex((x) => x.id === m.id);
      if (i >= 0) { const next = prev.slice(); next[i] = { ...next[i], ...m }; return next; }
      return [...prev, m].sort((a, b) => a.createdAt - b.createdAt).slice(-500);
    });
    ctrl.current = joinGlobalChat({ onStatus: setStatus, onChat: render });
    return () => { alive = false; ctrl.current?.leave(); ctrl.current = null; };
  }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  function send() { const t = input.trim(); if (!t || !ctrl.current) return; ctrl.current.sendChat(t); setInput(""); }

  return (
    <Box sx={{ maxWidth: 900, mx: "auto", display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <Stack direction="row" alignItems="center" spacing={1.25} sx={{ mb: 1.5 }}>
        <Box sx={{ width: 40, height: 40, borderRadius: "12px", display: "grid", placeItems: "center", background: "linear-gradient(135deg,#2bb673,#159e63)", color: "#fff" }}><PublicRoundedIcon /></Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="h6" sx={{ lineHeight: 1.1 }}>Global Chat</Typography>
          <Typography variant="caption" color="text.secondary">Public Nostr channel (NIP-28) · anyone on Nostr can join · {status}</Typography>
        </Box>
        <Chip size="small" label="public · global" variant="outlined" sx={{ opacity: 0.7 }} />
      </Stack>
      <GlassCard sx={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 1, minHeight: 0 }}>
        {messages.length === 0 && <Typography color="text.secondary">No messages yet — say hi to the world 🌍</Typography>}
        {messages.map((m) => {
          const isMine = m.author === mine;
          return (
            <Stack key={m.id} direction="row" spacing={1} justifyContent={isMine ? "flex-end" : "flex-start"}>
              {!isMine && <UserAvatar pk={m.author} name={m.authorName} avatar={m.authorAvatar} size={28} />}
              <Box sx={{ maxWidth: "72%", px: 1.5, py: 0.9, borderRadius: 2, background: isMine ? "linear-gradient(135deg,#3f97ff,#1668e0)" : "#ffffff", color: isMine ? "#fff" : "text.primary" }}>
                {!isMine && <Typography variant="caption" sx={{ fontWeight: 700 }}>{m.authorName}</Typography>}
                {m.text && <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{m.text}</Typography>}
                <Typography variant="caption" sx={{ opacity: 0.6, display: "block" }}>{clockTime(m.createdAt)}</Typography>
              </Box>
            </Stack>
          );
        })}
        <div ref={endRef} />
      </GlassCard>
      <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
        <TextField fullWidth size="small" value={input} placeholder="Message the world…" onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} />
        <IconButton color="primary" onClick={send}><SendRoundedIcon /></IconButton>
      </Stack>
    </Box>
  );
}
