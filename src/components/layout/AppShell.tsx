import { useEffect, useState, type ReactNode } from "react";
import { Box, Stack, Typography, Tooltip, IconButton, Chip, Avatar, Divider, CircularProgress, Badge, Popover, Button, useMediaQuery } from "@mui/material";
import NotificationsRoundedIcon from "@mui/icons-material/NotificationsRounded";
import { useNavigate, useLocation } from "react-router-dom";
import { bus } from "@/lib/events";
import { companionService } from "@/services/companionService";
import { alertsService } from "@/services/alertsService";
import { relativeTime } from "@/lib/time";
import type { Alert } from "@/types";
import HomeRoundedIcon from "@mui/icons-material/HomeRounded";
import GroupsRoundedIcon from "@mui/icons-material/GroupsRounded";
import ChatRoundedIcon from "@mui/icons-material/ChatRounded";
import ForumRoundedIcon from "@mui/icons-material/ForumRounded";
import HeadphonesRoundedIcon from "@mui/icons-material/HeadphonesRounded";
import AutoAwesomeRoundedIcon from "@mui/icons-material/AutoAwesomeRounded";
import RssFeedRoundedIcon from "@mui/icons-material/RssFeedRounded";
import StorefrontRoundedIcon from "@mui/icons-material/StorefrontRounded";
import AccountBalanceWalletRoundedIcon from "@mui/icons-material/AccountBalanceWalletRounded";
import PersonRoundedIcon from "@mui/icons-material/PersonRounded";
import SettingsRoundedIcon from "@mui/icons-material/SettingsRounded";
import LocalCafeRoundedIcon from "@mui/icons-material/LocalCafeRounded";
import { useStore } from "@/store/useStore";
import UserAvatar from "@/components/common/UserAvatar";
import PresenceList from "@/components/layout/PresenceList";

const NAV = [
  { to: "/", label: "Feed", icon: <HomeRoundedIcon /> },
  { to: "/communities", label: "Groups", icon: <GroupsRoundedIcon /> },
  { to: "/messages", label: "Town Square", icon: <ChatRoundedIcon /> },
  { to: "/chatroom", label: "Chatroom", icon: <ForumRoundedIcon /> },
  { to: "/listen", label: "Watch & Listen", icon: <HeadphonesRoundedIcon /> },
  { to: "/companion", label: "Companion", icon: <AutoAwesomeRoundedIcon /> },
  { to: "/topics", label: "Topics", icon: <RssFeedRoundedIcon /> },
  { to: "/market", label: "Market", icon: <StorefrontRoundedIcon /> },
  { to: "/wallet", label: "Wallet", icon: <AccountBalanceWalletRoundedIcon /> },
  { to: "/profile", label: "Profile", icon: <PersonRoundedIcon /> },
  { to: "/settings", label: "Settings", icon: <SettingsRoundedIcon /> },
];

const STATUS_COLOR: Record<string, string> = { online: "#54c95a", idle: "#ffcc66", away: "#ff9a5d", dnd: "#ff5d7a", offline: "#7a85a8" };

const ALERT_ICON: Record<Alert["kind"], string> = { reply: "💬", reaction: "✨", dm: "✉️", watch: "📺", info: "🔔" };

