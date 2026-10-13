/** Hover time at the window edge before a collapsed sidebar peeks, so brushing the edge does not flash it. */
export const SIDEBAR_PEEK_OPEN_DELAY_MS = 60;
/** Hover time on the sidebar toggle before it previews the sidebar; a click pins it instead. */
export const SIDEBAR_PEEK_TRIGGER_OPEN_DELAY_MS = 120;
/** Width of the left-edge zone that reveals the sidebar. */
export const SIDEBAR_PEEK_EDGE_WIDTH_PX = 28;
/** Distance from the left edge where the approach shadow starts to fade in. */
export const SIDEBAR_PEEK_HINT_DISTANCE_PX = 120;

export type SidebarPeekPointerZone = "trigger" | "wall" | "edge" | "none";

/**
 * Where a pointer sits relative to the reveal edge, and how strongly the
 * approach shadow shows (0 to 1). The titlebar band is left out so window
 * controls stay quiet; the toggle inside it previews on its own.
 */
export function resolveSidebarPeekPointer(input: {
  readonly x: number;
  readonly y: number;
  readonly titlebarBottom: number;
  readonly overTrigger: boolean;
}): { readonly zone: SidebarPeekPointerZone; readonly hint: number } {
  if (input.overTrigger) return { zone: "trigger", hint: 0 };
  if (input.y < input.titlebarBottom) return { zone: "none", hint: 0 };
  const hint = Math.min(
    1,
    Math.max(
      0,
      (SIDEBAR_PEEK_HINT_DISTANCE_PX - input.x) /
        (SIDEBAR_PEEK_HINT_DISTANCE_PX - SIDEBAR_PEEK_EDGE_WIDTH_PX),
    ),
  );
  // Pressed against the screen edge is unambiguous, so it opens without waiting.
  if (input.x <= 2) return { zone: "wall", hint };
  return { zone: input.x <= SIDEBAR_PEEK_EDGE_WIDTH_PX ? "edge" : "none", hint };
}
/** Grace after the pointer leaves a peeking sidebar, so diagonal movement does not close it. */
export const SIDEBAR_PEEK_CLOSE_DELAY_MS = 250;

export interface SidebarPeekIntent {
  /** The pointer reached the reveal edge. Opens after `delayMs`; a shorter request wins. */
  edgeEnter(delayMs?: number): void;
  /** The pointer left the reveal edge before the peek opened. */
  edgeLeave(): void;
  /** The pointer is over the peeking sidebar (or something that belongs to it). */
  pointerInside(): void;
  /** The pointer is over the rest of the app. Closes after the grace delay unless held. */
  pointerAway(): void;
  /** Something other than the pointer asks to close, such as focus leaving the sidebar. */
  requestClose(): void;
  /** Opens immediately, for keyboard focus. */
  reveal(): void;
  /** Closes immediately, for Escape. */
  dismiss(): void;
  /** Forgets all intent without notifying, for pinning, collapsing elsewhere, or unmounting. */
  reset(): void;
}

/**
 * Hover-intent for revealing a collapsed sidebar. `isHeld` keeps a due close
 * from happening (focus inside, an open menu); the next pointer movement
 * away retries it.
 */
export function createSidebarPeekIntent(options: {
  onOpenChange: (open: boolean) => void;
  isHeld: () => boolean;
}): SidebarPeekIntent {
  let open = false;
  let pointerIsInside = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let openDueAt = Infinity;

  const clearTimer = () => {
    openDueAt = Infinity;
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  };
  const setOpen = (next: boolean) => {
    clearTimer();
    if (open === next) return;
    open = next;
    options.onOpenChange(next);
  };
  const scheduleClose = () => {
    if (!open || timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      if (pointerIsInside || options.isHeld()) return;
      setOpen(false);
    }, SIDEBAR_PEEK_CLOSE_DELAY_MS);
  };

  return {
    edgeEnter(delayMs = SIDEBAR_PEEK_OPEN_DELAY_MS) {
      pointerIsInside = true;
      if (open) {
        clearTimer();
        return;
      }
      if (delayMs <= 0) {
        setOpen(true);
        return;
      }
      const dueAt = Date.now() + delayMs;
      if (dueAt >= openDueAt) return;
      clearTimer();
      openDueAt = dueAt;
      timer = setTimeout(() => setOpen(true), delayMs);
    },
    edgeLeave() {
      if (open) return;
      pointerIsInside = false;
      clearTimer();
    },
    pointerInside() {
      pointerIsInside = true;
      if (open) clearTimer();
    },
    pointerAway() {
      pointerIsInside = false;
      scheduleClose();
    },
    requestClose() {
      scheduleClose();
    },
    reveal() {
      setOpen(true);
    },
    dismiss() {
      setOpen(false);
    },
    reset() {
      clearTimer();
      open = false;
      pointerIsInside = false;
    },
  };
}
