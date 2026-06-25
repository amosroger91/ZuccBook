import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Box, Button, Typography, LinearProgress } from "@mui/material";
import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import GlassCard from "@/components/common/GlassCard";
import PostCard from "./PostCard";
import { feedService } from "@/services/feedService";
import { storage } from "@/services/storage";
import { bus } from "@/lib/events";
import type { Post } from "@/types";

const EMPTY_REPLIES: Post[] = [];

/** A single post on its own page (#/post/:id) — direct-linkable, with every
 *  comment expanded. Built from the local store; refreshes as replies arrive. */
export default function PostView() {
  const { id: raw } = useParams();
  const id = raw ? decodeURIComponent(raw) : "";
  const nav = useNavigate();
  const [post, setPost] = useState<Post | null | undefined>(undefined); // undefined = loading, null = not found
  const [replyMap, setReplyMap] = useState<Map<string, Post[]>>(new Map());

  useEffect(() => {
    let on = true;
    const load = async () => {
      const p = await storage.getPost(id);
      if (!on) return;
      setPost(p ?? null);
      const map = await feedService.replyMap();
      if (on) setReplyMap(map);
    };
    load();
    const off = bus.on("feed:updated", load);
    return () => { on = false; off(); };
  }, [id]);

  return (
    <Box sx={{ maxWidth: 720, mx: "auto" }}>
      <Button startIcon={<ArrowBackRoundedIcon />} onClick={() => nav(-1)} sx={{ mb: 1.5, textTransform: "none", color: "text.secondary" }}>Back</Button>
      {post === undefined ? <GlassCard><LinearProgress /></GlassCard>
        : post === null ? <GlassCard><Typography color="text.secondary">This post isn't on this device — it may not have synced yet, or the link is old.</Typography></GlassCard>
          : <PostCard post={post} replies={replyMap.get(post.id) ?? EMPTY_REPLIES} replyMap={replyMap} expanded />}
    </Box>
  );
}
