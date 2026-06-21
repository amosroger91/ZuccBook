import { useEffect, useRef, useState } from "react";
import { Box, Stack, Typography, IconButton, TextField, Avatar, Tooltip, Badge, CircularProgress } from "@mui/material";
import AutoAwesomeRoundedIcon from "@mui/icons-material/AutoAwesomeRounded";
import ForumRoundedIcon from "@mui/icons-material/ForumRounded";
import SendRoundedIcon from "@mui/icons-material/SendRounded";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import RemoveRoundedIcon from "@mui/icons-material/Remove";
import OpenInFullRoundedIcon from "@mui/icons-material/OpenInFullRounded";
import { useNavigate } from "react-router-dom";
import UserAvatar from "@/components/common/UserAvatar";
import { companionService } from "@/services/companionService";
import { joinChatroom } from "@/services/chatroomService";
import { useStore } from "@/store/useStore";
import { bus } from "@/lib/events";
import { clockTime } from "@/lib/time";
import type { CompanionMessage, ChatMessage } from "@/types";

const PANEL_SX = {
  position: "fixed" as const, right: 16, bottom: 150, zIndex: 1291,
  width: { xs: "calc(100vw - 32px)", sm: 350 }, height: "min(72vh, 470px)",
  display: "flex", flexDirection: "column", overflow: "hidden", borderRadius: 3,
  bgcolor: "var(--bl-face)", border: "1px solid var(--bl-edge-frame)", boxShadow: "0 18px 50px rgba(0,0,0,0.45)",
};

function Header({ icon, title, subtitle, onExpand, onMin, onClose }: { icon: React.ReactNode; title: string; subtitle: string; onExpand: () => void; onMin: () => void; onClose: () => void }) {
  return (
    <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 1.25, py: 0.75, color: "#fff", background: "linear-gradient(135deg,#3f97ff,#1668e0,#0a55cf)" }}>
      <Avatar sx={{ width: 28, height: 28, bgcolor: "rgba(255,255,255,0.22)" }}>{icon}</Avatar>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontWeight: 800, fontSize: 14, lineHeight: 1.1 }} noWrap>{title}</Typography>
        <Typography variant="caption" sx={{ opacity: 0.9 }} noWrap>{subtitle}</Typography>
      </Box>
      <Tooltip title="Open full page"><IconButton size="small" sx={{ color: "#fff" }} onClick={onExpand}><OpenInFullRoundedIcon sx={{ fontSize: 16 }} /></IconButton></Tooltip>
      <Tooltip title="Minimize"><IconButton size="small" sx={{ color: "#fff" }} onClick={onMin}><RemoveRoundedIcon sx={{ fontSize: 18 }} /></IconButton></Tooltip>
      <Tooltip title="Close"><IconButton size="small" sx={{ color: "#fff" }} onClick={onClose}><CloseRoundedIcon sx={{ fontSize: 16 }} /></IconButton></Tooltip>
    </Stack>
  );
}

