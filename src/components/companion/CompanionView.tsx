import { useEffect, useRef, useState } from "react";
import { Box, Stack, Typography, TextField, IconButton, Chip, Avatar, Select, MenuItem, CircularProgress } from "@mui/material";
import SendRoundedIcon from "@mui/icons-material/SendRounded";
import AutoAwesomeRoundedIcon from "@mui/icons-material/AutoAwesomeRounded";
import GlassCard from "@/components/common/GlassCard";
import { companionService } from "@/services/companionService";
import { feedService } from "@/services/feedService";
import { communityService } from "@/services/communityService";
import { useStore } from "@/store/useStore";
import { bus } from "@/lib/events";
import type { CompanionMessage, CompanionPersona } from "@/types";

const PERSONAS: CompanionPersona[] = ["friend", "coach", "comedian", "critic", "researcher"];
const QUICK = ["Summarize my feed", "What's trending?", "Suggest communities", "Is this misinformation?"];

export default function CompanionView() {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const [history, setHistory] = useState<CompanionMessage[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { companionService.history().then(setHistory); const off = bus.on("companion:thinking", setThinking); return off; }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [history, thinking]);

  async function send(text: string) {
    const t = text.trim();
    if (!t) return;
    setInput("");
    const { posts } = await feedService.generate(settings.feedAlgorithm, { moderation: settings.moderationProfile });
    const communities = await communityService.list();
    await companionService.ask(t, { posts, communities });
    setHistory(await companionService.history());
  }

  return (
    <Box sx={{ maxWidth: 820, mx: "auto", height: "100%", display: "flex", flexDirection: "column" }}>
      <GlassCard sx={{ mb: 2 }}>
        <Stack direction="row" alignItems="center" spacing={2}>
          <Avatar sx={{ background: "linear-gradient(135deg,#6ee7ff,#a78bfa,#f472b6)", color: "#04121a" }}><AutoAwesomeRoundedIcon /></Avatar>
          <Box sx={{ flex: 1 }}>
            <Typography variant="h6">Your Companion</Typography>
            <Typography variant="caption" color="text.secondary">
              Runs locally · {settings.useWebLLM ? "on-device LLM (WebGPU)" : "heuristic engine"} · nothing leaves your device
            </Typography>
          </Box>
          <Select size="small" value={settings.companionPersona} onChange={(e) => setSettings({ companionPersona: e.target.value as CompanionPersona })}>
            {PERSONAS.map((p) => <MenuItem key={p} value={p}>{p}</MenuItem>)}
          </Select>
        </Stack>
      </GlassCard>

      <GlassCard sx={{ flex: 1, overflowY: "auto", mb: 2, display: "flex", flexDirection: "column", gap: 1.5 }}>
        {history.length === 0 && <Typography color="text.secondary">Ask me anything about your feed, trends, or who to follow. I summarize, explain, draft replies, and flag misinformation — all on-device.</Typography>}
        {history.map((m) => (
          <Stack key={m.id} direction="row" justifyContent={m.role === "user" ? "flex-end" : "flex-start"}>
            <Box sx={{ maxWidth: "78%", px: 1.5, py: 1, borderRadius: 2, background: m.role === "user" ? "linear-gradient(135deg,#6ee7ff,#a78bfa)" : "rgba(255,255,255,0.06)", color: m.role === "user" ? "#04121a" : "text.primary" }}>
              <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>{m.text}</Typography>
            </Box>
          </Stack>
        ))}
        {thinking && <Stack direction="row" alignItems="center" spacing={1}><CircularProgress size={14} /><Typography variant="caption" color="text.secondary">thinking locally…</Typography></Stack>}
        <div ref={endRef} />
      </GlassCard>

      <Stack direction="row" spacing={1} sx={{ mb: 1, flexWrap: "wrap", gap: 1 }}>
        {QUICK.map((q) => <Chip key={q} label={q} onClick={() => send(q)} sx={{ bgcolor: "rgba(167,139,250,0.12)" }} />)}
      </Stack>
      <Stack direction="row" spacing={1}>
        <TextField fullWidth size="small" value={input} placeholder="Message your companion…" onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") send(input); }} />
        <IconButton color="primary" onClick={() => send(input)}><SendRoundedIcon /></IconButton>
      </Stack>
    </Box>
  );
}
