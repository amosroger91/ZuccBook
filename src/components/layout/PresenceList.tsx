import { Box, Stack, Typography, Tooltip } from "@mui/material";
import { useStore } from "@/store/useStore";
import UserAvatar from "@/components/common/UserAvatar";

const STATUS_COLOR: Record<string, string> = { online: "#54c95a", idle: "#ffcc66", away: "#ff9a5d", dnd: "#ff5d7a", offline: "#7a85a8" };

export default function PresenceList() {
  const presence = useStore((s) => s.presence);

  return (
    <Box sx={{ px: 0.5, pb: 1 }}>
      <Typography variant="caption" color="text.secondary" sx={{ px: 1, letterSpacing: "0.12em", textTransform: "uppercase" }}>
        On the network
      </Typography>
      <Stack spacing={0.5} sx={{ mt: 1 }}>
        {presence.length === 0 && (
          <Typography variant="caption" color="text.secondary" sx={{ px: 1 }}>
            Searching the swarm…
          </Typography>
        )}
        {presence.slice(0, 12).map((p) => (
          <Tooltip key={p.pk} title={p.activity ? `${p.activity.kind}: ${p.activity.detail}` : p.status} placement="right">
            <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 1, py: 0.5, borderRadius: 1.5, "&:hover": { bgcolor: "rgba(58,155,240,0.06)" } }}>
              <Box sx={{ position: "relative" }}>
                <UserAvatar pk={p.pk} name={p.username} avatar={p.avatar} size={26} />
                <Box sx={{ position: "absolute", right: -1, bottom: -1, width: 9, height: 9, borderRadius: "50%", bgcolor: STATUS_COLOR[p.status] ?? "#7a85a8", border: "2px solid #05060f" }} />
              </Box>
              <Box sx={{ minWidth: 0 }}>
                <Typography noWrap sx={{ fontSize: 13, fontWeight: 600 }}>{p.username}</Typography>
                {p.activity && <Typography noWrap variant="caption" color="text.secondary">{p.activity.detail}</Typography>}
              </Box>
            </Stack>
          </Tooltip>
        ))}
      </Stack>
    </Box>
  );
}