// Notification center — clicking an alert takes you straight to what it's about.
function AlertsBell() {
  const nav = useNavigate();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>(alertsService.list());
  const [unread, setUnread] = useState(alertsService.unread());
  useEffect(() => bus.on("alerts:updated", () => { setAlerts([...alertsService.list()]); setUnread(alertsService.unread()); }), []);

  function open(e: React.MouseEvent<HTMLElement>) { setAnchor(e.currentTarget); alertsService.markAllRead(); }
  function go(a: Alert) {
    setAnchor(null);
    alertsService.markRead(a.id);
    nav(a.route);
    if (a.postId) { const id = a.postId; setTimeout(() => bus.emit("focus:post", { postId: id }), 250); }
  }

  return (
    <>
      <Tooltip title="Alerts">
        <IconButton onClick={open} sx={{ color: "#fff" }}>
          <Badge badgeContent={unread} color="error" max={9}><NotificationsRoundedIcon /></Badge>
        </IconButton>
      </Tooltip>
      <Popover open={!!anchor} anchorEl={anchor} onClose={() => setAnchor(null)} anchorOrigin={{ vertical: "bottom", horizontal: "right" }} transformOrigin={{ vertical: "top", horizontal: "right" }}>
        <Box sx={{ width: 340, maxHeight: 440, display: "flex", flexDirection: "column" }}>
          <Stack direction="row" alignItems="center" sx={{ px: 1.5, py: 1, borderBottom: "1px solid var(--bl-line)" }}>
            <Typography sx={{ fontWeight: 800, flex: 1 }}>Alerts</Typography>
            {alerts.length > 0 && <Button size="small" onClick={() => { alertsService.clear(); }}>Clear</Button>}
          </Stack>
          <Box sx={{ overflowY: "auto" }}>
            {alerts.length === 0 && <Typography color="text.secondary" sx={{ p: 2, textAlign: "center" }}>No alerts yet — replies, reactions and messages will show up here.</Typography>}
            {alerts.map((a) => (
              <Stack key={a.id} direction="row" spacing={1} alignItems="center" onClick={() => go(a)}
                sx={{ px: 1.5, py: 1, cursor: "pointer", borderBottom: "1px solid var(--bl-line)", bgcolor: a.read ? "transparent" : "rgba(58,155,240,0.08)", "&:hover": { bgcolor: "rgba(58,155,240,0.14)" } }}>
                <Box sx={{ fontSize: 18 }}>{ALERT_ICON[a.kind]}</Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" sx={{ fontWeight: a.read ? 400 : 700 }}>{a.text}</Typography>
                  <Typography variant="caption" color="text.secondary">{relativeTime(a.at)} · tap to open</Typography>
                </Box>
              </Stack>
            ))}
          </Box>
        </Box>
      </Popover>
    </>
  );
}

// Live indicator for the on-device LLM as it auto-downloads on first load.
// Shows a progress ring while loading, a brief "AI ready" once in memory, then
// fades out so it doesn't clutter the bar.
function ModelStatusChip() {
  const [st, setSt] = useState<{ state?: string; progress?: number }>(companionService.modelReady() ? { state: "ready" } : {});
  const [hideReady, setHideReady] = useState(false);
  useEffect(() => bus.on("companion:model", (m) => { setSt(m); if (m.state === "ready") { setHideReady(false); setTimeout(() => setHideReady(true), 6000); } }), []);
  if (st.state === "loading") {
    const pct = Math.round((st.progress ?? 0) * 100);
    return (
      <Tooltip title="Your private on-device AI is downloading — it's cached after the first time">
        <Chip size="small" icon={<CircularProgress size={12} sx={{ color: "#1668e0 !important", ml: 0.5 }} variant={st.progress ? "determinate" : "indeterminate"} value={pct} />}
          label={`AI ${pct}%`} sx={{ bgcolor: "rgba(255,255,255,0.92)", color: "#1668e0", "& .MuiChip-label": { fontWeight: 700 } }} />
      </Tooltip>
    );
  }
  if (st.state === "ready" && !hideReady) {
    return <Tooltip title="On-device AI loaded — runs privately in your browser"><Chip size="small" label="AI ready" sx={{ bgcolor: "rgba(84,201,90,0.92)", color: "#fff", "& .MuiChip-label": { fontWeight: 700 } }} /></Tooltip>;
  }
  return null;
}

