import { useEffect, useState, type ReactNode } from "react";
import { Box, Stack, Typography, Tooltip, IconButton, Chip, Avatar, Divider, CircularProgress, Badge, Popover, Button, Drawer, useMediaQuery, Menu, MenuItem, ListItemIcon } from "@mui/material";
import type { Theme } from "@mui/material";
import NotificationsRoundedIcon from "@mui/icons-material/NotificationsRounded";
import MenuRoundedIcon from "@mui/icons-material/MenuRounded";
import { useNavigate, useLocation } from "react-router-dom";
import { bus } from "@/lib/events";
import { companionService } from "@/services/companionService";
import { alertsService } from "@/services/alertsService";
import { relativeTime } from "@/lib/time";
import type { Alert } from "@/types";
import HomeRoundedIcon from "@mui/icons-material/HomeRounded";
import GroupsRoundedIcon from "@mui/icons-material/GroupsRounded";
import ChatRoundedIcon from "@mui/icons-material/ChatRounded";
import AutoAwesomeRoundedIcon from "@mui/icons-material/AutoAwesomeRounded";
import ForumRoundedIcon from "@mui/icons-material/ForumRounded";
import PublicRoundedIcon from "@mui/icons-material/PublicRounded";
import LiveTvRoundedIcon from "@mui/icons-material/LiveTvRounded";
import RssFeedRoundedIcon from "@mui/icons-material/RssFeedRounded";
import StorefrontRoundedIcon from "@mui/icons-material/StorefrontRounded";
import AccountBalanceWalletRoundedIcon from "@mui/icons-material/AccountBalanceWalletRounded";
import PersonRoundedIcon from "@mui/icons-material/PersonRounded";
import SettingsRoundedIcon from "@mui/icons-material/SettingsRounded";
import InfoRoundedIcon from "@mui/icons-material/InfoRounded";
import HubRoundedIcon from "@mui/icons-material/HubRounded";
import LocalCafeRoundedIcon from "@mui/icons-material/LocalCafeRounded";
import { useStore } from "@/store/useStore";
import UserAvatar from "@/components/common/UserAvatar";
import PresenceList from "@/components/layout/PresenceList";
import InstallButton from "@/components/layout/InstallButton";
import GlobalSearch from "@/components/layout/GlobalSearch";

const NAV = [
  { to: "/", label: "Feed", icon: <HomeRoundedIcon /> },
  { to: "/communities", label: "Groups", icon: <GroupsRoundedIcon /> },
  { to: "/messages", label: "Town Square", icon: <ChatRoundedIcon /> },
  { to: "/listen", label: "Watch and listen", icon: <LiveTvRoundedIcon /> },
  { to: "/network", label: "Network", icon: <HubRoundedIcon /> },
  { to: "/companion", label: "Companion", icon: <AutoAwesomeRoundedIcon /> },
  { to: "/topics", label: "Topics", icon: <RssFeedRoundedIcon /> },
  { to: "/market", label: "Market", icon: <StorefrontRoundedIcon /> },
  { to: "/wallet", label: "Wallet", icon: <AccountBalanceWalletRoundedIcon /> },
  { to: "/profile", label: "Profile", icon: <PersonRoundedIcon /> },
  { to: "/settings", label: "Settings", icon: <SettingsRoundedIcon /> },
  { to: "/about", label: "About", icon: <InfoRoundedIcon /> },
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
        <Box sx={{ width: { xs: 300, sm: 340 }, maxWidth: "92vw", maxHeight: 440, display: "flex", flexDirection: "column" }}>
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
          label={`AI ${pct}%`} sx={{ display: { xs: "none", sm: "inline-flex" }, bgcolor: "rgba(255,255,255,0.92)", color: "#1668e0", "& .MuiChip-label": { fontWeight: 700 } }} />
      </Tooltip>
    );
  }
  if (st.state === "ready" && !hideReady) {
    return <Tooltip title="On-device AI loaded — runs privately in your browser"><Chip size="small" label="AI ready" sx={{ display: { xs: "none", sm: "inline-flex" }, bgcolor: "rgba(84,201,90,0.92)", color: "#fff", "& .MuiChip-label": { fontWeight: 700 } }} /></Tooltip>;
  }
  return null;
}

