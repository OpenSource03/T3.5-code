import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  createSidebarPeekIntent,
  resolveSidebarPeekPointer,
  SIDEBAR_PEEK_CLOSE_DELAY_MS,
  SIDEBAR_PEEK_EDGE_WIDTH_PX,
  SIDEBAR_PEEK_HINT_DISTANCE_PX,
  SIDEBAR_PEEK_OPEN_DELAY_MS,
  SIDEBAR_PEEK_TRIGGER_OPEN_DELAY_MS,
} from "./sidebarPeek";

function setup(held = false) {
  const changes: boolean[] = [];
  const state = { held };
  const intent = createSidebarPeekIntent({
    onOpenChange: (open) => changes.push(open),
    isHeld: () => state.held,
  });
  return { changes, intent, state };
}

describe("sidebar peek intent", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens only after the pointer rests on the edge", () => {
    const { changes, intent } = setup();
    intent.edgeEnter();
    vi.advanceTimersByTime(SIDEBAR_PEEK_OPEN_DELAY_MS - 1);
    expect(changes).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(changes).toEqual([true]);
  });

  it("does not open when the pointer brushes past the edge", () => {
    const { changes, intent } = setup();
    intent.edgeEnter();
    vi.advanceTimersByTime(SIDEBAR_PEEK_OPEN_DELAY_MS / 2);
    intent.edgeLeave();
    vi.advanceTimersByTime(SIDEBAR_PEEK_OPEN_DELAY_MS * 2);
    expect(changes).toEqual([]);
  });

  it("survives a brief excursion away from the sidebar", () => {
    const { changes, intent } = setup();
    intent.reveal();
    intent.pointerAway();
    vi.advanceTimersByTime(SIDEBAR_PEEK_CLOSE_DELAY_MS - 1);
    intent.pointerInside();
    vi.advanceTimersByTime(SIDEBAR_PEEK_CLOSE_DELAY_MS * 2);
    expect(changes).toEqual([true]);
  });

  it("closes after the grace delay once the pointer stays away", () => {
    const { changes, intent } = setup();
    intent.reveal();
    intent.pointerAway();
    vi.advanceTimersByTime(SIDEBAR_PEEK_CLOSE_DELAY_MS);
    expect(changes).toEqual([true, false]);
  });

  it("stays open while held and closes on the next movement after release", () => {
    const { changes, intent, state } = setup(true);
    intent.reveal();
    intent.pointerAway();
    vi.advanceTimersByTime(SIDEBAR_PEEK_CLOSE_DELAY_MS * 4);
    expect(changes).toEqual([true]);

    state.held = false;
    intent.pointerAway();
    vi.advanceTimersByTime(SIDEBAR_PEEK_CLOSE_DELAY_MS);
    expect(changes).toEqual([true, false]);
  });

  it("keeps a focus-driven close from hiding the sidebar under the pointer", () => {
    const { changes, intent } = setup();
    intent.edgeEnter();
    vi.advanceTimersByTime(SIDEBAR_PEEK_OPEN_DELAY_MS);
    intent.pointerInside();
    intent.requestClose();
    vi.advanceTimersByTime(SIDEBAR_PEEK_CLOSE_DELAY_MS * 2);
    expect(changes).toEqual([true]);
  });

  it("forgets pending intent on reset", () => {
    const { changes, intent } = setup();
    intent.edgeEnter();
    intent.reset();
    vi.advanceTimersByTime(SIDEBAR_PEEK_OPEN_DELAY_MS * 2);
    expect(changes).toEqual([]);

    intent.reveal();
    intent.reset();
    intent.pointerAway();
    vi.advanceTimersByTime(SIDEBAR_PEEK_CLOSE_DELAY_MS * 2);
    expect(changes).toEqual([true]);
  });

  it("lets a shorter request overtake a pending open", () => {
    const { changes, intent } = setup();
    intent.edgeEnter(SIDEBAR_PEEK_TRIGGER_OPEN_DELAY_MS);
    vi.advanceTimersByTime(10);
    intent.edgeEnter(0);
    expect(changes).toEqual([true]);
    vi.advanceTimersByTime(SIDEBAR_PEEK_TRIGGER_OPEN_DELAY_MS);
    expect(changes).toEqual([true]);
  });

  it("does not restart the wait while the pointer keeps moving in the edge", () => {
    const { changes, intent } = setup();
    intent.edgeEnter();
    vi.advanceTimersByTime(SIDEBAR_PEEK_OPEN_DELAY_MS - 10);
    intent.edgeEnter();
    vi.advanceTimersByTime(10);
    expect(changes).toEqual([true]);
  });
});

describe("resolveSidebarPeekPointer", () => {
  const at = (x: number, y = 400, overTrigger = false) =>
    resolveSidebarPeekPointer({ x, y, titlebarBottom: 52, overTrigger });

  it("reveals from the edge and opens at once against the wall", () => {
    expect(at(SIDEBAR_PEEK_EDGE_WIDTH_PX).zone).toBe("edge");
    expect(at(SIDEBAR_PEEK_EDGE_WIDTH_PX + 1).zone).toBe("none");
    expect(at(0).zone).toBe("wall");
  });

  it("fades the approach shadow in toward the edge", () => {
    expect(at(SIDEBAR_PEEK_HINT_DISTANCE_PX).hint).toBe(0);
    expect(at(SIDEBAR_PEEK_EDGE_WIDTH_PX).hint).toBe(1);
    const halfway = at((SIDEBAR_PEEK_HINT_DISTANCE_PX + SIDEBAR_PEEK_EDGE_WIDTH_PX) / 2).hint;
    expect(halfway).toBeCloseTo(0.5);
  });

  it("keeps the titlebar quiet except for the toggle", () => {
    expect(at(0, 20)).toEqual({ zone: "none", hint: 0 });
    expect(at(30, 20, true)).toEqual({ zone: "trigger", hint: 0 });
  });
});
