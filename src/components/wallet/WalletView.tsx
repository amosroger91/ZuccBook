import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { Box, Stack, Typography, TextField, Button, IconButton, Divider, Tooltip, CircularProgress, Chip, Collapse, ToggleButton, ToggleButtonGroup } from "@mui/material";
import ContentCopyRoundedIcon from "@mui/icons-material/ContentCopyRounded";
import RefreshRoundedIcon from "@mui/icons-material/RefreshRounded";
import SendRoundedIcon from "@mui/icons-material/SendRounded";
import QrCode2RoundedIcon from "@mui/icons-material/QrCode2Rounded";
import KeyRoundedIcon from "@mui/icons-material/KeyRounded";
import WarningAmberRoundedIcon from "@mui/icons-material/WarningAmberRounded";
import OpenInNewRoundedIcon from "@mui/icons-material/OpenInNewRounded";
import ExpandMoreRoundedIcon from "@mui/icons-material/ExpandMoreRounded";
import QRCode from "qrcode";
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
  const [qr, setQr] = useState("");
  const [lastTx, setLastTx] = useState("");
  const [risk, setRisk] = useState(false);

  const refresh = () => {
    setBusy(true);
    walletService.balances().then(setBal).catch(() => toast("Polygon network busy — tap refresh to retry", "warn")).finally(() => setBusy(false));
    walletService.prices().then(setPx).catch(() => {});
  };
  useEffect(() => { walletService.address().then(setAddress); refresh(); }, []);
  useEffect(() => {
    if (!address) return;
    QRCode.toDataURL(address, { width: 320, margin: 1, color: { dark: "#0a2a6b", light: "#ffffff" } }).then(setQr).catch(() => {});
  }, [address]);

  function copy(text: string) { navigator.clipboard?.writeText(text); toast("Copied", "success"); }

  const maticUsd = px && bal ? Number(bal.matic) * px.maticUsd : null;
  const usdcUsd = px && bal ? Number(bal.usdc) * px.usdcUsd : null;
  const totalUsd = maticUsd != null && usdcUsd != null ? maticUsd + usdcUsd : null;
  const amtUsd = px && Number(amount) > 0 ? Number(amount) * (currency === "MATIC" ? px.maticUsd : px.usdcUsd) : null;

  function setMax() {
    if (!bal) return;
    const v = currency === "MATIC" ? Math.max(0, Number(bal.matic) - 0.005) : Number(bal.usdc); // leave a little MATIC for gas
    setAmount(v > 0 ? String(Number(v.toFixed(currency === "MATIC" ? 4 : 2))) : "0");
  }

  async function send() {
    if (!walletService.isValidAddress(to)) { toast("Enter a valid 0x… address", "warn"); return; }
    if (!(Number(amount) > 0)) { toast("Enter an amount", "warn"); return; }
    setSending(true);
    try {
      const hash = await walletService.send(to.trim(), amount.trim(), currency);
      setLastTx(hash);
      toast(`Sent! tx ${hash.slice(0, 10)}…`, "success");
      setAmount(""); refresh();
    } catch (e: any) {
      toast(e?.shortMessage || e?.message || "Transaction failed", "error");
    } finally { setSending(false); }
  }

  async function importKey() {
    const pk = prompt("Paste a private key (0x…) to import. This replaces your current wallet on this device.");
    if (!pk) return;
    try { const addr = await walletService.importKey(pk); setAddress(addr); setShowKey(""); refresh(); toast("Wallet imported", "success"); }
    catch { toast("Invalid private key", "error"); }
  }

  return (
    <Box sx={{ maxWidth: 920, mx: "auto" }}>
      <Stack direction="row" alignItems="center" sx={{ mb: 2 }}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="h5" sx={{ fontWeight: 800 }}>Wallet</Typography>
          <Typography variant="body2" color="text.secondary">Self-custody on {CHAIN.name} — send & receive MATIC and USDC, no bank, no middleman.</Typography>
        </Box>
        <Tooltip title="Refresh balances"><span><IconButton onClick={refresh} disabled={busy}>{busy ? <CircularProgress size={20} /> : <RefreshRoundedIcon />}</IconButton></span></Tooltip>
      </Stack>

      {/* Hero balance "card" */}
      <GlassCard sx={{ p: 0, overflow: "hidden", position: "relative", mb: 2, color: "#fff", border: "none", background: "linear-gradient(135deg,#3f97ff 0%,#1668e0 45%,#0a2f86 100%)", boxShadow: "0 14px 40px rgba(22,104,224,0.35)" }}>
        <Box sx={{ position: "absolute", right: -50, top: -60, width: 220, height: 220, borderRadius: "50%", background: "radial-gradient(circle, rgba(255,255,255,0.18), transparent 70%)" }} />
        <Box sx={{ position: "absolute", right: 50, bottom: -80, width: 170, height: 170, borderRadius: "50%", background: "radial-gradient(circle, rgba(255,255,255,0.10), transparent 70%)" }} />
        <Box sx={{ position: "relative", p: { xs: 2.5, sm: 3 } }}>
          <Stack direction="row" alignItems="flex-start">
            <Box sx={{ flex: 1 }}>
              <Typography sx={{ opacity: 0.85, fontWeight: 700, letterSpacing: 0.6, fontSize: 12, textTransform: "uppercase" }}>Total balance</Typography>
              <Typography sx={{ fontWeight: 800, fontSize: { xs: 34, sm: 44 }, lineHeight: 1.05, mt: 0.5 }}>
                {totalUsd != null ? `$${totalUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}
              </Typography>
            </Box>
            <Chip size="small" label={CHAIN.name} sx={{ bgcolor: "rgba(255,255,255,0.22)", color: "#fff", fontWeight: 700 }} />
          </Stack>

          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.25} sx={{ mt: 2.5 }}>
            <HeroToken ticker="MATIC" amount={bal?.matic} usd={maticUsd} accent="linear-gradient(135deg,#a36bff,#7b3ff2)" />
            <HeroToken ticker="USDC" amount={bal?.usdc} usd={usdcUsd} accent="linear-gradient(135deg,#4aa8ff,#2775ca)" />
          </Stack>

          <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: 2.5, pt: 2, borderTop: "1px solid rgba(255,255,255,0.2)" }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography sx={{ opacity: 0.7, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>Your address</Typography>
              <Typography sx={{ fontFamily: "monospace", fontSize: { xs: 12.5, sm: 14 }, letterSpacing: 0.5, wordBreak: "break-all" }}>{address || "…"}</Typography>
            </Box>
            <Tooltip title="Copy address"><IconButton size="small" onClick={() => copy(address)} sx={{ color: "#fff", bgcolor: "rgba(255,255,255,0.16)", "&:hover": { bgcolor: "rgba(255,255,255,0.3)" } }}><ContentCopyRoundedIcon fontSize="small" /></IconButton></Tooltip>
          </Stack>
        </Box>
      </GlassCard>

      {/* Send + Receive */}
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 2, mb: 2 }}>
        <GlassCard>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
            <SendRoundedIcon fontSize="small" color="primary" />
            <Typography sx={{ fontWeight: 800 }}>Send</Typography>
          </Stack>
          <Stack spacing={1.5}>
            <TextField label="Recipient address (0x…)" value={to} onChange={(e) => setTo(e.target.value)} fullWidth size="small" />
            <ToggleButtonGroup exclusive fullWidth size="small" value={currency} onChange={(_, v) => v && setCurrency(v)}
              sx={{ "& .MuiToggleButton-root": { fontWeight: 700 }, "& .Mui-selected": { background: "linear-gradient(135deg,#3f97ff,#1668e0) !important", color: "#fff !important" } }}>
              <ToggleButton value="MATIC">MATIC</ToggleButton>
              <ToggleButton value="USDC">USDC</ToggleButton>
            </ToggleButtonGroup>
            <TextField label="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} size="small" fullWidth inputMode="decimal"
              InputProps={{ endAdornment: <Button size="small" onClick={setMax} disabled={!bal} sx={{ minWidth: 0, fontWeight: 700 }}>Max</Button> }}
              helperText={amtUsd != null ? `≈ $${amtUsd.toFixed(2)}` : (bal ? `Balance: ${currency === "MATIC" ? bal.matic : bal.usdc} ${currency}` : " ")} />
            <Button variant="contained" size="large" startIcon={<SendRoundedIcon />} onClick={send} disabled={sending}
              sx={{ background: "linear-gradient(135deg,#3f97ff,#1668e0)", fontWeight: 700, py: 1.1 }}>{sending ? "Sending…" : `Send ${currency}`}</Button>
            {lastTx && (
              <Button size="small" endIcon={<OpenInNewRoundedIcon />} component="a" href={walletService.explorerTx(lastTx)} target="_blank" rel="noopener noreferrer" sx={{ textTransform: "none" }}>
                View last transaction
              </Button>
            )}
          </Stack>
        </GlassCard>

        <GlassCard>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
            <QrCode2RoundedIcon fontSize="small" color="primary" />
            <Typography sx={{ fontWeight: 800 }}>Receive</Typography>
          </Stack>
          <Stack alignItems="center" spacing={1.5}>
            <Box sx={{ p: 1, borderRadius: 2, bgcolor: "#fff", border: "1px solid var(--bl-line)", lineHeight: 0 }}>
              {qr
                ? <Box component="img" src={qr} alt="Your wallet address QR code" sx={{ width: 168, height: 168, display: "block" }} />
                : <Box sx={{ width: 168, height: 168, display: "grid", placeItems: "center" }}><CircularProgress size={22} /></Box>}
            </Box>
            <Button fullWidth variant="outlined" startIcon={<ContentCopyRoundedIcon />} onClick={() => copy(address)} sx={{ textTransform: "none", fontWeight: 700 }}>Copy address</Button>
            <Typography variant="caption" color="text.secondary" sx={{ textAlign: "center" }}>Scan to pay you, or share your address / profile. Fund it with MATIC for gas.</Typography>
          </Stack>
        </GlassCard>
      </Box>

      {/* Live rate strip */}
      <GlassCard sx={{ mb: 2, py: 1.25 }}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
          <Typography variant="caption" sx={{ fontWeight: 800, color: "text.secondary", textTransform: "uppercase", letterSpacing: 0.5 }}>Live rate</Typography>
          {px ? (
            <>
              <Chip size="small" label={`1 MATIC ≈ $${px.maticUsd.toFixed(4)}`} sx={{ bgcolor: "rgba(58,123,240,0.1)", color: "#1668e0", fontWeight: 700 }} />
              <Chip size="small" label={`1 USDC ≈ $${px.usdcUsd.toFixed(2)}`} sx={{ bgcolor: "rgba(58,123,240,0.1)", color: "#1668e0", fontWeight: 700 }} />
              <Box sx={{ flex: 1 }} />
              <Typography variant="caption" color="text.secondary">via CoinGecko · reference only</Typography>
            </>
          ) : <Typography variant="caption" color="text.secondary">loading…</Typography>}
        </Stack>
      </GlassCard>

      {/* Risk + keys (danger zone) */}
      <GlassCard sx={{ border: "1px solid rgba(232,131,58,0.4)", background: "rgba(232,131,58,0.05)" }}>
        <Stack direction="row" alignItems="flex-start" spacing={1.25}>
          <WarningAmberRoundedIcon sx={{ color: "#e8833a", mt: 0.25 }} />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ fontWeight: 800 }}>Hot burner wallet — real, irreversible money</Typography>
            <Typography variant="body2" color="text.secondary">
              The private key lives in <b>this browser</b>. Keep only small amounts and <b>export your key</b> to back it up — clearing site data without a backup loses the funds. Polygon transactions are <b>permanent</b>.
            </Typography>
            <Button size="small" endIcon={<ExpandMoreRoundedIcon sx={{ transform: risk ? "rotate(180deg)" : "none", transition: "transform .2s" }} />} onClick={() => setRisk((v) => !v)} sx={{ textTransform: "none", px: 0, mt: 0.25 }}>
              {risk ? "Hide" : "Full disclaimer"}
            </Button>
            <Collapse in={risk}>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
                Ledger is non-custodial software provided <b>“as is”</b>, with <b>no warranty</b> — it never holds your keys or funds. <b>You alone are responsible for your funds and transactions.</b> Ledger and its authors are <b>not liable for any loss, theft, failed transaction, scam, or damages</b>. Nothing here is financial advice. Crypto is volatile and risky.
              </Typography>
            </Collapse>

            <Divider sx={{ my: 1.5 }} />

            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
              <KeyRoundedIcon fontSize="small" sx={{ color: "text.secondary" }} />
              <Typography sx={{ fontWeight: 700 }}>Keys</Typography>
            </Stack>
            <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
              <Button variant="outlined" size="small" startIcon={<KeyRoundedIcon />} onClick={async () => setShowKey(showKey ? "" : await walletService.exportKey())}>
                {showKey ? "Hide private key" : "Reveal private key"}
              </Button>
              <Button variant="text" size="small" onClick={importKey}>Import a key</Button>
            </Stack>
            {showKey && (
              <Box sx={{ mt: 1, p: 1, borderRadius: 1.5, bgcolor: "rgba(0,0,0,0.04)", border: "1px solid var(--bl-line)" }}>
                <Stack direction="row" alignItems="center" spacing={1}>
                  <Typography sx={{ fontFamily: "monospace", fontSize: 12, wordBreak: "break-all", flex: 1 }}>{showKey}</Typography>
                  <IconButton size="small" onClick={() => copy(showKey)}><ContentCopyRoundedIcon fontSize="small" /></IconButton>
                </Stack>
                <Typography variant="caption" sx={{ color: "#c0392b", fontWeight: 700, display: "block", mt: 0.5 }}>Anyone with this key controls the funds. Never share it.</Typography>
              </Box>
            )}
          </Box>
        </Stack>
      </GlassCard>
    </Box>
  );
}

function HeroToken({ ticker, amount, usd, accent }: { ticker: string; amount?: string; usd: number | null; accent: string }) {
  return (
    <Box sx={{ flex: 1, p: 1.25, borderRadius: 2, bgcolor: "rgba(255,255,255,0.14)", border: "1px solid rgba(255,255,255,0.22)" }}>
      <Stack direction="row" alignItems="center" spacing={1.25}>
        <Box sx={{ width: 30, height: 30, borderRadius: "50%", background: accent, display: "grid", placeItems: "center", fontSize: 11, fontWeight: 800, flexShrink: 0 }}>{ticker.slice(0, 1)}</Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontWeight: 800, fontSize: 18, lineHeight: 1 }}>{amount ?? "—"}</Typography>
          <Typography variant="caption" sx={{ opacity: 0.85 }}>{ticker}{usd != null ? ` · $${usd.toFixed(2)}` : ""}</Typography>
        </Box>
      </Stack>
    </Box>
  );
}
