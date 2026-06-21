import { Box } from "@mui/material";
import { keyframes } from "@mui/system";
import { useStore } from "@/store/useStore";

const drift = keyframes`
  0%   { transform: translate3d(-6%, -4%, 0) scale(1.1); }
  50%  { transform: translate3d(6%, 4%, 0) scale(1.25); }
  100% { transform: translate3d(-6%, -4%, 0) scale(1.1); }
`;

/** Animated nebula gradient backdrop — the immersive Blade Runner field. */
export default function Background() {
  const reduced = useStore((s) => s.settings.reducedMotion);
  return (
    <Box aria-hidden sx={{ position: "fixed", inset: 0, zIndex: 0, overflow: "hidden", bgcolor: "#05060f" }}>
      <Box sx={{
        position: "absolute", inset: "-20%",
        background:
          "radial-gradient(40% 40% at 20% 20%, rgba(110,231,255,0.18), transparent 60%)," +
          "radial-gradient(45% 45% at 80% 25%, rgba(167,139,250,0.20), transparent 60%)," +
          "radial-gradient(50% 50% at 60% 85%, rgba(244,114,182,0.16), transparent 60%)",
        filter: "blur(40px)",
        animation: reduced ? "none" : `${drift} 26s ease-in-out infinite`,
      }} />
      <Box sx={{
        position: "absolute", inset: 0, opacity: 0.5,
        backgroundImage:
          "linear-gradient(rgba(110,231,255,0.04) 1px, transparent 1px)," +
          "linear-gradient(90deg, rgba(110,231,255,0.04) 1px, transparent 1px)",
        backgroundSize: "44px 44px",
        maskImage: "radial-gradient(80% 80% at 50% 30%, #000, transparent)",
      }} />
    </Box>
  );
}
