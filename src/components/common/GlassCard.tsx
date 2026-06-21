import { Paper, type PaperProps } from "@mui/material";

/** A frosted glass surface — the base material of the whole UI. */
export default function GlassCard({ sx, ...props }: PaperProps) {
  return (
    <Paper
      elevation={0}
      sx={{
        borderRadius: 3,
        p: 2,
        transition: "border-color .2s ease, transform .2s ease",
        "&:hover": { borderColor: "rgba(110,231,255,0.28)" },
        ...sx,
      }}
      {...props}
    />
  );
}
