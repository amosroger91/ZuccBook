import { useEffect, useRef, useState, useCallback } from "react";
import {
  Box, Stack, Typography, TextField, IconButton, Button, Chip, Popover, Tooltip, LinearProgress,
} from "@mui/material";
import SendRoundedIcon from "@mui/icons-material/SendRounded";
import ImageRoundedIcon from "@mui/icons-material/ImageRounded";
import MicRoundedIcon from "@mui/icons-material/MicRounded";
import VideocamRoundedIcon from "@mui/icons-material/VideocamRounded";
import AddReactionRoundedIcon from "@mui/icons-material/AddReactionRounded";
import LogoutRoundedIcon from "@mui/icons-material/LogoutRounded";
import GlassCard from "@/components/common/GlassCard";
import UserAvatar from "@/components/common/UserAvatar";
import { useSearchParams } from "react-router-dom";
import { joinChatroom, type RoomMember } from "@/services/chatroomService";
import * as chatMedia from "@/services/chatMedia";
import { storage } from "@/services/storage";
import { readDataUrl } from "@/lib/image";
import { clockTime } from "@/lib/time";
import { useStore } from "@/store/useStore";
import { toast } from "@/lib/events";
import type { ChatMessage } from "@/types";

const ROOMS = ["lounge", "gaming", "music", "study", "late-night", "tech-talk"];
const REACTIONS = ["⭐", "🔥", "😂", "❤️", "👀", "🎉"];

