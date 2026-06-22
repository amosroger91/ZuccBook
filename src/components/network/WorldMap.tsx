// ============================================================
//  WorldMap — the network as an actual world map. Every peer that has
//  shared a coarse location (GPS opt-in, or an IP-based guess) is a
//  dot at their spot; you're highlighted. Hover a dot to see who it is
//  and what they're up to; click to open their profile. Locations ride
//  on presence and are only ever ~10 km accurate.
//
//  Rendered with react-simple-maps (Equal Earth projection). Land
//  geometry is fetched once from a CORS-friendly CDN; dots and map use
//  the same projection, so they always line up — at any zoom/pan.
// ============================================================
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Box, Stack, Typography, Chip, IconButton, Tooltip, Button } from "@mui/material";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import RemoveRoundedIcon from "@mui/icons-material/RemoveRounded";
import MyLocationRoundedIcon from "@mui/icons-material/MyLocationRounded";
import PublicRoundedIcon from "@mui/icons-material/PublicRounded";
import { ComposableMap, Geographies, Geography, Graticule, Sphere, ZoomableGroup, Marker } from "react-simple-maps";
import { presenceService } from "@/services/presenceService";
import { geoService } from "@/services/geoService";
import { identityService } from "@/services/identityService";
import { useStore } from "@/store/useStore";
import { bus, toast } from "@/lib/events";

const GEO_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";
const WORLD = { center: [0, 25] as [number, number], zoom: 1 };

interface Pt { pk: string; lat: number; lon: number; online: boolean; self: boolean; name: string; activity?: string; source?: "gps" | "ip" }

const isReal = (pk: string) => !!pk && pk !== "rss-bot" && pk !== "system" && pk !== "ai-bot" && !pk.startsWith("demo_");

