import { useEffect, useMemo, useState, lazy, Suspense } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { Box, Snackbar, Alert, LinearProgress } from "@mui/material";
import { useStore } from "@/store/useStore";
import { bus } from "@/lib/events";
import { isOff } from "@/lib/flags";
import { identityService } from "@/services/identityService";
import { DEFAULT_SETTINGS } from "@/services/storage";
import { parseLink } from "@/services/deviceLink";
import Background from "@/components/common/Background";
import AppShell from "@/components/layout/AppShell";
// FeedView is the initial route but is only rendered after boot (behind the
// splash), so it's lazy like every other view — this keeps the feed's service
// stack (gun/nostr/rss) out of the entry chunk.
const FeedView = lazy(() => import("@/components/feed/FeedView"));
const Onboarding = lazy(() => import("@/components/onboarding/Onboarding"));
const DeviceLinkReceiver = lazy(() => import("@/components/profile/DeviceLinkReceiver"));
const CommunitiesView = lazy(() => import("@/components/communities/CommunitiesView"));
const TownSquareView = lazy(() => import("@/components/messages/TownSquareView"));
const GlobalChatView = lazy(() => import("@/components/messages/GlobalChatView"));
const ListenView = lazy(() => import("@/components/listen/ListenView"));
const CompanionView = lazy(() => import("@/components/companion/CompanionView"));
const ProfileView = lazy(() => import("@/components/profile/ProfileView"));
const SettingsView = lazy(() => import("@/components/settings/SettingsView"));
const AboutView = lazy(() => import("@/components/about/AboutView"));
const TopicsView = lazy(() => import("@/components/topics/TopicsView"));
const MarketView = lazy(() => import("@/components/market/MarketView"));
const WalletView = lazy(() => import("@/components/wallet/WalletView"));
const NetworkView = lazy(() => import("@/components/network/NetworkView"));
const PostView = lazy(() => import("@/components/feed/PostView"));
// The always-mounted players/docks aren't needed for first paint and pull heavy
// transports (peerjs via watch/chatroom, nostr via global chat). Defer them so
// they stream in after the shell, off the entry chunk.
const MiniPlayer = lazy(() => import("@/components/layout/MiniPlayer"));
const AudioMiniPlayer = lazy(() => import("@/components/layout/AudioMiniPlayer"));
const GlobalWatchPlayer = lazy(() => import("@/components/layout/GlobalWatchPlayer"));
const GlobalFeedVideo = lazy(() => import("@/components/layout/GlobalFeedVideo"));
const ReloadGuardDialog = lazy(() => import("@/components/layout/ReloadGuardDialog"));
const ImageLightbox = lazy(() => import("@/components/layout/ImageLightbox"));
const GlobalSpotify = lazy(() => import("@/components/layout/GlobalSpotify"));
const FloatingDocks = lazy(() => import("@/components/layout/FloatingDocks"));
const GeoConsent = lazy(() => import("@/components/layout/GeoConsent"));

export default function App() {
  const { ready, onboarded, setReady, setPresence, setOnlineCount } = useStore();
  const [toast, setToast] = useState<{ kind: any; message: string } | null>(null);
  const [notify, setNotify] = useState<string | null>(null);
  // "#/link?c=…" — another device is sharing its account with this one.
  const deviceLink = useMemo(() => parseLink(window.location.hash), []);

  useEffect(() => {
    let done = false;
    let cancelled = false;
    let cleanupPresence = () => {};
    // The service layer (boot) + presence are dynamically imported so their heavy
    // transports (gun/nostr/peerjs/ethers) stay out of the entry chunk and load
    // after first paint, while the splash is showing.
    (async () => {
      const [{ boot }, { presenceService }] = await Promise.all([
        import("@/services"),
        import("@/services/presenceService"),
      ]);
      if (cancelled) return;
      try {
        const r = await boot();
        done = true; if (!cancelled) setReady(r.onboarded, r.settings);
      } catch (e) {
        done = true; console.error("[boot] failed, showing app anyway", e); if (!cancelled) setReady(!!identityService.current, DEFAULT_SETTINGS);
      }
      if (cancelled) return;
      const refresh = () => { setPresence(presenceService.list()); setOnlineCount(presenceService.list().length + 1); };
      const offPres = bus.on("presence:update", refresh);
      const offConn = bus.on("peer:connected", refresh);
      const offDis = bus.on("peer:disconnected", refresh);
      const timer = setInterval(refresh, 20000);
      cleanupPresence = () => { offPres(); offConn(); offDis(); clearInterval(timer); };
    })();
    // Safety net: never let a slow/stalled service keep the UI on the splash.
    const fallback = setTimeout(() => { if (!done) setReady(!!identityService.current, DEFAULT_SETTINGS); }, 2500);
    const offToast = bus.on("toast", (t) => setToast(t));
    const offNotify = bus.on("notify", (n) => setNotify(n.text));
    return () => { cancelled = true; offToast(); offNotify(); clearTimeout(fallback); cleanupPresence(); };
  }, [setReady, setPresence, setOnlineCount]);

  return (
    <Box sx={{ minHeight: "100vh", position: "relative" }}>
      {!isOff("background") && <Background />}
      {/* AiSplash removed: WebLLM now loads on demand (not on boot), so a launch-time
          download overlay would just cover the app for its 30s safety timeout. */}
      {ready && deviceLink && <Suspense fallback={null}><DeviceLinkReceiver code={deviceLink.code} secret={deviceLink.secret} /></Suspense>}
      {ready && !deviceLink && !onboarded && <Suspense fallback={null}><Onboarding /></Suspense>}
      {ready && !deviceLink && onboarded && (
        <AppShell>
          <Suspense fallback={<LinearProgress sx={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 9999 }} />}>
            <Routes>
              <Route path="/" element={<FeedView />} />
              <Route path="/post/:id" element={<PostView />} />
              <Route path="/communities" element={<CommunitiesView />} />
              <Route path="/messages" element={<TownSquareView />} />
              <Route path="/chatroom" element={<TownSquareView />} />
              <Route path="/global-chat" element={<GlobalChatView />} />
              <Route path="/listen" element={<ListenView />} />
              <Route path="/companion" element={<CompanionView />} />
              <Route path="/topics" element={<TopicsView />} />
              <Route path="/market" element={<MarketView />} />
              <Route path="/wallet" element={<WalletView />} />
              <Route path="/network" element={<NetworkView />} />
              <Route path="/profile" element={<ProfileView />} />
              <Route path="/u/:pk" element={<ProfileView />} />
              <Route path="/settings" element={<SettingsView />} />
              <Route path="/about" element={<AboutView />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </AppShell>
      )}
      {ready && onboarded && <Suspense fallback={null}><ImageLightbox /></Suspense>}
      {ready && onboarded && !isOff("players") && (
        <Suspense fallback={null}>
          <GlobalWatchPlayer />
          <GlobalFeedVideo />
          <ReloadGuardDialog />
          <GlobalSpotify />
          <MiniPlayer />
          <AudioMiniPlayer />
          <FloatingDocks />
          <GeoConsent />
        </Suspense>
      )}
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
