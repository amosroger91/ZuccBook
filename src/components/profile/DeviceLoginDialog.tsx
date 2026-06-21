import { useEffect, useState } from "react";
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, Typography, TextField, IconButton, Tooltip, Alert, CircularProgress } from "@mui/material";
import ContentCopyRoundedIcon from "@mui/icons-material/ContentCopyRounded";
import QRCode from "qrcode";
import { identityService } from "@/services/identityService";
import { toast } from "@/lib/events";

// Shows a QR code + plaintext link that logs this account in on another device.
// The link carries the private key, so it's generated 100% locally (never sent
// to any QR service) and clearly flagged as a secret.
export default function DeviceLoginDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [url, setUrl] = useState("");
  const [qr, setQr] = useState("");
  const [err, setErr] = useState(false);

  useEffect(() => {
    if (!open) return;
    const token = identityService.exportToken();
    if (!token) { setErr(true); return; }
    const link = `${location.origin}${location.pathname}#/login?k=${encodeURIComponent(token)}`;
    setUrl(link); setErr(false); setQr("");
    QRCode.toDataURL(link, { errorCorrectionLevel: "L", margin: 1, width: 320 })
      .then(setQr).catch(() => setErr(true));
  }, [open]);

  function copy() { navigator.clipboard?.writeText(url).then(() => toast("Login link copied", "success")).catch(() => {}); }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth PaperProps={{ sx: { backgroundImage: "none" } }}>
      <DialogTitle sx={{ pb: 0.5 }}>Log in on another device</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          On your other device, scan this code (phone camera) or open the link below. It'll log you straight into <b>this account</b>.
        </Typography>

        <Box sx={{ display: "grid", placeItems: "center", minHeight: 240 }}>
          {err ? <Typography color="error">Couldn't generate the code.</Typography>
            : qr ? <Box component="img" src={qr} alt="Login QR" sx={{ width: 240, height: 240, borderRadius: 2, border: "1px solid var(--bl-line)" }} />
            : <CircularProgress />}
        </Box>

        <Typography variant="overline" color="text.secondary" sx={{ display: "block", mt: 1 }}>Or paste this link (e.g. on a PC)</Typography>
        <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
          <TextField fullWidth size="small" value={url} InputProps={{ readOnly: true, sx: { fontSize: 12, fontFamily: "monospace" } }} onFocus={(e) => e.target.select()} />
          <Tooltip title="Copy"><IconButton onClick={copy}><ContentCopyRoundedIcon fontSize="small" /></IconButton></Tooltip>
        </Box>

        <Alert severity="warning" sx={{ mt: 1.5 }}>
          <b>Treat this like your password.</b> Anyone who scans the code or opens the link gets full control of your account — it contains your private key. Only use it on devices you own, and don't share or screenshot it.
        </Alert>
      </DialogContent>
      <DialogActions><Button onClick={onClose}>Done</Button></DialogActions>
    </Dialog>
  );
}
