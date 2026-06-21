import { useEffect, useMemo, useState } from "react";
import { Box, Grid, Typography, Stack, Chip, Button, TextField, Dialog, DialogTitle, DialogContent, DialogActions, Select, MenuItem, IconButton, Tooltip, InputAdornment } from "@mui/material";
import TagRoundedIcon from "@mui/icons-material/TagRounded";
import VolumeUpRoundedIcon from "@mui/icons-material/VolumeUpRounded";
import EventRoundedIcon from "@mui/icons-material/EventRounded";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import EditRoundedIcon from "@mui/icons-material/EditRounded";
import DeleteRoundedIcon from "@mui/icons-material/DeleteRounded";
import GlassCard from "@/components/common/GlassCard";
import { communityService } from "@/services/communityService";
import { useStore } from "@/store/useStore";
import { toast } from "@/lib/events";
import type { Community, CommunityPhilosophy } from "@/types";

const PHILOSOPHIES: CommunityPhilosophy[] = ["open", "casual", "professional", "faith", "custom"];
const FILTERS = [{ id: "all", label: "All" }, { id: "joined", label: "Joined" }, { id: "mine", label: "Created by me" }] as const;
type Filter = (typeof FILTERS)[number]["id"];

const CHAN_ICON: Record<string, JSX.Element> = {
  text: <TagRoundedIcon fontSize="small" />, voice: <VolumeUpRoundedIcon fontSize="small" />, stage: <VolumeUpRoundedIcon fontSize="small" />, events: <EventRoundedIcon fontSize="small" />,
};