// Mobile: the three floating chat docks (Global / Ledger / Companion) are now in a
// single dropdown menu to save screen space. We emit dock:toggle and mirror the
// open/active state that FloatingDocks broadcasts back (for the unread dots).
function ChatDropdown() {
  const [st, setSt] = useState({ globalActive: false, chatActive: false, globalOpen: false, chatOpen: false, companionOpen: false });
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  useEffect(() => bus.on("dock:state", setSt), []);
  
  const hasDot = (st.globalActive && !st.globalOpen) || (st.chatActive && !st.chatOpen);
  
  return (
    <>
      <Tooltip title="Chats">
        <IconButton size="small" onClick={(e) => setAnchor(e.currentTarget)} sx={{ color: "#fff" }}>
          <Badge color="error" variant="dot" invisible={!hasDot}>
            <ChatRoundedIcon fontSize="small" />
          </Badge>
        </IconButton>
      </Tooltip>
      <Menu open={!!anchor} anchorEl={anchor} onClose={() => setAnchor(null)} anchorOrigin={{ vertical: "bottom", horizontal: "right" }} transformOrigin={{ vertical: "top", horizontal: "right" }}>
        <MenuItem onClick={() => { bus.emit("dock:toggle", { which: "global" }); setAnchor(null); }}>
          <ListItemIcon><Badge color="error" variant="dot" invisible={!(st.globalActive && !st.globalOpen)}><PublicRoundedIcon fontSize="small" /></Badge></ListItemIcon>
          Global Chat
        </MenuItem>
        <MenuItem onClick={() => { bus.emit("dock:toggle", { which: "chat" }); setAnchor(null); }}>
          <ListItemIcon><Badge color="error" variant="dot" invisible={!(st.chatActive && !st.chatOpen)}><ForumRoundedIcon fontSize="small" /></Badge></ListItemIcon>
          Ledger Chat
        </MenuItem>
        <MenuItem onClick={() => { bus.emit("dock:toggle", { which: "companion" }); setAnchor(null); }}>
          <ListItemIcon><AutoAwesomeRoundedIcon fontSize="small" /></ListItemIcon>
          Ask AI
        </MenuItem>
      </Menu>
    </>
  );
}

