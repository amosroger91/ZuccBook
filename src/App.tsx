import { useEffect, useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { Box, Snackbar, Alert } from "@mui/material";
import { boot } from "@/services";
import { useStore } from "@/store/useStore";
import { bus } from "@/lib/events";
import { presenceService } from "@/services/presenceService";
import { identityService } from "@/services/identityService";
import { DEFAULT_SETTINGS } from "@/services/storage";
import Background from "@/components/common/Background";
import Onboarding from "@/components/onboarding/Onboarding";
import AppShell from "@/components/layout/AppShell";
import FeedView from "@/components/feed/FeedView";
import CommunitiesView from "@/components/communities/CommunitiesView";
import MessagesView from "@/components/messages/MessagesView";
import ChatroomView from "@/components/chatroom/ChatroomView";
import ListenView from "@/components/listen/ListenView";
import CompanionView from "@/components/companion/CompanionView";
import ProfileView from "@/components/profile/ProfileView";
import SettingsView from "@/components/settings/SettingsView";
import TopicsView from "@/components/topics/TopicsView";
import MarketView from "@/components/market/MarketView";
import WalletView from "@/components/wallet/WalletView";
import MiniPlayer from "@/components/layout/MiniPlayer";
import AudioMiniPlayer from "@/components/layout/AudioMiniPlayer";
import GlobalWatchPlayer from "@/components/layout/GlobalWatchPlayer";
import GlobalFeedVideo from "@/components/layout/GlobalFeedVideo";
import GlobalSpotify from "@/components/layout/GlobalSpotify";
import CompanionIntro from "@/components/layout/CompanionIntro";

export default function App() {
  const { ready, onboarded, setReady, setPresence, setOnlineCount } = useStore();
  const [toast, setToast] = useState<{ kind: any; message: string } | null>(null);
  const [notify, setNotify] = useState<string | null>(null);

  useEffect(() => {
    let done = false;
    boot()
      .then((r) => { done = true; setReady(r.onboarded, r.settings); })
      .catch((e) => { done = true; console.error("[boot] failed, showing app anyway", e); setReady(!!identityService.current, DEFAULT_SETTINGS); });
    // Safety net: never let a slow/stalled service keep the UI on the splash.
    const fallback = setTimeout(() => { if (!done) setReady(!!identityService.current, DEFAULT_SETTINGS); }, 2500);
    const offToast = bus.on("toast", (t) => setToast(t));
    const offNotify = bus.on("notify", (n) => setNotify(n.text));
    const refresh = () => { setPresence(presenceService.list()); setOnlineCount(presenceService.list().length + 1); };
    const offPres = bus.on("presence:update", refresh);
    const offConn = bus.on("peer:connected", refresh);
    const offDis = bus.on("peer:disconnected", refresh);
    const timer = setInterval(refresh, 20000);
    return () => { offToast(); offNotify(); offPres(); offConn(); offDis(); clearInterval(timer); clearTimeout(fallback); };
  }, [setReady, setPresence, setOnlineCount]);

  return (
    <Box sx={{ minHeight: "100vh", position: "relative" }}>
      <Background />
      {ready && !onboarded && <Onboarding />}
      {ready && onboarded && (
        <AppShell>
          <Routes>
            <Route path="/" element={<FeedView />} />
            <Route path="/communities" element={<CommunitiesView />} />
            <Route path="/messages" element={<MessagesView />} />
            <Route path="/chatroom" element={<ChatroomView />} />
            <Route path="/listen" element={<ListenView />} />
            <Route path="/companion" element={<CompanionView />} />
            <Route path="/topics" element={<TopicsView />} />
            <Route path="/market" element={<MarketView />} />
            <Route path="/wallet" element={<WalletView />} />
            <Route path="/profile" element={<ProfileView />} />
            <Route path="/u/:pk" element={<ProfileView />} />
            <Route path="/settings" element={<SettingsView />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AppShell>
      )}
      {ready && onboarded && <GlobalWatchPlayer />}
      {ready && onboarded && <GlobalFeedVideo />}
      {ready && onboarded && <GlobalSpotify />}
      {ready && onboarded && <MiniPlayer />}
      {ready && onboarded && <AudioMiniPlayer />}
      {ready && onboarded && <CompanionIntro />}
      <Snackbar
        open={!!notify}
        autoHideDuration={4000}
        onClose={() => setNotify(null)}
        anchorOrigin={{ vertical: "top", horizontal: "center" }}
      >
        {notify ? (
          <Alert severity="info" variant="filled" icon={<span>✨</span>} onClose={() => setNotify(null)}
            sx={{ background: "linear-gradient(135deg,#3f97ff,#1668e0)", color: "#ffffff", fontWeight: 600 }}>
            {notify}
          </Alert>
        ) : undefined}
      </Snackbar>
      <Snackbar
        open={!!toast}
        autoHideDuration={3200}
        onClose={() => setToast(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        {toast ? (
          <Alert severity={toast.kind === "warn" ? "warning" : toast.kind} variant="filled" onClose={() => setToast(null)}>
            {toast.message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </Box>
  );
}