export default function AppShell({ children }: { children: ReactNode }) {
  const nav = useNavigate();
  const { pathname } = useLocation();
  const me = useStore((s) => s.me);
  const onlineCount = useStore((s) => s.onlineCount);
  const status = useStore((s) => s.settings.presenceStatus);
  const compact = useMediaQuery("(max-width:900px)");

  return (
    <Box sx={{ position: "relative", zIndex: 1, height: "100vh", overflow: "hidden", p: { xs: 0, md: 2 } }}>
    <Box sx={{ display: "grid", gridTemplateColumns: compact ? "64px 1fr" : "230px 1fr", height: { xs: "100vh", md: "calc(100vh - 32px)" }, bgcolor: "var(--bl-face)", border: "1px solid var(--bl-edge-frame)", borderRadius: { xs: 0, md: "8px" }, overflow: "hidden", boxShadow: "0 12px 44px rgba(0,0,0,0.4)" }}>
      {/* nav rail — full height, stays put while the content column scrolls */}
      <Box sx={{ borderRight: "1px solid var(--bl-line)", p: 1, display: "flex", flexDirection: "column", gap: 0.25, height: "100%", overflowY: "auto", background: "linear-gradient(180deg, var(--bl-tasks-1), var(--bl-tasks-2))" }}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 1, py: 1.5 }}>
          <Box sx={{ width: 28, height: 28, borderRadius: "8px", background: "linear-gradient(135deg,#3f97ff,#1668e0,#0a55cf)", boxShadow: "0 0 18px rgba(58,155,240,.5)" }} />
          {!compact && <Typography variant="h6" sx={{ background: "linear-gradient(90deg,#3f97ff,#1668e0)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>ZuccBook</Typography>}
        </Stack>

        {NAV.map((item) => {
          const active = pathname === item.to;
          return (
            <Tooltip key={item.to} title={compact ? item.label : ""} placement="right">
              <Box
                onClick={() => nav(item.to)}
                sx={{
                  display: "flex", alignItems: "center", gap: 1.5, px: 1.5, py: 1.1, borderRadius: 2, cursor: "pointer",
                  color: active ? "#ffffff" : "text.secondary",
                  background: active ? "linear-gradient(135deg,#3f97ff,#1668e0)" : "transparent",
                  boxShadow: active ? "0 6px 18px rgba(58,155,240,.3)" : "none",
                  "&:hover": { background: active ? undefined : "rgba(58,155,240,0.08)", color: active ? undefined : "text.primary" },
                  justifyContent: compact ? "center" : "flex-start",
                }}
              >
                {item.icon}
                {!compact && <Typography sx={{ fontWeight: 700 }}>{item.label}</Typography>}
              </Box>
            </Tooltip>
          );
        })}

        <Box sx={{ flex: 1 }} />

        {/* Support — ZuccBook stays free, open-source & uncensored; the only
            funding is voluntary support for the developer. */}
        <Tooltip title={compact ? "Support the project" : ""} placement="right">
          <Box
            component="a" href="https://buymeacoffee.com/amosroger91" target="_blank" rel="noopener noreferrer"
            sx={{
              display: "flex", alignItems: "center", gap: 1.5, px: 1.5, py: 1.1, borderRadius: 2, cursor: "pointer",
              textDecoration: "none", color: "#5a3a12",
              background: "linear-gradient(135deg,#ffe08a,#ffce5a)", border: "1px solid #f6b73c",
              boxShadow: "0 4px 12px rgba(246,183,60,.3)", mb: 0.5,
              "&:hover": { background: "linear-gradient(135deg,#ffe9a8,#ffd877)" },
              justifyContent: compact ? "center" : "flex-start",
            }}
          >
            <LocalCafeRoundedIcon />
            {!compact && <Typography sx={{ fontWeight: 800 }}>Support the project</Typography>}
          </Box>
        </Tooltip>

        {!compact && <Divider sx={{ my: 1 }} />}
        {!compact && <PresenceList />}
      </Box>

      {/* main column — minHeight:0 lets the scrollable content child actually
          shrink-to-fit and scroll instead of overflowing the clipped grid. */}
      <Box sx={{ display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0, overflow: "hidden", bgcolor: "var(--bl-face)" }}>
        {/* Luna title bar */}
        <Stack direction="row" alignItems="center" spacing={1.5} sx={{ px: 2, py: 1, position: "sticky", top: 0, zIndex: 5, color: "#fff", borderBottom: "1px solid var(--bl-title-edge)", background: "var(--bl-gloss-title), linear-gradient(180deg, var(--bl-title-hi), var(--bl-title-low))", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.5)" }}>
          <Typography variant="h6" sx={{ flex: 1, color: "#fff", textShadow: "0 1px 2px rgba(0,0,0,0.4)" }}>{NAV.find((n) => n.to === pathname)?.label ?? "ZuccBook"}</Typography>
          <ModelStatusChip />
          <AlertsBell />
          <Chip size="small" label={`${onlineCount} online`} sx={{ bgcolor: "rgba(255,255,255,0.92)", color: "var(--bl-green-600)", border: "none", "& .MuiChip-label": { fontWeight: 700 } }} icon={<Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: "#4ca325", ml: 1 }} />} />
          <Tooltip title={me?.username ?? ""}>
            <Box sx={{ position: "relative", cursor: "pointer" }} onClick={() => nav("/profile")}>
              <UserAvatar pk={me?.publicKey ?? ""} name={me?.username ?? "?"} avatar={me?.avatar} size={32} />
              <Box sx={{ position: "absolute", right: -1, bottom: -1, width: 11, height: 11, borderRadius: "50%", bgcolor: STATUS_COLOR[status], border: "2px solid #fff" }} />
            </Box>
          </Tooltip>
        </Stack>

        <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", p: { xs: 1.5, md: 3 }, pb: 12 }}>{children}</Box>
      </Box>
    </Box>
    </Box>
  );
}