export default function ChatroomView({ fullWidth }: { fullWidth?: boolean } = {}) {
  const me = useStore((s) => s.me);
  const [params] = useSearchParams();
  const autoJoined = useRef(false);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [custom, setCustom] = useState("");

  // in-room state
  const ctrl = useRef<ReturnType<typeof joinChatroom> | null>(null);
  const [status, setStatus] = useState("");
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [capped, setCapped] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [mic, setMic] = useState(false);
  const [cam, setCam] = useState(false);
  const [streams, setStreams] = useState<Record<string, MediaStream>>({});
  const [reactAnchor, setReactAnchor] = useState<{ el: HTMLElement; id: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const seen = useRef<Set<string>>(new Set());

  const renderMsg = useCallback((m: ChatMessage) => {
    setMessages((prev) => (seen.current.has(m.id) ? prev.map((x) => (x.id === m.id ? m : x)) : (seen.current.add(m.id), [...prev, m])));
  }, []);

  function enter(id: string) {
    if (!me) return;
    leave();
    setRoomId(id); setMessages([]); seen.current = new Set(); setMembers([]);
    ctrl.current = joinChatroom({
      roomId: id,
      identity: { id: me.publicKey, name: me.username, avatar: me.avatar },
      handlers: {
        onStatus: setStatus,
        onRoster: (m, info) => { setMembers(m); setCapped(info.capped); },
        onHistory: (msgs) => msgs.forEach(renderMsg),
        onChat: (m) => renderMsg(m),
        onReact: (msgId, reactions) => setMessages((prev) => prev.map((x) => (x.id === msgId ? { ...x, reactions } : x))),
        onRemoteStream: (id2, stream) => setStreams((s) => ({ ...s, [id2]: stream })),
        onRemoteEnd: (id2) => setStreams((s) => { const n = { ...s }; delete n[id2]; return n; }),
        onError: (t) => toast("Room error: " + t, "warn"),
      },
    });
  }
  function leave() {
    ctrl.current?.leave(); ctrl.current = null;
    chatMedia.stopLocal(); setMic(false); setCam(false); setStreams({});
    setRoomId(null);
  }
  useEffect(() => () => leave(), []); // cleanup on unmount
  // Deep-link: /chatroom?room=<id> (e.g. a group's chat) auto-enters that room.
  useEffect(() => { const r = params.get("room"); if (r && me && !autoJoined.current) { autoJoined.current = true; enter(r); } }, [params, me]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  async function applyMedia(nextMic: boolean, nextCam: boolean) {
    try { await chatMedia.setMedia({ audio: nextMic, video: nextCam }); }
    catch { toast("Couldn't access mic/camera", "warn"); setMic(false); setCam(false); await chatMedia.setMedia({ audio: false, video: false }).catch(() => {}); }
    const local = chatMedia.getLocalStream();
    setStreams((s) => { const n = { ...s }; if (local && me) n[me.publicKey] = local; else if (me) delete n[me.publicKey]; return n; });
    ctrl.current?.refreshMedia();
  }
  function toggleMic() { const v = !mic; setMic(v); applyMedia(v, cam); }
  function toggleCam() { const v = !cam; setCam(v); applyMedia(mic, v); }

  function send() {
    const t = input.trim(); if (!t || !ctrl.current) return;
    ctrl.current.sendChat(t); setInput("");
  }
  async function attach(file?: File) {
    if (!file || !ctrl.current) return;
    const url = await readDataUrl(file);
    ctrl.current.sendImage(url, file.type);
  }

  /* ---------------- lobby (no room yet) ---------------- */
  if (!roomId) {
    return (
      <Box sx={{ maxWidth: fullWidth ? "100%" : 800, mx: fullWidth ? 0 : "auto", width: "100%" }}>
        <Typography variant="h5">Chatrooms</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Live peer-to-peer rooms — text chat, presence, reactions, image sharing and voice/video, all with no server. Pick a room (everyone who picks the same one lands together) or make your own.
        </Typography>
        <GlassCard sx={{ mb: 2 }}>
          <Stack direction="row" spacing={1}>
            <TextField fullWidth size="small" placeholder="Make or join a room by name…" value={custom} onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => e.key === "Enter" && custom.trim() && enter(custom.trim().toLowerCase())} />
            <Button variant="contained" disabled={!custom.trim()} onClick={() => enter(custom.trim().toLowerCase())}>Join</Button>
          </Stack>
        </GlassCard>
        <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
          {ROOMS.map((r) => (
            <Chip key={r} label={"#" + r} onClick={() => enter(r)} sx={{ bgcolor: "rgba(58,123,240,0.14)", color: "#0a55cf", fontWeight: 600 }} />
          ))}
        </Stack>
      </Box>
    );
  }

  /* ---------------- in a room ---------------- */
  const tiles = Object.entries(streams);
  return (
    <Box sx={{ width: "100%", height: "100%", display: "grid", gridTemplateColumns: { xs: "1fr", sm: "200px 1fr" }, gap: 2, minHeight: 0 }}>
      <GlassCard sx={{ display: { xs: "none", sm: "block" }, height: "fit-content" }}>
        <Stack direction="row" alignItems="center" sx={{ mb: 1 }}>
          <Typography variant="overline" color="text.secondary" sx={{ flex: 1 }}>In room ({members.length})</Typography>
        </Stack>
        <Stack spacing={0.5}>
          {members.map((m) => (
            <Stack key={m.id} direction="row" spacing={1} alignItems="center">
              <UserAvatar pk={m.id} name={m.name} avatar={m.avatar} size={24} />
              <Typography variant="body2" noWrap sx={{ flex: 1 }}>{m.name}{m.id === me?.publicKey ? " (you)" : ""}</Typography>
              {m.av && <MicRoundedIcon sx={{ fontSize: 14, color: "#54c95a" }} />}
            </Stack>
          ))}
        </Stack>
        {capped && <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: "block" }}>Big room — voice/video paused above {8} people.</Typography>}
      </GlassCard>

      <Box sx={{ display: "flex", flexDirection: "column", minHeight: 0, height: "100%" }}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1, flexWrap: "wrap" }}>
          <Typography variant="h6" sx={{ flex: 1, minWidth: 0, wordBreak: "break-word" }}>#{roomId}</Typography>
          <Chip size="small" label={status} variant="outlined" sx={{ opacity: 0.7 }} />
          <Tooltip title="Mic"><IconButton color={mic ? "primary" : "default"} onClick={toggleMic} disabled={capped && !mic}><MicRoundedIcon /></IconButton></Tooltip>
          <Tooltip title="Camera"><IconButton color={cam ? "primary" : "default"} onClick={toggleCam} disabled={capped && !cam}><VideocamRoundedIcon /></IconButton></Tooltip>
          <Tooltip title="Leave"><IconButton onClick={leave}><LogoutRoundedIcon /></IconButton></Tooltip>
        </Stack>

        {tiles.length > 0 && (
          <Stack direction="row" spacing={1} sx={{ mb: 1, overflowX: "auto", pb: 0.5 }}>
            {tiles.map(([id, stream]) => (
              <Box key={id} sx={{ position: "relative", flex: { xs: "0 0 calc(50% - 4px)", sm: "0 0 auto" }, width: { xs: "auto", sm: 160 }, height: { xs: 120, sm: 120 }, borderRadius: 2, overflow: "hidden", border: "1px solid rgba(0,0,0,0.14)", background: "#05080f" }}>
                <video autoPlay playsInline muted={id === me?.publicKey} ref={(el) => { if (el && el.srcObject !== stream) el.srcObject = stream; }} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                <Typography variant="caption" sx={{ position: "absolute", left: 0, bottom: 0, px: 0.8, background: "rgba(0,0,0,0.6)" }}>
                  {members.find((m) => m.id === id)?.name ?? (id === me?.publicKey ? "You" : "Guest")}
                </Typography>
              </Box>
            ))}
          </Stack>
        )}

        <GlassCard sx={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 1, minHeight: 0 }}>
          {messages.length === 0 && <Typography color="text.secondary">No messages yet — say hi 👋</Typography>}
          {messages.map((m) => {
            if (m.author === "system") return <Typography key={m.id} variant="caption" color="text.secondary" sx={{ alignSelf: "center", fontStyle: "italic" }}>{m.text}</Typography>;
            const mine = m.author === me?.publicKey;
            return (
              <Stack key={m.id} direction="row" spacing={1} justifyContent={mine ? "flex-end" : "flex-start"} sx={{ "&:hover .react-add": { opacity: 0.8 } }}>
                {!mine && <UserAvatar pk={m.author} name={m.authorName} avatar={m.authorAvatar} size={28} />}
                <Box sx={{ maxWidth: { xs: "85%", sm: "72%" } }}>
                  <Box sx={{ px: 1.5, py: 0.9, borderRadius: 2, background: mine ? "linear-gradient(135deg,#3f97ff,#1668e0)" : "#ffffff", color: mine ? "#ffffff" : "text.primary" }}>
                    {!mine && <Typography variant="caption" sx={{ fontWeight: 700 }}>{m.authorName}</Typography>}
                    {m.text && <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{m.text}</Typography>}
                    {m.media?.map((md, i) => md.type === "image" ? <Box key={i} component="img" src={md.url} sx={{ mt: 0.5, maxWidth: "100%", maxHeight: 240, borderRadius: 1.5 }} /> : null)}
                    <Typography variant="caption" sx={{ opacity: 0.6 }}>{clockTime(m.createdAt)}</Typography>
                  </Box>
                  <Stack direction="row" spacing={0.5} sx={{ mt: 0.3, flexWrap: "wrap" }} justifyContent={mine ? "flex-end" : "flex-start"}>
                    {Object.entries(m.reactions || {}).filter(([, v]) => v.length).map(([e, v]) => (
                      <Chip key={e} size="small" label={`${e} ${v.length}`} onClick={() => ctrl.current?.sendReact(m.id, e)} sx={{ height: 20, bgcolor: v.includes(me?.publicKey ?? "") ? "rgba(58,155,240,0.3)" : "#ffffff", cursor: "pointer" }} />
                    ))}
                    <IconButton className="react-add" size="small" sx={{ opacity: 0, transition: "opacity .15s" }} onClick={(e) => setReactAnchor({ el: e.currentTarget, id: m.id })}><AddReactionRoundedIcon sx={{ fontSize: 16 }} /></IconButton>
                  </Stack>
                </Box>
              </Stack>
            );
          })}
          <div ref={endRef} />
        </GlassCard>

        <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
          <Tooltip title="Share image"><IconButton onClick={() => fileRef.current?.click()}><ImageRoundedIcon /></IconButton></Tooltip>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { attach(e.target.files?.[0]); e.currentTarget.value = ""; }} />
          <TextField fullWidth size="small" value={input} placeholder="Message the room…" onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} />
          <IconButton color="primary" onClick={send}><SendRoundedIcon /></IconButton>
        </Stack>
      </Box>

      <Popover open={!!reactAnchor} anchorEl={reactAnchor?.el} onClose={() => setReactAnchor(null)}>
        <Stack direction="row" sx={{ p: 0.5 }}>
          {REACTIONS.map((e) => <IconButton key={e} onClick={() => { ctrl.current?.sendReact(reactAnchor!.id, e); setReactAnchor(null); }}><span style={{ fontSize: 18 }}>{e}</span></IconButton>)}
        </Stack>
      </Popover>
    </Box>
  );
}
