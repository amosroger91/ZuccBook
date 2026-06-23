import { useEffect, useMemo, useState } from "react";
import { Box, Stack, Typography, Button } from "@mui/material";
import TranslateRoundedIcon from "@mui/icons-material/TranslateRounded";
import { useStore } from "@/store/useStore";
import { translateService, langName, probablyNotEnglish } from "@/services/translateService";
import { renderBody, SafeImage, LinkCard, firstLink } from "@/components/feed/PostCard";
import type { MediaRef } from "@/types";

const LONG = 480;           // chars — collapse beyond this (or many lines)
const COLLAPSED_MAX = 200;  // px

// Shared chat-message body: same rich rendering as feed posts — inline images
// (NSFW-gated via SafeImage, tap-to-reveal when the filter's on), clickable links,
// emoji, markdown/code, profanity censoring — plus auto-translate of foreign
// messages, imeta (NIP-92) image attachments, a social-style link-preview card,
// and a "Show more" collapse for very long messages.
export default function MessageBody({ text = "", media }: { text?: string; media?: MediaRef[] }) {
  const censor = useStore((s) => s.settings.censorProfanity);
  const autoTranslate = useStore((s) => s.settings.autoTranslate);
  const [trans, setTrans] = useState<{ text: string; src: string } | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [confirmedEnglish, setConfirmedEnglish] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const translatable = useMemo(() => probablyNotEnglish(text), [text]);
  const link = useMemo(() => firstLink(text), [text]);   // first non-image/embed url → preview card

  async function doTranslate() {
    if (trans || translating) return;
    setTranslating(true);
    try {
      const res = await translateService.toEnglish(text);
      const src = (res.src || "").toLowerCase();
      if (!src || src.startsWith("en") || res.text.trim() === text.trim()) setConfirmedEnglish(true);
      else setTrans(res);
    } catch { /* leave original on failure */ }
    finally { setTranslating(false); }
  }
  // Auto-translate foreign messages (ON by default; the Settings toggle opts out).
  useEffect(() => {
    if (autoTranslate !== false && translatable && !trans && !translating && !confirmedEnglish) doTranslate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoTranslate, translatable]);

  const showingTrans = !!trans && !showOriginal;
  const body = showingTrans ? trans!.text : text;
  const long = body.length > LONG || (body.match(/\n/g)?.length ?? 0) > 10;
  const clamp = long && !expanded;
  const fade = "linear-gradient(to bottom, #000 72%, transparent)";
  const shown = clamp ? body.slice(0, 1200) : body;   // only parse what we show (long Nostr notes can be huge)

  return (
    <Box>
      {showingTrans && (
        <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mb: 0.25, opacity: 0.95 }}>
          <TranslateRoundedIcon sx={{ fontSize: 13, color: "#1668e0" }} />
          <Typography variant="caption" sx={{ color: "#1668e0", fontWeight: 700 }}>Translated from {langName(trans!.src)}</Typography>
          <Box component="button" onClick={() => setShowOriginal(true)}
            sx={{ background: "none", border: 0, p: 0, cursor: "pointer", font: "inherit", fontSize: 11, color: "text.secondary", fontWeight: 700, "&:hover": { textDecoration: "underline" } }}>
            · original
          </Box>
        </Stack>
      )}
      {body && (
        <Typography component="div" variant="body2"
          sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word", ...(clamp ? { maxHeight: COLLAPSED_MAX, overflow: "hidden", maskImage: fade, WebkitMaskImage: fade } : {}) }}>
          {renderBody(shown, censor, true)}
        </Typography>
      )}
      {long && (
        <Button size="small" disableRipple onClick={() => setExpanded((v) => !v)}
          sx={{ mt: 0.25, px: 0.5, py: 0, minWidth: 0, lineHeight: 1.4, textTransform: "none", fontWeight: 700, fontSize: 12, color: "inherit", opacity: 0.85, "&:hover": { bgcolor: "transparent", textDecoration: "underline" } }}>
          {expanded ? "Show less" : "Show more"}
        </Button>
      )}
      {media?.map((m, i) => (m.type === "image"
        ? <SafeImage key={i} src={m.url} sx={{ display: "block", mt: 0.5, maxWidth: "100%", maxHeight: 280, borderRadius: 1.5, border: "1px solid var(--bl-line)" }} />
        : null))}
      {link && <LinkCard url={link} />}
    </Box>
  );
}
