import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { Box, Stack, Typography, TextField, Button, IconButton, MenuItem, Divider, Alert, Tooltip, CircularProgress } from "@mui/material";
import ContentCopyRoundedIcon from "@mui/icons-material/ContentCopyRounded";
import RefreshRoundedIcon from "@mui/icons-material/RefreshRounded";
import GlassCard from "@/components/common/GlassCard";
import { walletService, CHAIN, type Currency } from "@/services/walletService";
import { toast } from "@/lib/events";

export default function WalletView() {
  const loc = useLocation();
  const [address, setAddress] = useState("");
  const [bal, setBal] = useState<{ matic: string; usdc: string } | null>(null);
  const [px, setPx] = useState<{ maticUsd: number; usdcUsd: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [to, setTo] = useState((loc.state as any)?.to ?? "");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<Currency>("MATIC");
  const [sending, setSending] = useState(false);
  const [showKey, setShowKey] = useState("");

  const refresh = () => {
    setBusy(true);
    walletService.balances().then(setBal).catch(() => toast("Polygon network busy — tap refresh to retry", "warn")).finally(() => setBusy(false));
    walletService.prices().then(setPx).catch(() => {});
  };
  useEffect(() => { walletService.address().then(setAddress); refresh(); }, []);

  function copy(text: string) { navigator.clipboard?.writeText(text); toast("Copied", "success"); }

  async function send() {
    if (!walletService.isValidAddress(to)) { toast("Enter a valid 0x… address", "warn"); return; }
    if (!(Number(amount) > 0)) { toast("Enter an amount", "warn"); return; }
    setSending(true);
    try {
      const hash = await walletService.send(to.trim(), amount.trim(), currency);
      toast(`Sent! tx ${hash.slice(0, 10)}…`, "success");
      setAmount(""); refresh();
    } catch (e: any) {
      toast(e?.shortMessage || e?.message || "Transaction failed", "error");
    } finally { setSending(false); }
  }

  async function importKey() {
    const pk = prompt("Paste a private key (0x…) to import. This replaces your current wallet on this device.");
    if (!pk) return;
    try { const addr = await walletService.importKey(pk); setAddress(addr); refresh(); toast("Wallet imported", "success"); }
    catch { toast("Invalid private key", "error"); }
  }

  return (
    <Box sx={{ maxWidth: 620, mx: "auto" }}>
      <Typography variant="h5">Wallet</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>Your self-custody wallet on {CHAIN.name}. Send & receive MATIC and USDC — no bank, no middleman.</Typography>

      <Alert severity="warning" sx={{ mb: 2 }}>
        <b>Real money, real risk.</b> This is a hot <b>burner wallet</b> whose private key is stored in this browser — anyone with access to this device (or who clears site data without a backup) can lose the funds. Keep only small amounts and <b>export your key</b> to back it up.
      </Alert>
      <Alert severity="error" sx={{ mb: 2 }}>
        Transactions on Polygon are <b>permanent and irreversible</b>. ZuccBook is non-custodial software provided <b>“as is”</b>, with <b>no warranty</b> — it never holds your keys or funds. <b>You alone are responsible for your funds and transactions.</b> ZuccBook and its authors are <b>not liable for any loss, theft, failed transaction, scam, or damages</b>. Nothing here is financial advice. Crypto is volatile and risky.
      </Alert>

      <GlassCard sx={{ mb: 2 }}>
        <Typography variant="overline" color="text.secondary">Balance</Typography>
        <Stack direction="row" alignItems="center" spacing={2} sx={{ mt: 0.5 }}>
          <Box>
            <Typography variant="h4">{bal ? bal.matic : "—"}</Typography>
            <Typography variant="caption" color="text.secondary">MATIC{px && bal ? ` · ≈ $${(Number(bal.matic) * px.maticUsd).toFixed(2)}` : ""}</Typography>
          </Box>
          <Divider orientation="vertical" flexItem />
          <Box>
            <Typography variant="h4">{bal ? bal.usdc : "—"}</Typography>
            <Typography variant="caption" color="text.secondary">USDC{px && bal ? ` · ≈ $${(Number(bal.usdc) * px.usdcUsd).toFixed(2)}` : ""}</Typography>
          </Box>
          <Box sx={{ flex: 1 }} />
          <Tooltip title="Refresh"><span><IconButton onClick={refresh} disabled={busy}>{busy ? <CircularProgress size={18} /> : <RefreshRoundedIcon />}</IconButton></span></Tooltip>
        </Stack>
        <Box sx={{ mt: 1.5, p: 1, borderRadius: 1.5, bgcolor: "rgba(58,123,240,0.06)", border: "1px solid rgba(58,155,240,0.16)" }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", fontWeight: 700 }}>USD conversion {px ? "" : "· loading…"}</Typography>
          {px && (
            <Stack direction="row" spacing={2} sx={{ mt: 0.25, flexWrap: "wrap" }}>
              <Typography variant="body2">1 MATIC ≈ <b>${px.maticUsd.toFixed(4)}</b></Typography>
              <Typography variant="body2">$1 ≈ <b>{(1 / px.maticUsd).toFixed(3)} MATIC</b></Typography>
              <Typography variant="body2">1 USDC ≈ <b>${px.usdcUsd.toFixed(2)}</b></Typography>
            </Stack>
          )}
          <Typography variant="caption" color="text.secondary">Live rate via CoinGecko · for reference only.</Typography>
        </Box>
      </GlassCard>

      <GlassCard sx={{ mb: 2 }}>
        <Typography variant="overline" color="text.secondary">Receive</Typography>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: 0.5 }}>
          <Typography sx={{ fontFamily: "monospace", fontSize: 13, wordBreak: "break-all", flex: 1 }}>{address || "…"}</Typography>
          <Tooltip title="Copy address"><IconButton onClick={() => copy(address)}><ContentCopyRoundedIcon fontSize="small" /></IconButton></Tooltip>
        </Stack>
        <Typography variant="caption" color="text.secondary">Share this address (or your profile) to get paid. Fund it with MATIC for gas.</Typography>
      </GlassCard>

      <GlassCard sx={{ mb: 2 }}>
        <Typography variant="overline" color="text.secondary">Send money</Typography>
        <Stack spacing={1.5} sx={{ mt: 1 }}>
          <TextField label="To address (0x…)" value={to} onChange={(e) => setTo(e.target.value)} fullWidth size="small" />
          <Stack direction="row" spacing={1}>
            <TextField label="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} size="small" sx={{ flex: 1 }} inputMode="decimal" />
            <TextField select label="Token" value={currency} onChange={(e) => setCurrency(e.target.value as Currency)} size="small" sx={{ width: 110 }}>
              <MenuItem value="MATIC">MATIC</MenuItem>
              <MenuItem value="USDC">USDC</MenuItem>
            </TextField>
          </Stack>
          <Button variant="contained" onClick={send} disabled={sending}>{sending ? "Sending…" : "Send"}</Button>
        </Stack>
      </GlassCard>

      <GlassCard>
        <Typography variant="overline" color="text.secondary">Keys</Typography>
        <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: "wrap", gap: 1 }}>
          <Button variant="outlined" onClick={async () => setShowKey(await walletService.exportKey())}>Reveal private key</Button>
          <Button variant="text" onClick={importKey}>Import a key</Button>
        </Stack>
        {showKey && (
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: 1 }}>
            <Typography sx={{ fontFamily: "monospace", fontSize: 12, wordBreak: "break-all", flex: 1 }}>{showKey}</Typography>
            <IconButton onClick={() => copy(showKey)}><ContentCopyRoundedIcon fontSize="small" /></IconButton>
          </Stack>
        )}
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>Anyone with this key controls the funds. Never share it.</Typography>
      </GlassCard>
    </Box>
  );
}
