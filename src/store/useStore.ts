// ============================================================
//  useStore — app-level state (Zustand). Service data (feed,
//  messages) is fetched on demand and refreshed via the event bus;
//  this store holds session/UI state shared across the tree.
// ============================================================
import { create } from "zustand";
import type { AppSettings, Identity, RichPresence } from "@/types";
import { storage, DEFAULT_SETTINGS } from "@/services/storage";
import { identityService } from "@/services/identityService";
import { companionService } from "@/services/companionService";
import { presenceService } from "@/services/presenceService";

interface AppState {
  ready: boolean;
  onboarded: boolean;
  me: Identity | null;
  settings: AppSettings;
  presence: RichPresence[];
  onlineCount: number;

  setReady: (onboarded: boolean, settings: AppSettings) => void;
  refreshMe: () => void;
  setSettings: (patch: Partial<AppSettings>) => Promise<void>;
  setPresence: (list: RichPresence[]) => void;
  setOnlineCount: (n: number) => void;
}

export const useStore = create<AppState>((set, get) => ({
  ready: false,
  onboarded: false,
  me: null,
  settings: DEFAULT_SETTINGS,
  presence: [],
  onlineCount: 1,

  setReady: (onboarded, settings) => set({ ready: true, onboarded, settings, me: identityService.publicProfile() }),
  refreshMe: () => set({ me: identityService.publicProfile(), onboarded: !!identityService.current }),

  setSettings: async (patch) => {
    const settings = { ...get().settings, ...patch };
    set({ settings });
    await storage.saveSettings(settings);
    companionService.configure(settings.companionPersona, settings.useWebLLM);
    if (patch.presenceStatus) presenceService.setStatus(patch.presenceStatus);
  },

  setPresence: (list) => set({ presence: list }),
  setOnlineCount: (n) => set({ onlineCount: n }),
}));
