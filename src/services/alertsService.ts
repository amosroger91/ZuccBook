// ============================================================
//  alertsService — a small notification center. Anything in the app
//  can raise a clickable alert (someone replied, reacted, DM'd you, a
//  watch party started…). Each alert carries where it points, so the
//  bell in the top bar can take you straight to the thing it's about.
//  Persisted locally so your alerts survive a reload.
// ============================================================
import type { Alert } from "@/types";
import { bus } from "@/lib/events";
import { storage } from "./storage";
import { newId } from "@/lib/id";

const MAX = 60;
let alerts: Alert[] = [];
let loaded = false;

class AlertsService {
  async load() {
    if (loaded) return;
    loaded = true;
    alerts = (await storage.kvGet<Alert[]>("alerts")) ?? [];
    // Funnel any raised alert into the store.
    bus.on("alert", (a) => this.push(a));
  }

  list(): Alert[] { return alerts; }
  unread(): number { return alerts.filter((a) => !a.read).length; }

  private async persist() { await storage.kvSet("alerts", alerts.slice(0, MAX)); bus.emit("alerts:updated", undefined); }

  async push(a: { kind: Alert["kind"]; text: string; route: string; postId?: string }) {
    const alert: Alert = { id: newId("al"), at: Date.now(), read: false, ...a };
    // de-dupe a rapid burst of identical alerts (same text within 5s)
    const recent = alerts[0];
    if (recent && recent.text === alert.text && alert.at - recent.at < 5000) return;
    alerts = [alert, ...alerts].slice(0, MAX);
    await this.persist();
  }

  async markRead(id: string) { const a = alerts.find((x) => x.id === id); if (a && !a.read) { a.read = true; await this.persist(); } }
  async markAllRead() { let changed = false; for (const a of alerts) if (!a.read) { a.read = true; changed = true; } if (changed) await this.persist(); }
  async clear() { alerts = []; await this.persist(); }
}

export const alertsService = new AlertsService();
