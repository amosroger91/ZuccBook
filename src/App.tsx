import { useEffect, useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { Box, Snackbar, Alert } from "@mui/material";
import { boot } from "@/services";
import { useStore } from "@/store/useStore";
import { bus } from "@/lib/events";
import { presenceService } from "@/services/presenceService";
import Background from "@/components/common/Background";
import Onboarding from "@/components/onboarding/Onboarding";
import AppShell from "@/components/layout/AppShell";
import FeedView from "@/components/feed/FeedView";
import CommunitiesView from "@/components/communities/CommunitiesView";
import MessagesView from "@/components/messages/MessagesView";
import ListenView from "@/components/listen/ListenView";
import CompanionView from "@/components/companion/CompanionView";
import ProfileView from "@/components/profile/ProfileView";
import SettingsView from "@/components/settings/SettingsView";

export default function App() {
  const { ready, onboarded, setReady, setPresence, setOnlineCount } = useStore();
  const [toast, setToast] = useState<{ kind: any; message: string } | null>(null);

  useEffect(() => {
    boot().then((r) => setReady(r.onboarded, r.settings));
    const offToast = bus.on("toast", (t) => setToast(t));
    const refresh = () => { setPresence(presenceService.list()); setOnlineCount(presenceService.list().length + 1); };
    const offPres = bus.on("presence:update", refresh);
    const offConn = bus.on("peer:connected", refresh);
    const offDis = bus.on("peer:disconnected", refresh);
    const timer = setInterval(refresh, 20000);
    return () => { offToast(); offPres(); offConn(); offDis(); clearInterval(timer); };
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
            <Route path="/listen" element={<ListenView />} />
            <Route path="/companion" element={<CompanionView />} />
            <Route path="/profile" element={<ProfileView />} />
            <Route path="/settings" element={<SettingsView />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AppShell>
      )}
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
