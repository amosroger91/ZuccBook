/** A shared, ref-counted `beforeunload` guard.
 *
 *  While any registered key is active (e.g. a YouTube video is playing), the
 *  browser shows its native "Leave site? / Reload site?" confirmation on
 *  refresh, tab-close, or external navigation — so you don't lose your place by
 *  accident. In-app hash navigation never unloads the page, so this only fires
 *  for genuinely lossy actions.
 *
 *  Browsers strip any custom message/buttons from this prompt for security, so
 *  the "open it on YouTube at the current time" escape hatch lives on the player
 *  UI itself (see GlobalWatchPlayer / GlobalFeedVideo), not in this dialog. */
const activeKeys = new Set<string>();

function onBeforeUnload(e: BeforeUnloadEvent) {
  if (activeKeys.size === 0) return;
  // The two lines below are the cross-browser incantation to trigger the prompt.
  e.preventDefault();
  e.returnValue = "";
  return "";
}

/** Add (active=true) or remove (active=false) a guard for `key`. The window
 *  listener is attached only while at least one key is active. */
export function setUnloadGuard(key: string, active: boolean) {
  const had = activeKeys.size > 0;
  if (active) activeKeys.add(key);
  else activeKeys.delete(key);
  const has = activeKeys.size > 0;
  if (has && !had) window.addEventListener("beforeunload", onBeforeUnload);
  else if (!has && had) window.removeEventListener("beforeunload", onBeforeUnload);
}
