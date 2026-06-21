import { useEffect, useState } from "react";
import { Box, Grid, Typography, Stack, Chip, Button, TextField, Dialog, DialogTitle, DialogContent, DialogActions } from "@mui/material";
import TagRoundedIcon from "@mui/icons-material/TagRounded";
import VolumeUpRoundedIcon from "@mui/icons-material/VolumeUpRounded";
import EventRoundedIcon from "@mui/icons-material/EventRounded";
import GlassCard from "@/components/common/GlassCard";
import { communityService } from "@/services/communityService";
import { useStore } from "@/store/useStore";
import { toast } from "@/lib/events";
import type { Community } from "@/types";

const CHAN_ICON: Record<string, JSX.Element> = {
  text: <TagRoundedIcon fontSize="small" />, voice: <VolumeUpRoundedIcon fontSize="small" />, stage: <VolumeUpRoundedIcon fontSize="small" />, events: <EventRoundedIcon fontSize="small" />,
};

export default function CommunitiesView() {
  const me = useStore((s) => s.me);
  const [communities, setCommunities] = useState<Community[]>([]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");

  const load = () => communityService.list().then(setCommunities);
  useEffect(() => { load(); }, []);

  async function create() {
    if (!name.trim()) return;
    await communityService.create({ name: name.trim(), description: desc.trim() || "A new corner of Nebula" });
    setOpen(false); setName(""); setDesc(""); load();
    toast("Community created", "success");
  }
  async function join(id: string) { await communityService.join(id); load(); toast("Joined", "success"); }

  return (
    <Box sx={{ maxWidth: 1100, mx: "auto" }}>
      <Stack direction="row" alignItems="center" sx={{ mb: 2 }}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="h5">Communities</Typography>
          <Typography variant="body2" color="text.secondary">Subreddits, Discord-style servers & interest groups — channels for text, voice, stages and events.</Typography>
        </Box>
        <Button variant="contained" onClick={() => setOpen(true)}>+ New community</Button>
      </Stack>

      <Grid container spacing={2}>
        {communities.map((c) => {
          const member = c.members.includes(me?.publicKey ?? "");
          return (
            <Grid item xs={12} sm={6} md={4} key={c.id}>
              <GlassCard sx={{ height: "100%" }}>
                <Stack direction="row" spacing={1.5} alignItems="center">
                  <Box sx={{ fontSize: 30 }}>{c.icon}</Box>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography sx={{ fontWeight: 700 }} noWrap>{c.name}</Typography>
                    <Typography variant="caption" color="text.secondary">{c.members.length} member{c.members.length === 1 ? "" : "s"} · {c.visibility}</Typography>
                  </Box>
                </Stack>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1, minHeight: 40 }}>{c.description}</Typography>
                <Stack direction="row" spacing={0.5} sx={{ mt: 1, flexWrap: "wrap", gap: 0.5 }}>
                  {c.channels.map((ch) => <Chip key={ch.id} size="small" icon={CHAN_ICON[ch.kind]} label={ch.name} variant="outlined" />)}
                </Stack>
                <Button fullWidth size="small" variant={member ? "outlined" : "contained"} sx={{ mt: 1.5 }} disabled={member} onClick={() => join(c.id)}>
                  {member ? "Joined" : "Join"}
                </Button>
              </GlassCard>
            </Grid>
          );
        })}
      </Grid>

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="xs" PaperProps={{ sx: { backgroundImage: "none" } }}>
        <DialogTitle>New community</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 0.5 }}>
            <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} fullWidth autoFocus />
            <TextField label="Description" value={desc} onChange={(e) => setDesc(e.target.value)} fullWidth multiline minRows={2} />
          </Stack>
        </DialogContent>
        <DialogActions><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="contained" onClick={create}>Create</Button></DialogActions>
      </Dialog>
    </Box>
  );
}