export default function AppShell({ children }: { children: ReactNode }) {
  const nav = useNavigate();
  const { pathname } = useLocation();
  const me = useStore((s) => s.me);
  const onlineCount = useStore((s) => s.onlineCount);
  const status = useStore((s) => s.settings.presenceStatus);
  const compact = useMediaQuery((theme: Theme) => theme.breakpoints.down("md")); // ≤ md → rail collapses into a slide-out drawer; content goes full-width
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Close the drawer whenever the route changes (e.g. a nav tap).
  useEffect(() => { setDrawerOpen(false); }, [pathname]);

  // Logo click → go to the home feed AND scroll it to the very top.
  const goHome = () => {
    nav("/");
    document.getElementById("app-scroll")?.scrollTo({ top: 0 });
    setTimeout(() => bus.emit("feed:refresh", undefined), 0);
  };

  // Nav rail contents — shared by the desktop rail and the mobile drawer.
  // `expanded` shows full labels; `inDrawer` hides the online-presence list (it's
  // desktop-rail only — on mobile it just adds clutter).
  const renderNav = (expanded: boolean, inDrawer: boolean) => (
    <>
      <Stack direction="row" alignItems="center" spacing={1} onClick={goHome} role="button" aria-label="Go to home feed and scroll to top"
        sx={{ px: { xs: 0.5, sm: 1 }, py: 1.5, cursor: "pointer", borderRadius: 2, "&:hover": { opacity: 0.85 } }}>
        <Box component="img" src={`${import.meta.env.BASE_URL}logo.png`} alt="Ledger" sx={{ width: 30, height: 30, borderRadius: "8px", display: "block", boxShadow: "0 0 18px rgba(58,155,240,.35)", flexShrink: 0 }} />
        {expanded && <Typography variant="h6" sx={{ background: "linear-gradient(90deg,#3f97ff,#1668e0)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>Ledger</Typography>}
      </Stack>

      {NAV.map((item) => {
        const active = pathname === item.to || (item.to === "/messages" && pathname.startsWith("/chatroom"));
        return (
          <Tooltip key={item.to} title={expanded ? "" : item.label} placement="right">
            <Box
              onClick={() => nav(item.to)}
              sx={{
                display: "flex", alignItems: "center", gap: 1.5, px: { xs: 0.75, sm: 1.5 }, py: 1.1, borderRadius: 2, cursor: "pointer",
                color: active ? "#ffffff" : "text.secondary",
                background: active ? "linear-gradient(135deg,#3f97ff,#1668e0)" : "transparent",
                boxShadow: active ? "0 6px 18px rgba(58,155,240,.3)" : "none",
                "&:hover": { background: active ? undefined : "rgba(58,155,240,0.08)", color: active ? undefined : "text.primary" },
                justifyContent: expanded ? "flex-start" : "center",
                minHeight: "48px",
              }}
            >
              {item.icon}
              {expanded && <Typography sx={{ fontWeight: 700 }}>{item.label}</Typography>}
            </Box>
          </Tooltip>
        );
      })}

      <Box sx={{ flex: 1 }} />
      <InstallButton compact={!expanded} />
      <Tooltip title={expanded ? "" : "Support the project"} placement="right">
        <Box
          component="a" href={`${import.meta.env.BASE_URL}support.html`} target="_blank" rel="noopener noreferrer"
          sx={{
            display: "flex", alignItems: "center", gap: 1.5, px: { xs: 0.75, sm: 1.5 }, py: 1.1, borderRadius: 2, cursor: "pointer",
            textDecoration: "none", color: "#5a3a12",
            background: "linear-gradient(135deg,#ffe08a,#ffce5a)", border: "1px solid #f6b73c",
            boxShadow: "0 4px 12px rgba(246,183,60,.3)", mb: 0.5, minHeight: "48px",
            "&:hover": { background: "linear-gradient(135deg,#ffe9a8,#ffd877)" },
            justifyContent: expanded ? "flex-start" : "center",
          }}
        >
          <LocalCafeRoundedIcon fontSize={expanded ? "medium" : "small"} />
          {expanded && <Typography sx={{ fontWeight: 800 }}>Support the project</Typography>}
        </Box>
      </Tooltip>
      {expanded && !inDrawer && <Divider sx={{ my: 1 }} />}
      {expanded && !inDrawer && <PresenceList />}
    </>
  );

  return (
    <Box sx={{ position: "relative", zIndex: 1, height: "100vh", overflow: "hidden", p: { xs: 0, sm: 1, md: 2 } }}>
    <Box sx={{ display: "grid", gridTemplateColumns: compact ? "1fr" : "220px 1fr", height: { xs: "100vh", md: "calc(100vh - 32px)" }, bgcolor: "var(--bl-face)", border: "1px solid var(--bl-edge-frame)", borderRadius: { xs: 0, md: "8px" }, overflow: "hidden", boxShadow: "0 12px 44px rgba(0,0,0,0.4)" }}>
      {/* nav rail — full-height on desktop; on phones & tablets it collapses into a
          slide-out drawer (the hamburger in the title bar opens it) so the content
          column gets the full width. */}
      {!compact && (
        <Box sx={{ borderRight: "1px solid var(--bl-line)", p: 1, display: "flex", flexDirection: "column", gap: 0.25, height: "100%", overflowY: "auto", background: "linear-gradient(180deg, var(--bl-tasks-1), var(--bl-tasks-2))" }}>
          {renderNav(true, false)}
        </Box>
      )}
      {compact && (
        <Drawer anchor="left" open={drawerOpen} onClose={() => setDrawerOpen(false)}
          PaperProps={{ sx: { width: 260, maxWidth: "84vw", p: 1, display: "flex", flexDirection: "column", gap: 0.25, background: "linear-gradient(180deg, var(--bl-tasks-1), var(--bl-tasks-2))" } }}>
          {renderNav(true, true)}
        </Drawer>
      )}

      {/* main column — minWidth/minHeight:0 lets the scrollable child shrink-to-fit & scroll. */}
      <Box sx={{ display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0, overflow: "hidden", bgcolor: "var(--bl-face)" }}>
        {/* Luna title bar */}
        <Stack direction="row" alignItems="center" spacing={{ xs: 0.75, sm: 1.5 }} sx={{ px: { xs: 1, sm: 2 }, py: 1, position: "sticky", top: 0, zIndex: 5, color: "#fff", borderBottom: "1px solid var(--bl-title-edge)", background: "var(--bl-gloss-title), linear-gradient(180deg, var(--bl-title-hi), var(--bl-title-low))", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.5)" }}>
          {compact && <IconButton onClick={() => setDrawerOpen(true)} aria-label="Open menu" sx={{ color: "#fff", ml: -0.75 }}><MenuRoundedIcon /></IconButton>}
          <Typography variant="h6" sx={{ color: "#fff", textShadow: "0 1px 2px rgba(0,0,0,0.4)", display: { xs: "none", md: "block" }, whiteSpace: "nowrap", flex: { md: "0 0 auto" } }}>{NAV.find((n) => n.to === pathname)?.label ?? (pathname.startsWith("/chatroom") ? "Town Square" : "Ledger")}</Typography>
          <Box sx={{ flex: 1, display: "flex", justifyContent: compact ? "flex-end" : "flex-start" }}><GlobalSearch compact={compact} /></Box>
          <ModelStatusChip />
          {compact && <ChatDropdown />}
          <AlertsBell />
          <Chip size="small" label={`${onlineCount} online`} sx={{ display: { xs: "none", sm: "inline-flex" }, bgcolor: "rgba(255,255,255,0.92)", color: "var(--bl-green-600)", border: "none", "& .MuiChip-label": { fontWeight: 700 } }} icon={<Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: "#4ca325", ml: 1 }} />} />
          <Tooltip title={me?.username ?? ""}>
            <Box sx={{ position: "relative", cursor: "pointer", flexShrink: 0 }} onClick={() => nav("/profile")}>
              <UserAvatar pk={me?.publicKey ?? ""} name={me?.username ?? "?"} avatar={me?.avatar} size={32} />
              <Box sx={{ position: "absolute", right: -1, bottom: -1, width: 11, height: 11, borderRadius: "50%", bgcolor: STATUS_COLOR[status], border: "2px solid #fff" }} />
            </Box>
          </Tooltip>
        </Stack>

        <Box id="app-scroll" sx={{ flex: 1, minHeight: 0, overflowY: "auto", py: { xs: 1.25, sm: 1.5, md: 3 }, px: { xs: 1.25, sm: 1.5, md: 2, xl: 3 }, pb: 12, "&::-webkit-scrollbar": { display: "none" }, scrollbarWidth: "none", msOverflowStyle: "none" }}>{children}</Box>
      </Box>
    </Box>
    </Box>
  );
}
