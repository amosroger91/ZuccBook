import { useEffect, useState } from "react";
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, Typography, Stack, Divider, Alert } from "@mui/material";
import InstallMobileRoundedIcon from "@mui/icons-material/InstallMobileRounded";
import IosShareRoundedIcon from "@mui/icons-material/IosShareRounded";
import AddBoxRoundedIcon from "@mui/icons-material/AddBoxRounded";
import MoreVertRoundedIcon from "@mui/icons-material/MoreVertRounded";
import QRCode from "qrcode";
import { useInstall } from "@/lib/pwa";
import { toast } from "@/lib/events";

// "Get the app on your phone." Shows the native install prompt when the browser
// offers one, platform-specific Add-to-Home-Screen steps for iOS & Android, and
// a QR of this page so a desktop visitor can hop straight to it on their phone.
export default function InstallHelpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { canPrompt, ios, promptInstall } = useInstall();
  const [qr, setQr] = useState("");

  useEffect(() => {
    if (!open) return;
    QRCode.toDataURL(location.href.replace(/#.*$/, ""), { errorCorrectionLevel: "M", margin: 1, width: 320 }).then(setQr).catch(() => {});
  }, [open]);

  async function install() {
    const outcome = await promptInstall();
    if (outcome === "accepted") { toast("Installing ZuccBook…", "success"); onClose(); }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth PaperProps={{ sx: { backgroundImage: "none" } }}>
      <DialogTitle sx={{ pb: 0.5 }}>Install ZuccBook on your phone</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          ZuccBook installs straight from the browser — no app store. It then opens full-screen like a native app and works offline.
        </Typography>

        {canPrompt && (
          <Button fullWidth variant="contained" size="large" startIcon={<InstallMobileRoundedIcon />} onClick={install} sx={{ mb: 2 }}>
            Install now
          </Button>
        )}

        <Box sx={{ display: "grid", placeItems: "center", mb: 1 }}>
          {qr && <Box component="img" src={qr} alt="Open on your phone" sx={{ width: 168, height: 168, borderRadius: 2, border: "1px solid var(--bl-line)" }} />}
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", textAlign: "center" }}>
          On a computer? Scan this with your phone's camera to open ZuccBook there, then follow the steps below.
        </Typography>

        <Divider sx={{ my: 2 }} />

        <Typography variant="subtitle2" sx={{ fontWeight: 800, display: "flex", alignItems: "center", gap: 0.75, mb: 1 }}>
          <IosShareRoundedIcon fontSize="small" sx={{ color: "#1668e0" }} /> iPhone / iPad (Safari)
        </Typography>
        <Stack spacing={0.75} sx={{ mb: 2 }}>
          <Typography variant="body2">1. Tap the <b>Share</b> button in Safari's toolbar.</Typography>
          <Typography variant="body2">2. Choose <b>Add to Home Screen</b>, then tap <b>Add</b>.</Typography>
        </Stack>

        <Typography variant="subtitle2" sx={{ fontWeight: 800, display: "flex", alignItems: "center", gap: 0.75, mb: 1 }}>
          <MoreVertRoundedIcon fontSize="small" sx={{ color: "#1668e0" }} /> Android (Chrome)
        </Typography>
        <Stack spacing={0.75}>
          <Typography variant="body2">1. Tap the <b>⋮</b> menu (top-right).</Typography>
          <Typography variant="body2">2. Tap <b>Install app</b> (or <b>Add to Home screen</b>).</Typography>
        </Stack>

        {ios && (
          <Alert severity="info" sx={{ mt: 2 }}>
            On iOS you must use <b>Safari</b> — other browsers can't add to the Home Screen.
          </Alert>
        )}
      </DialogContent>
      <DialogActions><Button onClick={onClose}>Done</Button></DialogActions>
    </Dialog>
  );
}
