// ============================================================
//  nsfwWorker — runs the on-device adult-image classifier OFF the main
//  thread. tfjs + nsfwjs (MobileNetV2) are heavy: the first inference
//  compiles shaders / warms the backend, which froze the UI for seconds
//  when it ran on the main thread mid-scroll. Here it all happens in a
//  Web Worker — the image is fetched, decoded (createImageBitmap) and
//  classified here, and only a boolean verdict is posted back, so the
//  feed stays a smooth 60fps no matter how many images stream in.
//
//  Fails OPEN (bad=false) on any error — a failed/blocked check must
//  never hide content. Processes one image at a time to bound memory.
// ============================================================
import type { NSFWJS } from "nsfwjs";

const ADULT_CLASSES = new Set(["Porn", "Hentai", "Sexy"]);
const THRESHOLD = 0.6;

const ctx: Worker = self as unknown as Worker;

let tf: typeof import("@tensorflow/tfjs") | null = null;
let modelP: Promise<NSFWJS> | null = null;
function getModel(): Promise<NSFWJS> {
  if (!modelP) {
    modelP = (async () => {
      tf = await import("@tensorflow/tfjs");
      // Import ONLY the MobileNetV2 model (~3.4MB) via nsfwjs's official subpath
      // exports + our own modelDefinitions. Importing the nsfwjs index instead
      // statically bundles ALL THREE shipped models (inception_v3 ~32MB +
      // mobilenet_v2_mid), ~40MB of weight chunks for a model we never use.
      const { load } = await import("nsfwjs/core");
      const { MobileNetV2Model } = await import("nsfwjs/models/mobilenet_v2");
      return load("MobileNetV2", { modelDefinitions: [MobileNetV2Model] });
    })();
  }
  return modelP;
}

async function classify(src: string): Promise<boolean> {
  try {
    const model = await getModel();
    const res = await fetch(src);
    const blob = await res.blob();
    const bitmap = await createImageBitmap(blob);
    const t = tf!.browser.fromPixels(bitmap);
    try {
      const preds = await model.classify(t);
      const score = preds.reduce((s, p) => (ADULT_CLASSES.has(p.className) ? s + p.probability : s), 0);
      return score >= THRESHOLD;
    } finally {
      t.dispose();
      bitmap.close();
    }
  } catch {
    return false; // fail open
  }
}

// Sequential queue — one classification at a time keeps memory + GPU pressure low.
const queue: string[] = [];
let busy = false;
function pump() {
  if (busy) return;
  const src = queue.shift();
  if (src === undefined) return;
  busy = true;
  classify(src)
    .then((bad) => ctx.postMessage({ src, bad }))
    .catch(() => ctx.postMessage({ src, bad: false }))
    .finally(() => { busy = false; pump(); });
}

ctx.onmessage = (e: MessageEvent<{ src: string }>) => {
  const src = e.data?.src;
  if (typeof src === "string") { queue.push(src); pump(); }
};
