import { Box, Divider, Typography } from "@mui/material";
import MessagesView from "./MessagesView";
import ChatroomView from "@/components/chatroom/ChatroomView";

// Combined page, stacked vertically:
//  • Chatrooms on TOP — kept compact; it's really just the room picker / "open a
//    room" control (a filtration mechanism), so it doesn't need to be tall.
//  • Swarm Lounge + DMs BELOW — the main chat window, taking the rest of the page.
// Both /messages and /chatroom render this, so existing deep-links keep working
// (a group opening /chatroom?room=… auto-joins up top; a DM alert → /messages
// lands on the Swarm Lounge / DMs window below).
export default function TownSquareView() {
  return (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
      {/* Chatrooms — compact picker/control at the top. Definite height + clip so
          an active room's chat scrolls inside here instead of spilling downward. */}
      <Box sx={{ flex: "0 0 auto", height: { xs: 230, md: 290 }, overflow: "hidden", display: "flex", flexDirection: "column", minHeight: 0 }}>
        <ChatroomView fullWidth />
      </Box>

      <Divider sx={{ my: 1.5 }}>
        <Typography variant="overline" color="text.secondary">Ledger Chat &amp; DMs</Typography>
      </Divider>

      {/* The chat window — Swarm Lounge + DMs — takes the rest of the page below */}
      <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <MessagesView fullWidth />
      </Box>
    </Box>
  );
}