// --- Companion: inline chat against the on-device model ---
function CompanionPanel({ intro, onMin, onClose }: { intro: boolean; onMin: () => void; onClose: () => void }) {
  const nav = useNavigate();
  const me = useStore((s) => s.me);
  const [history, setHistory] = useState<CompanionMessage[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const name = me?.username ? me.username.split(/\s+/)[0] : "there";
  const greeting = `Hey ${name}! 👋 I'm your Companion — a private AI running on your own device. Ask me anything, or tap the expand icon for the full page. 🙂`;

  useEffect(() => { companionService.history().then(setHistory); return bus.on("companion:thinking", setThinking); }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [history, thinking]);

  async function send() {
    const t = input.trim(); if (!t) return;
    setInput("");
    await companionService.ask(t);
    setHistory(await companionService.history());
  }

  return (
    <Box sx={PANEL_SX}>
      <Header icon={<AutoAwesomeRoundedIcon fontSize="small" />} title="Your Companion" subtitle={companionService.modelReady() ? "on-device · ready" : "local engine"} onExpand={() => { onMin(); nav("/companion"); }} onMin={onMin} onClose={onClose} />
      <Box sx={{ flex: 1, overflowY: "auto", p: 1.25, display: "flex", flexDirection: "column", gap: 1 }}>
        {intro && history.length === 0 && (
          <Box sx={{ alignSelf: "flex-start", maxWidth: "85%", px: 1.25, py: 0.9, borderRadius: 2, bgcolor: "#fff" }}>
            <Typography variant="body2">{greeting}</Typography>
          </Box>
        )}
        {history.map((m) => (
          <Box key={m.id} sx={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "85%", px: 1.25, py: 0.9, borderRadius: 2, background: m.role === "user" ? "linear-gradient(135deg,#3f97ff,#1668e0)" : "#fff", color: m.role === "user" ? "#fff" : "text.primary" }}>
            <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{m.text}</Typography>
          </Box>
        ))}
        {thinking && <Stack direction="row" alignItems="center" spacing={1}><CircularProgress size={13} /><Typography variant="caption" color="text.secondary">thinking on-device…</Typography></Stack>}
        <div ref={endRef} />
      </Box>
      <Stack direction="row" spacing={0.5} sx={{ p: 1, borderTop: "1px solid var(--bl-line)" }}>
        <TextField fullWidth size="small" value={input} placeholder="Message your AI…" onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") send(); }} />
        <IconButton color="primary" onClick={send}><SendRoundedIcon /></IconButton>
      </Stack>
    </Box>
  );
}

// --- Chatroom: a compact live Swarm Lounge that stays connected while docked ---
function ChatroomPanel({ visible, onMin, onClose }: { visible: boolean; onMin: () => void; onClose: () => void }) {
  const nav = useNavigate();
  const me = useStore((s) => s.me);
  const ctrl = useRef<ReturnType<typeof joinChatroom> | null>(null);
  const seen = useRef<Set<string>>(new Set());
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState("connecting…");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!me) return;
    const render = (m: ChatMessage) => setMessages((prev) => (seen.current.has(m.id) ? prev.map((x) => (x.id === m.id ? m : x)) : (seen.current.add(m.id), [...prev, m])));
    ctrl.current = joinChatroom({
      roomId: "lounge",
      identity: { id: me.publicKey, name: me.username, avatar: me.avatar },
      handlers: {
        onStatus: setStatus, onRoster: () => {}, onHistory: (msgs) => msgs.forEach(render), onChat: render,
        onReact: () => {}, onRemoteStream: () => {}, onRemoteEnd: () => {}, onError: () => {},
      },
    });
    return () => { ctrl.current?.leave(); ctrl.current = null; };
  }, [me]);
  useEffect(() => { if (visible) endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, visible]);

  function send() { const t = input.trim(); if (!t || !ctrl.current) return; ctrl.current.sendChat(t); setInput(""); }

  return (
    <Box sx={{ ...PANEL_SX, display: visible ? "flex" : "none" }}>
      <Header icon={<ForumRoundedIcon fontSize="small" />} title="Swarm Lounge" subtitle={`#lounge · ${status}`} onExpand={() => { onMin(); nav("/chatroom"); }} onMin={onMin} onClose={onClose} />
      <Box sx={{ flex: 1, overflowY: "auto", p: 1.25, display: "flex", flexDirection: "column", gap: 0.75 }}>
        {messages.length === 0 && <Typography color="text.secondary" variant="body2">No messages yet — say hi 👋</Typography>}
        {messages.map((m) => {
          if (m.author === "system") return <Typography key={m.id} variant="caption" color="text.secondary" sx={{ alignSelf: "center", fontStyle: "italic" }}>{m.text}</Typography>;
          const mine = m.author === me?.publicKey;
          return (
            <Stack key={m.id} direction="row" spacing={0.75} justifyContent={mine ? "flex-end" : "flex-start"}>
              {!mine && <UserAvatar pk={m.author} name={m.authorName} avatar={m.authorAvatar} size={24} />}
              <Box sx={{ maxWidth: "78%", px: 1.1, py: 0.7, borderRadius: 2, background: mine ? "linear-gradient(135deg,#3f97ff,#1668e0)" : "#fff", color: mine ? "#fff" : "text.primary" }}>
                {!mine && <Typography variant="caption" sx={{ fontWeight: 700 }}>{m.authorName}</Typography>}
                {m.text && <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{m.text}</Typography>}
                {m.media?.map((md, i) => md.type === "image" ? <Box key={i} component="img" src={md.url} sx={{ mt: 0.5, maxWidth: "100%", borderRadius: 1 }} /> : null)}
                <Typography variant="caption" sx={{ opacity: 0.6, display: "block" }}>{clockTime(m.createdAt)}</Typography>
              </Box>
            </Stack>
          );
        })}
        <div ref={endRef} />
      </Box>
      <Stack direction="row" spacing={0.5} sx={{ p: 1, borderTop: "1px solid var(--bl-line)" }}>
        <TextField fullWidth size="small" value={input} placeholder="Message the lounge…" onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} />
        <IconButton color="primary" onClick={send}><SendRoundedIcon /></IconButton>
      </Stack>
    </Box>
  );
}