export default function CommunitiesView() {
  const me = useStore((s) => s.me);
  const mePk = me?.publicKey ?? "";
  const [communities, setCommunities] = useState<Community[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  // create/edit dialog (editId null = create)
  const [dlg, setDlg] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [icon, setIcon] = useState("🌐");
  const [visibility, setVisibility] = useState<Community["visibility"]>("public");

  const load = () => communityService.list().then(setCommunities);
  useEffect(() => { load(); }, []);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return communities.filter((c) => {
      if (filter === "joined" && !c.members.includes(mePk)) return false;
      if (filter === "mine" && c.owner !== mePk) return false;
      return !q || `${c.name} ${c.description}`.toLowerCase().includes(q);
    });
  }, [communities, query, filter, mePk]);

  function openCreate() { setEditId(null); setName(""); setDesc(""); setIcon("🌐"); setVisibility("public"); setDlg(true); }
  function openEdit(c: Community) { setEditId(c.id); setName(c.name); setDesc(c.description); setIcon(c.icon || "🌐"); setVisibility(c.visibility); setDlg(true); }

  async function save() {
    if (!name.trim()) return;
    if (editId) {
      await communityService.update(editId, { name: name.trim(), description: desc.trim() || "A group on ZuccBook", icon, visibility });
      toast("Group updated", "success");
    } else {
      await communityService.create({ name: name.trim(), description: desc.trim() || "A new group on ZuccBook", icon, visibility });
      toast("Group created", "success");
    }
    setDlg(false); load();
  }
  async function join(id: string) { await communityService.join(id); load(); toast("Joined", "success"); }
  async function leave(id: string) { await communityService.leave(id); load(); toast("Left the group", "info"); }
  async function remove(c: Community) { if (confirm(`Delete the group “${c.name}”? This can't be undone.`)) { await communityService.remove(c.id); load(); toast("Group deleted", "info"); } }
  async function setPhilosophy(id: string, p: CommunityPhilosophy) { await communityService.setPhilosophy(id, p); load(); toast(`Moderation set to “${p}”`, "success"); }

  return (
    <Box sx={{ maxWidth: 1100, mx: "auto" }}>
      <Stack direction="row" alignItems="center" sx={{ mb: 2 }}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="h5">Groups</Typography>
          <Typography variant="body2" color="text.secondary">Interest groups & servers — channels for text, voice, stages and events. Search, join, create or manage your own.</Typography>
        </Box>
        <Button variant="contained" onClick={openCreate}>+ New group</Button>
      </Stack>

      <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ mb: 2 }} alignItems={{ sm: "center" }}>
        <TextField size="small" placeholder="Search groups…" value={query} onChange={(e) => setQuery(e.target.value)} sx={{ flex: 1 }}
          InputProps={{ startAdornment: <InputAdornment position="start"><SearchRoundedIcon fontSize="small" /></InputAdornment> }} />
        <Stack direction="row" spacing={0.5}>
          {FILTERS.map((f) => (
            <Chip key={f.id} label={f.label} size="small" onClick={() => setFilter(f.id)} variant={filter === f.id ? "filled" : "outlined"}
              sx={filter === f.id ? { background: "linear-gradient(135deg,#3f97ff,#1668e0)", color: "#fff", fontWeight: 700 } : { borderColor: "rgba(58,155,240,0.3)", color: "text.secondary" }} />
          ))}
        </Stack>
      </Stack>

      <Grid container spacing={2}>
        {shown.length === 0 && <Grid item xs={12}><GlassCard><Typography color="text.secondary">No groups match. Try a different search or filter, or create one.</Typography></GlassCard></Grid>}
        {shown.map((c) => {
          const member = c.members.includes(mePk);
          const owner = c.owner === mePk;
          const mod = c.moderators.includes(mePk);
          return (
            <Grid item xs={12} sm={6} md={4} key={c.id}>
              <GlassCard sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
                <Stack direction="row" spacing={1.5} alignItems="center">
                  <Box sx={{ fontSize: 30 }}>{c.icon}</Box>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography sx={{ fontWeight: 700 }} noWrap>{c.name}</Typography>
                    <Typography variant="caption" color="text.secondary">{c.members.length} member{c.members.length === 1 ? "" : "s"} · {c.visibility}{owner ? " · yours" : ""}</Typography>
                  </Box>
                  {(owner || mod) && <Tooltip title="Edit group"><IconButton size="small" onClick={() => openEdit(c)}><EditRoundedIcon fontSize="small" /></IconButton></Tooltip>}
                  {owner && <Tooltip title="Delete group"><IconButton size="small" onClick={() => remove(c)}><DeleteRoundedIcon fontSize="small" sx={{ color: "#d23b2f" }} /></IconButton></Tooltip>}
                </Stack>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1, minHeight: 40 }}>{c.description}</Typography>
                <Stack direction="row" spacing={0.5} sx={{ mt: 1, flexWrap: "wrap", gap: 0.5 }}>
                  {c.channels.map((ch) => <Chip key={ch.id} size="small" icon={CHAN_ICON[ch.kind]} label={ch.name} variant="outlined" />)}
                </Stack>
                <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: 1.5 }}>
                  <Typography variant="caption" color="text.secondary">Moderation</Typography>
                  {mod ? (
                    <Select size="small" variant="standard" value={c.values?.philosophy ?? "open"} onChange={(e) => setPhilosophy(c.id, e.target.value as any)} sx={{ fontSize: 12 }}>
                      {PHILOSOPHIES.map((p) => <MenuItem key={p} value={p} sx={{ fontSize: 12 }}>{p}</MenuItem>)}
                    </Select>
                  ) : <Chip size="small" label={c.values?.philosophy ?? "open"} variant="outlined" sx={{ height: 18, fontSize: 10 }} />}
                </Stack>
                <Box sx={{ flex: 1 }} />
                {member
                  ? <Button fullWidth size="small" variant="outlined" color="inherit" sx={{ mt: 1.5 }} onClick={() => leave(c.id)} disabled={owner}>
                      {owner ? "You own this group" : "Leave"}
                    </Button>
                  : <Button fullWidth size="small" variant="contained" sx={{ mt: 1.5 }} onClick={() => join(c.id)}>Join</Button>}
              </GlassCard>
            </Grid>
          );
        })}
      </Grid>

      <Dialog open={dlg} onClose={() => setDlg(false)} fullWidth maxWidth="xs" PaperProps={{ sx: { backgroundImage: "none" } }}>
        <DialogTitle>{editId ? "Edit group" : "New group"}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 0.5 }}>
            <Stack direction="row" spacing={1}>
              <TextField label="Icon" value={icon} onChange={(e) => setIcon(e.target.value.slice(0, 2))} sx={{ width: 80 }} inputProps={{ style: { textAlign: "center", fontSize: 20 } }} />
              <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} fullWidth autoFocus />
            </Stack>
            <TextField label="Description" value={desc} onChange={(e) => setDesc(e.target.value)} fullWidth multiline minRows={2} />
            <Select size="small" value={visibility} onChange={(e) => setVisibility(e.target.value as Community["visibility"])}>
              <MenuItem value="public">Public — anyone can find & join</MenuItem>
              <MenuItem value="private">Private — invite only</MenuItem>
            </Select>
          </Stack>
        </DialogContent>
        <DialogActions><Button onClick={() => setDlg(false)}>Cancel</Button><Button variant="contained" onClick={save}>{editId ? "Save" : "Create"}</Button></DialogActions>
      </Dialog>
    </Box>
  );
}
