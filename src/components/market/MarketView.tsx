import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Box, Stack, Typography, TextField, Button, Chip, MenuItem, Grid, Dialog, DialogTitle, DialogContent, DialogActions, Alert } from "@mui/material";
import GlassCard from "@/components/common/GlassCard";
import UserAvatar from "@/components/common/UserAvatar";
import { marketplaceService } from "@/services/marketplaceService";
import { compressBanner } from "@/lib/image";
import { useStore } from "@/store/useStore";
import { bus, toast } from "@/lib/events";
import { walletService } from "@/services/walletService";
import type { Listing } from "@/types";

export default function MarketView() {
  const me = useStore((s) => s.me);
  const nav = useNavigate();
  const [items, setItems] = useState<Listing[]>(marketplaceService.list());
  const [form, setForm] = useState({ title: "", description: "", price: "", currency: "USDC" as "MATIC" | "USDC", image: "" });
  const [selling, setSelling] = useState(false);
  const [buying, setBuying] = useState<Listing | null>(null);
  const [buyBusy, setBuyBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { const off = bus.on("market:update", () => setItems(marketplaceService.list())); return off; }, []);

  async function pickImage(file?: File) { if (!file) return; try { setForm((f) => ({ ...f, image: "" })); const img = await compressBanner(file, 900); setForm((f) => ({ ...f, image: img })); } catch { toast("Couldn't load image", "warn"); } }
  async function create() {
    if (!form.title.trim() || !(Number(form.price) > 0)) { toast("Add a title and price", "warn"); return; }
    setSelling(true);
    try { await marketplaceService.create({ title: form.title.trim(), description: form.description.trim(), image: form.image || undefined, price: form.price.trim(), currency: form.currency }); setForm({ title: "", description: "", price: "", currency: form.currency, image: "" }); toast("Listed for sale ✦", "success"); }
    finally { setSelling(false); }
  }
  async function confirmBuy() {
    if (!buying) return;
    setBuyBusy(true);
    try { const hash = await marketplaceService.buy(buying); toast(`Paid! tx ${hash.slice(0, 10)}…`, "success"); setBuying(null); }
    catch (e: any) { toast(e?.shortMessage || e?.message || "Payment failed (need MATIC for gas?)", "error"); }
    finally { setBuyBusy(false); }
  }

  const active = items.filter((l) => !l.sold);

  return (
    <Box sx={{ maxWidth: 1000, mx: "auto" }}>
      <Stack direction="row" alignItems="center" sx={{ mb: 2 }}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="h5">Market</Typography>
          <Typography variant="body2" color="text.secondary">Buy & sell items, paid on Polygon. Buying sends the price straight to the seller — no middleman.</Typography>
        </Box>
        <Button variant="outlined" onClick={() => nav("/wallet")}>Wallet</Button>
      </Stack>

      <Alert severity="warning" sx={{ mb: 2 }}>
        Payments are <b>peer-to-peer and final</b> — there's <b>no escrow and no refunds</b>. A listing is a request to pay a stranger's wallet; nothing guarantees you'll receive the item. Only buy from people you trust. ZuccBook is <b>not responsible for any loss, fraud, or damages</b> — use at your own risk.
      </Alert>

      <GlassCard sx={{ mb: 2 }}>
        <Typography variant="overline" color="text.secondary">Sell an item</Typography>
        <Stack spacing={1.5} sx={{ mt: 1 }}>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
            <TextField label="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} size="small" sx={{ flex: 1 }} />
            <TextField label="Price" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} size="small" sx={{ width: 120 }} inputMode="decimal" />
            <TextField select label="Token" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value as any })} size="small" sx={{ width: 110 }}>
              <MenuItem value="USDC">USDC</MenuItem><MenuItem value="MATIC">MATIC</MenuItem>
            </TextField>
          </Stack>
          <TextField label="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} size="small" fullWidth multiline minRows={2} />
          <Stack direction="row" spacing={1} alignItems="center">
            <Button variant="outlined" onClick={() => fileRef.current?.click()}>{form.image ? "Change photo" : "Add photo"}</Button>
            {form.image && <Box component="img" src={form.image} sx={{ width: 56, height: 42, objectFit: "cover", borderRadius: 1 }} />}
            <Box sx={{ flex: 1 }} />
            <Button variant="contained" onClick={create} disabled={selling}>{selling ? "Listing…" : "List for sale"}</Button>
          </Stack>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => pickImage(e.target.files?.[0])} />
        </Stack>
      </GlassCard>

      <Grid container spacing={2}>
        {active.length === 0 && <Grid item xs={12}><GlassCard><Typography color="text.secondary">Nothing for sale yet. List something above — it syncs to everyone.</Typography></GlassCard></Grid>}
        {active.map((l) => {
          const mine = l.seller === me?.publicKey;
          return (
            <Grid item xs={12} sm={6} md={4} key={l.id}>
              <GlassCard sx={{ height: "100%", display: "flex", flexDirection: "column", p: 0, overflow: "hidden" }}>
                {l.image && <Box component="img" src={l.image} sx={{ width: "100%", height: 150, objectFit: "cover" }} />}
                <Box sx={{ p: 1.5, flex: 1, display: "flex", flexDirection: "column" }}>
                  <Typography sx={{ fontWeight: 700 }} noWrap>{l.title}</Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ flex: 1, mt: 0.5, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{l.description}</Typography>
                  <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: 1 }}>
                    <UserAvatar pk={l.seller} name={l.sellerName} size={22} />
                    <Typography variant="caption" sx={{ flex: 1, cursor: "pointer" }} noWrap onClick={() => nav(`/u/${l.seller}`)}>{l.sellerName}{mine ? " (you)" : ""}</Typography>
                    <Chip size="small" label={`${l.price} ${l.currency}`} sx={{ fontWeight: 700, bgcolor: "rgba(58,123,240,0.14)", color: "#1668e0" }} />
                  </Stack>
                  <Button fullWidth size="small" variant="contained" sx={{ mt: 1 }} disabled={mine} onClick={() => setBuying(l)}>{mine ? "Your listing" : "Buy"}</Button>
                </Box>
              </GlassCard>
            </Grid>
          );
        })}
      </Grid>

      <Dialog open={!!buying} onClose={() => !buyBusy && setBuying(null)} maxWidth="xs" fullWidth PaperProps={{ sx: { backgroundImage: "none" } }}>
        <DialogTitle>Confirm purchase</DialogTitle>
        <DialogContent>
          <Typography variant="body2">You'll pay <b>{buying?.price} {buying?.currency}</b> on Polygon for <b>{buying?.title}</b> to {buying?.sellerName}.</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1, fontFamily: "monospace", wordBreak: "break-all" }}>→ {buying?.sellerAddress}</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>This sends real funds from your wallet and can't be undone. You need MATIC for gas.</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBuying(null)} disabled={buyBusy}>Cancel</Button>
          <Button variant="contained" onClick={confirmBuy} disabled={buyBusy}>{buyBusy ? "Paying…" : `Pay ${buying?.price} ${buying?.currency}`}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
