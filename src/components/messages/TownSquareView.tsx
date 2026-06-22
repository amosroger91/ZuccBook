import { Box, Typography } from "@mui/material";
import GlassCard from "@/components/common/GlassCard";
import MessagesView from "./MessagesView";
import ChatroomView from "@/components/chatroom/ChatroomView";

// Combined page: the live peer-to-peer rooms (ChatroomView) on top, with the
// durable Swarm Lounge + DMs (MessagesView) stacked shorter beneath it — both
// visible at once. Both /messages and /chatroom render this, so existing
// deep-links keep working (groups opening /chatroom?room=… auto-join up top,
// a DM alert routing to /messages lands on the Town Square section below).
export default function TownSquareView() {
  return (
    <Box sx={{ height: "100%", width: "100%", display: "grid", gridTemplateColumns: { xs: "1fr", md: "1.3fr 0.9fr" }, gridTemplateRows: { xs: "auto 1fr", md: "1fr" }, gap: 2, minHeight: 0, px: { xs: 1, md: 0 } }}>
      <Box sx={{ gridColumn: "1", gridRow: "1", display: "flex", flexDirection: "column", minHeight: 0 }}>
        <Typography variant="overline" color="text.secondary" sx={{ mb: 1 }}>Town Square</Typography>
        <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <ChatroomView fullWidth />
        </Box>
      </Box>

      <Box sx={{ gridColumn: { xs: "1", md: "2" }, gridRow: { xs: "2", md: "1" }, display: "flex", flexDirection: "column", minHeight: 0, height: "100%" }}>
        <GlassCard sx={{ mb: 2, p: 2, background: "rgba(58,155,240,0.08)", borderColor: "rgba(58,155,240,0.24)", display: { xs: "none", md: "flex" }, flexDirection: "column", gap: 1 }}>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>Swarm Lounge + direct messages live here. On desktop you can see rooms and conversations side by side. On mobile, the message list stacks below the active room.</Typography>
        </GlassCard>
        <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <MessagesView fullWidth />
        </Box>
      </Box>
    </Box>
  );
}
