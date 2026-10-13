import type { OrchestrationV2TurnItem } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

export interface ToolCallHeading {
  /** The server or integration that owns the tool, when the name carries one. */
  readonly source: string | null;
  readonly name: string;
}

const MCP_TOOL_NAME = /^mcp__(?<server>.+?)__(?<tool>.+)$/u;

/**
 * Splits a provider tool name into its owner and the tool itself, so
 * `mcp__github__create_issue` reads as "github" + "create_issue". Providers
 * that report the owner separately pass it as `sourceName`.
 */
export function toolCallHeading(
  toolName: string | null | undefined,
  sourceName?: string | null,
): ToolCallHeading {
  const name = toolName?.trim() || "Tool";
  const mcp = MCP_TOOL_NAME.exec(name)?.groups;
  if (mcp?.server && mcp.tool) {
    return { source: sourceName?.trim() || mcp.server, name: mcp.tool };
  }
  return { source: sourceName?.trim() || null, name };
}

/** Wall time of a settled item; null while it runs or when either bound is missing. */
export function turnItemDurationMs(
  item: Pick<OrchestrationV2TurnItem, "startedAt" | "completedAt">,
): number | null {
  if (!item.startedAt || !item.completedAt) return null;
  const durationMs =
    DateTime.toEpochMillis(item.completedAt) - DateTime.toEpochMillis(item.startedAt);
  return durationMs >= 0 ? durationMs : null;
}

export type ToolCallOutcome =
  | { readonly kind: "running" }
  | { readonly kind: "succeeded"; readonly exitCode: number | null }
  | { readonly kind: "failed"; readonly exitCode: number | null }
  | { readonly kind: "stopped" };

export function toolCallOutcome(
  item: Pick<OrchestrationV2TurnItem, "status"> & {
    readonly exitCode?: number | undefined;
    readonly outputIndicatesFailure?: boolean | undefined;
  },
): ToolCallOutcome {
  const exitCode = item.exitCode ?? null;
  switch (item.status) {
    case "idle":
    case "pending":
    case "running":
    case "waiting":
      return { kind: "running" };
    case "cancelled":
    case "interrupted":
      return { kind: "stopped" };
    case "failed":
      return { kind: "failed", exitCode };
    case "completed":
      return (exitCode !== null && exitCode !== 0) || item.outputIndicatesFailure
        ? { kind: "failed", exitCode }
        : { kind: "succeeded", exitCode };
  }
}

export type AnsiColor = "red" | "green" | "yellow" | "blue" | "magenta" | "cyan" | "gray";

export interface AnsiSegment {
  readonly text: string;
  readonly color: AnsiColor | null;
  readonly bold: boolean;
  readonly dim: boolean;
}

const ANSI_SEQUENCE = /\u001b\[([0-9;?]*)([A-Za-z])/gu;
const ANSI_COLORS: ReadonlyArray<AnsiColor | null> = [
  null,
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  null,
];

/**
 * Splits terminal output into styled runs. Only SGR color and weight codes are
 * kept; cursor movement and other control sequences are dropped.
 */
export function parseAnsi(text: string): AnsiSegment[] {
  if (!text.includes("\u001b")) return [{ text, color: null, bold: false, dim: false }];
  const segments: AnsiSegment[] = [];
  let color: AnsiColor | null = null;
  let bold = false;
  let dim = false;
  let cursor = 0;
  const push = (chunk: string) => {
    if (chunk) segments.push({ text: chunk, color, bold, dim });
  };
  for (const match of text.matchAll(ANSI_SEQUENCE)) {
    push(text.slice(cursor, match.index));
    cursor = match.index + match[0].length;
    if (match[2] !== "m") continue;
    const codes = (match[1] ?? "").split(";").map((code) => Number(code || "0"));
    for (let index = 0; index < codes.length; index += 1) {
      const code = codes[index] ?? 0;
      if (code === 0) {
        color = null;
        bold = false;
        dim = false;
      } else if (code === 1) bold = true;
      else if (code === 2) dim = true;
      else if (code === 22) {
        bold = false;
        dim = false;
      } else if (code === 39) color = null;
      else if (code >= 30 && code <= 37) color = ANSI_COLORS[code - 30] ?? null;
      else if (code >= 90 && code <= 97)
        color = code === 90 ? "gray" : (ANSI_COLORS[code - 90] ?? null);
      // 256-color and truecolor forms carry their own arguments; skip them.
      else if (code === 38 || code === 48) index += codes[index + 1] === 5 ? 2 : 4;
    }
  }
  push(text.slice(cursor));
  // Strip any stray escape bytes a truncated sequence left behind.
  return segments.map((segment) =>
    segment.text.includes("\u001b")
      ? { ...segment, text: segment.text.replaceAll("\u001b", "") }
      : segment,
  );
}
