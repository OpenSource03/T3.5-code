import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import {
  parseAnsi,
  toolCallHeading,
  toolCallOutcome,
  turnItemDurationMs,
} from "./toolCallPresentation";

describe("toolCallHeading", () => {
  it("splits Claude MCP tool names into server and tool", () => {
    expect(toolCallHeading("mcp__github__create_issue")).toEqual({
      source: "github",
      name: "create_issue",
    });
  });

  it("prefers a source the provider reported", () => {
    expect(toolCallHeading("mcp__gh__create_issue", "GitHub")).toEqual({
      source: "GitHub",
      name: "create_issue",
    });
    expect(toolCallHeading("preview_click", "T3 Code")).toEqual({
      source: "T3 Code",
      name: "preview_click",
    });
  });

  it("keeps plain tool names and names unnamed tools", () => {
    expect(toolCallHeading("Read")).toEqual({ source: null, name: "Read" });
    expect(toolCallHeading(null)).toEqual({ source: null, name: "Tool" });
  });
});

describe("turnItemDurationMs", () => {
  it("measures settled items only", () => {
    const startedAt = DateTime.makeUnsafe("2026-10-13T10:00:00.000Z");
    expect(
      turnItemDurationMs({
        startedAt,
        completedAt: DateTime.makeUnsafe("2026-10-13T10:00:02.500Z"),
      }),
    ).toBe(2_500);
    expect(turnItemDurationMs({ startedAt, completedAt: null })).toBeNull();
    expect(turnItemDurationMs({ startedAt: null, completedAt: startedAt })).toBeNull();
  });
});

describe("toolCallOutcome", () => {
  it("treats a nonzero exit or failure output as failed even when completed", () => {
    expect(toolCallOutcome({ status: "completed", exitCode: 2 })).toEqual({
      kind: "failed",
      exitCode: 2,
    });
    expect(toolCallOutcome({ status: "completed", outputIndicatesFailure: true })).toEqual({
      kind: "failed",
      exitCode: null,
    });
    expect(toolCallOutcome({ status: "completed", exitCode: 0 })).toEqual({
      kind: "succeeded",
      exitCode: 0,
    });
  });

  it("maps live and stopped statuses", () => {
    expect(toolCallOutcome({ status: "running" })).toEqual({ kind: "running" });
    expect(toolCallOutcome({ status: "interrupted" })).toEqual({ kind: "stopped" });
  });
});

describe("parseAnsi", () => {
  it("returns plain text untouched", () => {
    expect(parseAnsi("ok\n")).toEqual([{ text: "ok\n", color: null, bold: false, dim: false }]);
  });

  it("applies and resets SGR colors and weight", () => {
    expect(parseAnsi("\u001b[1;31mERROR\u001b[0m: \u001b[32mpassed\u001b[39m done")).toEqual([
      { text: "ERROR", color: "red", bold: true, dim: false },
      { text: ": ", color: null, bold: false, dim: false },
      { text: "passed", color: "green", bold: false, dim: false },
      { text: " done", color: null, bold: false, dim: false },
    ]);
  });

  it("drops non-color sequences and extended color arguments", () => {
    expect(parseAnsi("\u001b[2Kline\u001b[38;5;196m!\u001b[0m")).toEqual([
      { text: "line", color: null, bold: false, dim: false },
      { text: "!", color: null, bold: false, dim: false },
    ]);
  });
});
