import { useEffect, useRef, useState } from "react";
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, Typography, Alert, TextField, Stack } from "@mui/material";
import jsQR from "jsqr";
import { parseLink } from "@/services/deviceTransferService";

// Scans the QR shown by an already-signed-in device ("Log in on another
// device"). Uses the native BarcodeDetector when available, else jsQR on a
// canvas. Falls back to pasting the link when there's no camera (e.g. desktop).
function fragOf(text: string): string | null {
  const i = text.indexOf("#/link?c=");
  if (i < 0) return null;
  const frag = text.slice(i);
  return parseLink(frag) ? frag : null;
}

export default function QrScanDialog({ open, onClose, onFound }: { open: boolean; onClose: () => void; onFound: (frag: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const [err, setErr] = useState("");
  const [manual, setManual] = useState("");

  useEffect(() => {
    if (!open) return;
    setErr(""); setManual("");
    let cancelled = false;
    let detector: any = null;
    const canvas = document.createElement("canvas");

    const stop = () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
    const hit = (text: string) => {
      const frag = fragOf(text);
      if (!frag) return false;
      stop(); onFound(frag); return true;
    };

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        const v = videoRef.current!;
        v.srcObject = stream;
        await v.play().catch(() => {});
        if ("BarcodeDetector" in window) { try { detector = new (window as any).BarcodeDetector({ formats: ["qr_code"] }); } catch {} }
        const tick = async () => {
          if (cancelled) return;
          const v2 = videoRef.current;
          if (v2 && v2.videoWidth) {
            try {
              if (detector) {
                const codes = await detector.detect(v2);
                if (codes?.[0]?.rawValue && hit(codes[0].rawValue)) return;
              } else {
                const w = v2.videoWidth, h = v2.videoHeight;
                canvas.width = w; canvas.height = h;
                const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
                ctx.drawImage(v2, 0, 0, w, h);
                const qr = jsQR(ctx.getImageData(0, 0, w, h).data, w, h);
                if (qr?.data && hit(qr.data)) return;
              }
            } catch {}
          }
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      } catch (e: any) {
        setErr(e?.name === "NotAllowedError"
          ? "Camera permission was denied — paste the sign-in link below instead."
          : "No camera here — paste the sign-in link below instead.");
      }
    })();

    return stop;
  }, [open, onFound]);

  function submitManual() {
    const frag = fragOf(manual.trim());
    if (frag) onFound(frag);
    else setErr("That doesn't look like a ZuccBook sign-in link.");
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth PaperProps={{ sx: { backgroundImage: "none" } }}>
      <DialogTitle sx={{ pb: 0.5 }}>Scan a signed-in device</DialogTitle>
      <DialogContent>
        <Alert severity="info" sx={{ mb: 1.5 }}>
          On the device that's already signed in, open <b>Profile → Edit profile → "Log in on another device"</b> and point your camera at the QR it shows.
        </Alert>

        {!err && (
          <Box sx={{ position: "relative", borderRadius: 2, overflow: "hidden", bgcolor: "#000", aspectRatio: "1 / 1" }}>
            <Box component="video" ref={videoRef} muted playsInline sx={{ width: "100%", height: "100%", objectFit: "cover" }} />
            <Box sx={{ position: "absolute", inset: "16%", border: "3px solid rgba(255,255,255,0.9)", borderRadius: 2, pointerEvents: "none" }} />
          </Box>
        )}
        {err && <Alert severity="warning" sx={{ mb: 1.5 }}>{err}</Alert>}

        <Typography variant="overline" color="text.secondary" sx={{ display: "block", mt: 1.5 }}>Or paste the sign-in link</Typography>
        <Stack direction="row" spacing={1}>
          <TextField fullWidth size="small" value={manual} onChange={(e) => setManual(e.target.value)} placeholder="https://…#/link?c=…" InputProps={{ sx: { fontSize: 12 } }} />
          <Button variant="contained" onClick={submitManual}>Go</Button>
        </Stack>
      </DialogContent>
      <DialogActions><Button onClick={onClose}>Cancel</Button></DialogActions>
    </Dialog>
  );
}
