import type { ReactNode } from "react";
import { Box, Stack, Typography, Tooltip, IconButton, Chip, Avatar, Divider, useMediaQuery } from "@mui/material";
import { useNavigate, useLocation } from "react-router-dom";
import HomeRoundedIcon from "@mui/icons-material/HomeRounded";
import GroupsRoundedIcon from "@mui/icons-material/GroupsRounded";
import ChatRoundedIcon from "@mui/icons-material/ChatRounded";
import HeadphonesRoundedIcon from "@mui/icons-material/HeadphonesRounded";
import AutoAwesomeRoundedIcon from "@mui/icons-material/AutoAwesomeRounded";
import PersonRoundedIcon from "@mui/icons-material/PersonRounded";
import SettingsRoundedIcon from "@mui/icons-material/SettingsRounded";
import { useStore } from "@/store/useStore";
import { avatarGradient, initials } from "@/components/common/avatar";
import PresenceList from "@/components/layout/PresenceList";

const NAV = [
  { to: "/", label: "Feed", icon: <HomeRoundedIcon /> },
  { to: "/communities", label: "Communities", icon: <GroupsRoundedIcon /> },
  { to: "/messages", label: "Messages", icon: <ChatRoundedIcon /> },
  { to: "/listen", label: "Listen", icon: <HeadphonesRoundedIcon /> },
  { to: "/companion", label: "Companion", icon: <AutoAwesomeRoundedIcon /> },
  { to: "/profile", label: "Profile", icon: <PersonRoundedIcon /> },
  { to: "/settings", label: "Settings", icon: <SettingsRoundedIcon /> },
];

const STATUS_COLOR: Record<string, string> = { online: "#5dffa0", idle: "#ffcc66", away: "#ff9a5d", dnd: "#ff5d7a", offline: "#7a85a8" };

export default function AppShell({ children }: { children: ReactNode }) {
  const nav = useNavigate();
  const { pathname } = useLocation();
  const me = useStore((s) => s.me);
  const onlineCount = useStore((s) => s.onlineCount);
  const status = useStore((s) => s.settings.presenceStatus);
  const compact = useMediaQuery("(max-width:900px)");

  return (
    <Box sx={{ position: "relative", zIndex: 1, display: "grid", gridTemplateColumns: compact ? "72px 1fr" : "240px 1fr", minHeight: "100vh" }}>
      {/* nav rail */}
      <Box sx={{ borderRight: "1px solid rgba(110,231,255,0.12)", p: 1.5, display: "flex", flexDirection: "column", gap: 0.5, position: "sticky", top: 0, height: "100vh", backdropFilter: "blur(12px)" }}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 1, py: 1.5 }}>
          <Box sx={{ width: 28, height: 28, borderRadius: "8px", background: "linear-gradient(135deg,#6ee7ff,#a78bfa,#f472b6)", boxShadow: "0 0 18px rgba(110,231,255,.5)" }} />
          {!compact && <Typography variant="h6" sx={{ background: "linear-gradient(90deg,#6ee7ff,#a78bfa)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>NEBULA</Typography>}
        </Stack>

        {NAV.map((item) => {
          const active = pathname === item.to;
          return (
            <Tooltip key={item.to} title={compact ? item.label : ""} placement="right">
              <Box
                onClick={() => nav(item.to)}
                sx={{
                  display: "flex", alignItems: "center", gap: 1.5, px: 1.5, py: 1.1, borderRadius: 2, cursor: "pointer",
                  color: active ? "#04121a" : "text.secondary",
                  background: active ? "linear-gradient(135deg,#6ee7ff,#a78bfa)" : "transparent",
                  boxShadow: active ? "0 6px 18px rgba(110,231,255,.3)" : "none",
                  "&:hover": { background: active ? undefined : "rgba(110,231,255,0.08)", color: active ? undefined : "text.primary" },
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
        {!compact && <Divider sx={{ my: 1 }} />}
        {!compact && <PresenceList />}
      </Box>

      {/* main column */}
      <Box sx={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
        {/* top bar */}
        <Stack direction="row" alignItems="center" spacing={1.5} sx={{ px: 2.5, py: 1.5, borderBottom: "1px solid rgba(110,231,255,0.12)", position: "sticky", top: 0, zIndex: 5, backdropFilter: "blur(14px)", background: "rgba(5,6,15,0.5)" }}>
          <Typography variant="h6" sx={{ flex: 1, opacity: 0.9 }}>{NAV.find((n) => n.to === pathname)?.label ?? "Nebula"}</Typography>
          <Chip size="small" label={`${onlineCount} online`} sx={{ bgcolor: "rgba(93,255,160,0.12)", color: "#5dffa0", "& .MuiChip-label": { fontWeight: 700 } }} icon={<Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: "#5dffa0", boxShadow: "0 0 8px #5dffa0", ml: 1 }} />} />
          <Tooltip title={me?.username ?? ""}>
            <Box sx={{ position: "relative" }}>
              <Avatar sx={{ width: 34, height: 34, background: avatarGradient(me?.publicKey ?? ""), fontWeight: 800, fontSize: 14, color: "#04121a", cursor: "pointer" }} onClick={() => nav("/profile")}>
                {initials(me?.username ?? "?")}
              </Avatar>
              <Box sx={{ position: "absolute", right: -1, bottom: -1, width: 11, height: 11, borderRadius: "50%", bgcolor: STATUS_COLOR[status], border: "2px solid #05060f" }} />
            </Box>
          </Tooltip>
        </Stack>

        <Box sx={{ flex: 1, overflowY: "auto", p: { xs: 1.5, md: 3 } }}>{children}</Box>
      </Box>
    </Box>
  );
}