function hash32(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
// Deterministic ±0.6° wiggle so people in the same town don't stack into one dot.
function jitter(pk: string): [number, number] {
  const h = hash32(pk);
  return [((h % 1000) / 1000 - 0.5) * 1.2, (((h >>> 10) % 1000) / 1000 - 0.5) * 1.2];
}

function collect(): Pt[] {
  const pts: Pt[] = [];
  const seen = new Set<string>();
  const meGeo = geoService.current();
  const mePk = identityService.pk;
  if (meGeo && mePk) { pts.push({ pk: mePk, lat: meGeo.lat, lon: meGeo.lon, online: true, self: true, name: identityService.current?.username || "You", source: meGeo.source }); seen.add(mePk); }
  for (const p of presenceService.list()) {
    if (!p.geo || seen.has(p.pk)) continue;
    seen.add(p.pk);
    pts.push({
      pk: p.pk, lat: p.geo.lat, lon: p.geo.lon, online: p.status !== "offline", self: false,
      name: p.username || "Anonymous",
      activity: p.activity?.detail ? `${p.activity.kind} ${p.activity.detail}`.trim() : undefined,
      source: p.geo.source,
    });
  }
  return pts;
}

export default function WorldMap() {
  const nav = useNavigate();
  const onlineCount = useStore((s) => s.onlineCount);
  const [pts, setPts] = useState<Pt[]>(collect());
  const [view, setView] = useState(WORLD);
  const [hover, setHover] = useState<Pt | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const mouse = useRef({ x: 0, y: 0 });
  const [, force] = useState(0); // re-render tooltip position on move while hovering

  useEffect(() => {
    const refresh = () => setPts(collect());
    const offs = [bus.on("presence:update", refresh), bus.on("peer:connected", refresh), bus.on("peer:disconnected", refresh)];
    const t = setInterval(refresh, 4000); // self location can arrive with no peer event
    return () => { offs.forEach((o) => o()); clearInterval(t); };
  }, []);

  const located = pts.length;
  const liveCount = useMemo(() => pts.filter((p) => p.online && !p.self).length, [pts]);
  const me = pts.find((p) => p.self) || null;

  function onMove(e: React.MouseEvent) {
    const r = wrapRef.current?.getBoundingClientRect();
    if (!r) return;
    mouse.current = { x: e.clientX - r.left, y: e.clientY - r.top };
    if (hover) force((n) => n + 1);
  }
  function centerOnMe() {
    if (me) setView({ center: [me.lon, me.lat], zoom: 4 });
    else enableLocation();
  }
  function zoomBy(f: number) { setView((v) => ({ ...v, zoom: Math.max(1, Math.min(8, v.zoom * f)) })); }
  async function enableLocation() {
    const ok = await geoService.requestPrecise();
    setPts(collect());
    if (ok && geoService.current()) setView({ center: [geoService.current()!.lon, geoService.current()!.lat], zoom: 4 });
    toast(ok ? "You're on the map 🌍" : "Couldn't get your location", ok ? "success" : "warn");
  }

  // tooltip placement (screen space, flips near the right/bottom edges)
  const w = wrapRef.current?.clientWidth ?? 0;
  const h = wrapRef.current?.clientHeight ?? 0;
  const tipLeft = mouse.current.x > w - 240 ? mouse.current.x - 232 : mouse.current.x + 14;
  const tipTop = mouse.current.y > h - 90 ? mouse.current.y - 70 : mouse.current.y + 14;

  return (
    <Box ref={wrapRef} onMouseMove={onMove} sx={{ position: "absolute", inset: 0, background: "radial-gradient(120% 120% at 50% 0%, #eaf5ff 0%, #d3e6f7 55%, #bcd8ef 100%)" }}>
      <ComposableMap projection="geoEqualEarth" width={800} height={400} projectionConfig={{ scale: 147 }} style={{ width: "100%", height: "100%" }}>
        <ZoomableGroup center={view.center} zoom={view.zoom} minZoom={1} maxZoom={8} onMoveEnd={(p: any) => setView({ center: p.coordinates, zoom: p.zoom })}>
          <Sphere id="sphere" fill="transparent" stroke="rgba(58,123,240,0.16)" strokeWidth={0.5} />
          <Graticule stroke="rgba(58,123,240,0.08)" strokeWidth={0.4} />
          <Geographies geography={GEO_URL}>
            {({ geographies }: any) =>
              geographies.map((geo: any) => (
                <Geography
                  key={geo.rsmKey} geography={geo}
                  fill="#e6eff9" stroke="#bdcfe6" strokeWidth={0.4}
                  style={{ default: { outline: "none" }, hover: { fill: "#dbe7f6", outline: "none" }, pressed: { outline: "none" } }}
                />
              ))
            }
          </Geographies>
          {pts.map((p) => {
            const [jx, jy] = jitter(p.pk);
            const color = p.self ? "#0a55cf" : p.online ? "#1668e0" : "#7aa6d6";
            const live = p.online || p.self;
            const r = p.self ? 4.2 : 2.8;
            return (
              <Marker
                key={p.pk} coordinates={[p.lon + jx, p.lat + jy]}
                onMouseEnter={() => setHover(p)} onMouseLeave={() => setHover(null)}
                onClick={() => { if (!p.self && isReal(p.pk)) nav(`/u/${p.pk}`); }}
                style={{ default: { cursor: p.self ? "default" : "pointer" }, hover: { cursor: p.self ? "default" : "pointer" }, pressed: {} }}
              >
                {live && (
                  <circle r={r} fill={color} opacity={0.35}>
                    <animate attributeName="r" values={`${r};${r * 3.4};${r}`} dur="2.4s" repeatCount="indefinite" />
                    <animate attributeName="opacity" values="0.38;0;0.38" dur="2.4s" repeatCount="indefinite" />
                  </circle>
                )}
                <circle r={r} fill={color} stroke="#fff" strokeWidth={p.self ? 1.3 : 0.8} />
                {/* generous invisible hit area for easy hover */}
                <circle r={10} fill="transparent" />
              </Marker>
            );
          })}
        </ZoomableGroup>
      </ComposableMap>

      {/* hover tooltip */}
      {hover && (
        <Box sx={{ position: "absolute", left: tipLeft, top: tipTop, pointerEvents: "none", zIndex: 6, bgcolor: "rgba(10,28,57,0.93)", color: "#fff", px: 1.1, py: 0.7, borderRadius: 1.5, maxWidth: 220, boxShadow: "0 6px 18px rgba(0,0,0,0.35)" }}>
          <Typography variant="caption" sx={{ fontWeight: 800, display: "block", lineHeight: 1.2 }}>{hover.self ? "You" : hover.name}</Typography>
          <Typography variant="caption" sx={{ opacity: 0.85, display: "block", lineHeight: 1.3 }}>
            {hover.self ? "this is you" : hover.online ? "online" : "seen recently"}
            {hover.activity ? ` · ${hover.activity}` : ""}
          </Typography>
          <Typography variant="caption" sx={{ opacity: 0.6, fontSize: 10 }}>
            ~10 km · {hover.source === "gps" ? "precise (you allowed)" : "approx (IP)"}{!hover.self && isReal(hover.pk) ? " · click to view" : ""}
          </Typography>
        </Box>
      )}

      {/* HUD */}
      <Box sx={{ position: "absolute", top: 18, left: 18, right: 96, pointerEvents: "none", color: "#0c2c57" }}>
        <Typography sx={{ fontWeight: 900, fontSize: { xs: 22, md: 28 }, letterSpacing: 0.5, textShadow: "0 1px 3px rgba(255,255,255,0.7)" }}>Around the world</Typography>
        <Typography variant="body2" sx={{ opacity: 0.85, maxWidth: 480, textShadow: "0 1px 4px rgba(255,255,255,0.7)" }}>
          Where this slice of the network is — locations only ~10&nbsp;km accurate. Hover a dot, click to visit. Drag to pan, scroll to zoom.
        </Typography>
        <Stack direction="row" spacing={1} sx={{ mt: 1.5, flexWrap: "wrap", gap: 1, pointerEvents: "auto" }}>
          <Chip size="small" label={`${located} · on the map`} sx={chipSx} />
          <Chip size="small" label={`${liveCount} · online`} sx={chipSx} />
          <Chip size="small" label={`${onlineCount} · network`} sx={chipSx} />
          {!me && <Chip size="small" icon={<MyLocationRoundedIcon sx={{ fontSize: 14 }} />} label="Show me" onClick={enableLocation} sx={{ ...chipSx, cursor: "pointer", "&:hover": { bgcolor: "#fff" } }} />}
        </Stack>
      </Box>

      {/* zoom / center controls — sit below the Galaxy/Map toggle (top-right) */}
      <Stack spacing={0.5} sx={{ position: "absolute", top: 64, right: 16 }}>
        <ControlBtn title="Zoom in" onClick={() => zoomBy(1.6)}><AddRoundedIcon fontSize="small" /></ControlBtn>
        <ControlBtn title="Zoom out" onClick={() => zoomBy(1 / 1.6)}><RemoveRoundedIcon fontSize="small" /></ControlBtn>
        <ControlBtn title={me ? "Center on me" : "Show me on the map"} onClick={centerOnMe}><MyLocationRoundedIcon fontSize="small" /></ControlBtn>
        <ControlBtn title="Whole world" onClick={() => setView(WORLD)}><PublicRoundedIcon fontSize="small" /></ControlBtn>
      </Stack>

      {/* empty state */}
      {located === 0 && (
        <Stack alignItems="center" spacing={1.5} sx={{ position: "absolute", inset: 0, justifyContent: "center", textAlign: "center", color: "#0c2c57", px: 3 }}>
          <PublicRoundedIcon sx={{ fontSize: 54, opacity: 0.5 }} />
          <Typography sx={{ fontWeight: 800 }}>No locations on the map yet</Typography>
          <Typography variant="body2" sx={{ opacity: 0.85, maxWidth: 360 }}>Put yourself on it (an anonymous ~10 km dot, only used here), and others will appear as they come online.</Typography>
          <Button variant="contained" startIcon={<MyLocationRoundedIcon />} onClick={enableLocation}>Show me on the map</Button>
        </Stack>
      )}

      {/* legend */}
      <Stack direction="row" spacing={2} sx={{ position: "absolute", bottom: 88, left: 18, pointerEvents: "none", color: "#0c2c57" }}>
        <Legend color="#0a55cf" label="you" />
        <Legend color="#1668e0" label="online" />
        <Legend color="#7aa6d6" label="seen" />
      </Stack>
    </Box>
  );
}

const chipSx = { bgcolor: "rgba(255,255,255,0.85)", color: "#1668e0", border: "1px solid rgba(58,155,240,0.4)", fontWeight: 700, backdropFilter: "blur(4px)" };

function ControlBtn({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip title={title} placement="left">
      <IconButton size="small" onClick={onClick} sx={{ bgcolor: "rgba(255,255,255,0.9)", color: "#1668e0", boxShadow: "0 2px 8px rgba(0,0,0,0.18)", "&:hover": { bgcolor: "#fff" } }}>{children}</IconButton>
    </Tooltip>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <Stack direction="row" spacing={0.75} alignItems="center">
      <Box sx={{ width: 9, height: 9, borderRadius: "50%", bgcolor: color, boxShadow: `0 0 8px ${color}` }} />
      <Typography variant="caption" sx={{ textShadow: "0 1px 4px rgba(255,255,255,0.7)" }}>{label}</Typography>
    </Stack>
  );
}
