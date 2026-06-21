import { useEffect, useState } from "react";
import { Box, Slide, Stack, Avatar, Typography, IconButton, Button, Tooltip } from "@mui/material";
import AutoAwesomeRoundedIcon from "@mui/icons-material/AutoAwesomeRounded";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import { useNavigate } from "react-router-dom";
import GlassCard from "@/components/common/GlassCard";
import { companionService } from "@/services/companionService";
import { useStore } from "@/store/useStore";
import { bus } from "@/lib/events";

/** A small chat window that slides in from the right when the on-device AI has
 *  loaded, introducing itself. Shown once per session; dismissible. */
export default function CompanionIntro() {
  const nav = useNavigate();
  const me = useStore((s) => s.me);
  const [open, setOpen] = useState(false);
  const [typing, setTyping] = useState(true);

  useEffect(() => {
    if (sessionStorage.getItem("companionIntroSeen")) return;
    let shown = false;
    const show = () => {
      if (shown) return; shown = true;
      sessionStorage.setItem("companionIntroSeen", "1");
      setOpen(true); setTyping(true);
      setTimeout(() => setTyping(false), 1500);
    };
    // Greet as soon as the model is ready; otherwise fall back to a short delay
    // so the companion still introduces itself (the fast local engine works even
    // while the model downloads or if WebGPU is unavailable).
    if (companionService.modelReady()) setTimeout(show, 800);
    const off = bus.on("companion:model", (m) => { if (m.state === "ready") show(); });
    const t = window.setTimeout(show, 5000);
    return () => { off(); clearTimeout(t); };
  }, []);

  if (!open) return null;
  const name = me?.username ? me.username.split(/\s+/)[0] : "there";
  const ready = companionService.modelReady();
  const intro = `Hey ${name}! 👋 I'm your Companion — ${ready ? "a real AI model now running fully on your device" : "a local assistant running right here in your browser"}, completely private. Nothing you tell me ever leaves this device. I can summarize your feed, explain what's trending, suggest communities, or just chat. 🙂`;

  return (
    <Slide direction="left" in={open} mountOnEnter unmountOnExit>
      <Box sx={{ position: "fixed", right: 16, bottom: 96, zIndex: 1300, width: { xs: "calc(100vw - 32px)", sm: 330 } }}>
        <GlassCard sx={{ p: 0, overflow: "hidden", boxShadow: "0 16px 44px rgba(0,0,0,0.45)" }}>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 1.5, py: 1, color: "#fff", background: "linear-gradient(135deg,#3f97ff,#1668e0,#0a55cf)" }}>
            <Avatar sx={{ width: 30, height: 30, bgcolor: "rgba(255,255,255,0.22)" }}><AutoAwesomeRoundedIcon fontSize="small" /></Avatar>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography sx={{ fontWeight: 800, fontSize: 14, lineHeight: 1.1 }}>Your Companion</Typography>
              <Stack direction="row" alignItems="center" spacing={0.5}>
                <Box sx={{ width: 7, height: 7, borderRadius: "50%", bgcolor: "#54ff7a" }} />
                <Typography variant="caption" sx={{ opacity: 0.9 }}>{ready ? "on-device · ready" : "local engine"}</Typography>
              </Stack>
            </Box>
            <Tooltip title="Dismiss"><IconButton size="small" sx={{ color: "#fff" }} onClick={() => setOpen(false)}><CloseRoundedIcon fontSize="small" /></IconButton></Tooltip>
          </Stack>

          <Box sx={{ p: 1.5 }}>
            <Box sx={{ p: 1.25, borderRadius: 2, bgcolor: "rgba(58,123,240,0.08)", border: "1px solid rgba(58,155,240,0.18)", minHeight: 40 }}>
              {typing
                ? <Stack direction="row" spacing={0.5} sx={{ py: 0.5, "& span": { width: 7, height: 7, borderRadius: "50%", bgcolor: "#3f97ff", animation: "blip 1s infinite" }, "& span:nth-of-type(2)": { animationDelay: ".15s" }, "& span:nth-of-type(3)": { animationDelay: ".3s" }, "@keyframes blip": { "0%,80%,100%": { opacity: 0.25 }, "40%": { opacity: 1 } } }}>
                    <span /><span /><span />
                  </Stack>
                : <Typography variant="body2">{intro}</Typography>}
            </Box>
            <Button fullWidth variant="contained" sx={{ mt: 1.5 }} onClick={() => { setOpen(false); nav("/companion"); }}>
              Start chatting →
            </Button>
          </Box>
        </GlassCard>
      </Box>
    </Slide>
  );
}