/** Bottom-right floating docks: chat with your Companion or the Swarm Lounge
 *  without leaving the feed. Each minimizes to a bubble and restores on tap;
 *  the chatroom stays connected while minimized so you don't miss messages. */
export default function FloatingDocks() {
  const [companionOpen, setCompanionOpen] = useState(false);
  const [chatActive, setChatActive] = useState(false); // mounted + connected
  const [chatOpen, setChatOpen] = useState(false);      // panel expanded
  const [intro, setIntro] = useState(false);

  // Auto-greet once per session when the on-device AI is ready (or shortly after).
  useEffect(() => {
    if (sessionStorage.getItem("companionIntroSeen")) return;
    let shown = false;
    const show = () => { if (shown) return; shown = true; sessionStorage.setItem("companionIntroSeen", "1"); setIntro(true); setCompanionOpen(true); };
    if (companionService.modelReady()) setTimeout(show, 800);
    const off = bus.on("companion:model", (m) => { if (m.state === "ready") show(); });
    const t = window.setTimeout(show, 5000);
    return () => { off(); clearTimeout(t); };
  }, []);

  const openCompanion = () => { setCompanionOpen(true); setChatOpen(false); };
  const openChat = () => { setChatActive(true); setChatOpen(true); setCompanionOpen(false); };

  return (
    <>
      {companionOpen && <CompanionPanel intro={intro} onMin={() => setCompanionOpen(false)} onClose={() => setCompanionOpen(false)} />}
      {chatActive && <ChatroomPanel visible={chatOpen} onMin={() => setChatOpen(false)} onClose={() => { setChatActive(false); setChatOpen(false); }} />}

      <Stack spacing={1.25} sx={{ position: "fixed", right: 16, bottom: 84, zIndex: 1290, alignItems: "flex-end" }}>
        {!chatOpen && (
          <Tooltip title="Swarm Lounge chat" placement="left">
            <Box onClick={openChat} sx={bubbleSx("#7c5cff")}>
              <Badge color="error" variant="dot" invisible={!chatActive}><ForumRoundedIcon sx={{ color: "#fff" }} /></Badge>
            </Box>
          </Tooltip>
        )}
        {!companionOpen && (
          <Tooltip title="Chat with your Companion" placement="left">
            <Box onClick={openCompanion} sx={bubbleSx("linear-gradient(135deg,#3f97ff,#1668e0)")}>
              <AutoAwesomeRoundedIcon sx={{ color: "#fff" }} />
            </Box>
          </Tooltip>
        )}
      </Stack>
    </>
  );
}

const bubbleSx = (bg: string) => ({
  width: 50, height: 50, borderRadius: "50%", background: bg, display: "grid", placeItems: "center",
  cursor: "pointer", boxShadow: "0 8px 22px rgba(0,0,0,0.4)", transition: "transform .15s ease",
  "&:hover": { transform: "scale(1.06)" },
});
