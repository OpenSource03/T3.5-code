import type {
  EnvironmentId,
  OrchestrationV2ProjectedTurnItem,
  OrchestrationV2TurnItem,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import {
  toolCallLines,
  turnItemDetailRevision,
  turnItemNeedsDetailFetch,
  turnItemOutputImages,
  turnItemOutputText,
} from "@t3tools/client-runtime/work-log/item-detail";
import { formatDiffCount } from "@t3tools/client-runtime/diff-count";
import { isJavaScriptReplTool } from "@t3tools/shared/toolActivity";
import { formatDuration } from "@t3tools/shared/orchestrationTiming";
import { CheckIcon, ExternalLinkIcon, GitBranchIcon, RotateCcwIcon } from "lucide-react";
import { memo, Suspense, use, useMemo, type ReactNode } from "react";

import { useTheme } from "../../hooks/useTheme";
import { cn } from "../../lib/utils";
import { resolveDiffThemeName } from "../../lib/diffRendering";
import { getSyntaxHighlighterPromise } from "../../lib/syntaxHighlighting";
import { useTurnItemDetail } from "../../state/queries";
import { useV2ItemSupport } from "../../state/v2ItemSupport";
import { formatWorkspaceRelativePath } from "../../filePathDisplay";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import ChatMarkdown, { ChatMarkdownAssetImage } from "../ChatMarkdown";
import { RenderErrorBoundary } from "../RenderErrorBoundary";
import { resolveExternalWebLinkHref } from "./externalLinkContextMenu";
import type { ExpandedImagePreview } from "./ExpandedImagePreview";
import { MessageCopyButton } from "./MessageCopyButton";
import { ShellCommandBlock } from "./ShellCommandBlock";
import {
  parseAnsi,
  toolCallHeading,
  toolCallOutcome,
  turnItemDurationMs,
  type AnsiColor,
  type ToolCallOutcome,
} from "./toolCallPresentation";

interface V2ItemInspectorProps {
  readonly projectedItem: OrchestrationV2ProjectedTurnItem;
  readonly environmentId: EnvironmentId;
  readonly cwd?: string | undefined;
  readonly workspaceRoot?: string | undefined;
  readonly onOpenThread: (threadId: ThreadId) => void;
  readonly onOpenTurnDiff: (runId: RunId, filePath?: string) => void;
  readonly onRollbackCheckpoint?: (input: {
    readonly checkpointId: string;
    readonly scopeId: string;
  }) => void;
  readonly onImageExpand?: ((preview: ExpandedImagePreview) => void) | undefined;
}

function SyntaxTokens({
  text,
  language,
}: {
  readonly text: string;
  readonly language: "json" | "typescript";
}) {
  const { resolvedTheme } = useTheme();
  const highlighter = use(getSyntaxHighlighterPromise(language));
  const { tokens } = useMemo(
    () =>
      highlighter.codeToTokens(text, {
        lang: language,
        theme: resolveDiffThemeName(resolvedTheme),
      }),
    [highlighter, text, language, resolvedTheme],
  );
  return tokens.flatMap((line, lineIndex) => [
    lineIndex > 0 ? "\n" : "",
    ...line.map((token) => (
      <span key={token.offset} style={{ color: token.color }}>
        {token.content}
      </span>
    )),
  ]);
}

const monoClassName =
  "font-mono text-(length:--font-size-code,var(--text-2xs)) leading-relaxed whitespace-pre-wrap break-words select-text";

function StructuredValue({
  value,
  highlightJson = false,
  language,
}: {
  readonly value: unknown;
  readonly highlightJson?: boolean;
  readonly language?: "typescript";
}) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  const isJson = useMemo(() => {
    if (!highlightJson || !text) return false;
    try {
      JSON.parse(text);
      return true;
    } catch {
      return false;
    }
  }, [highlightJson, text]);
  if (!text) return null;
  return (
    <pre className={cn("max-h-80 overflow-auto text-muted-foreground", monoClassName)}>
      {language || isJson ? (
        <RenderErrorBoundary fallback={text}>
          <Suspense fallback={text}>
            <SyntaxTokens text={text} language={language ?? "json"} />
          </Suspense>
        </RenderErrorBoundary>
      ) : (
        text
      )}
    </pre>
  );
}

/**
 * The item behind a projected row, with the output the timeline withheld
 * fetched while the row is open.
 */
function useFetchedTurnItem(
  projectedItem: OrchestrationV2ProjectedTurnItem,
  environmentId: EnvironmentId,
) {
  const wireItem = projectedItem.item;
  const fetches = turnItemNeedsDetailFetch(wireItem);
  const detail = useTurnItemDetail(
    fetches
      ? {
          environmentId,
          threadId: projectedItem.sourceThreadId,
          itemId: projectedItem.sourceItemId,
          revision: turnItemDetailRevision(wireItem),
        }
      : null,
  );
  const fetchedItem = detail.data?.item;
  const item = fetchedItem?.type === wireItem.type ? fetchedItem : wireItem;
  return {
    item,
    output: {
      output: turnItemOutputText(item),
      images: turnItemOutputImages(item),
      environmentId,
      pending: item === wireItem && detail.isPending,
      error:
        item !== wireItem
          ? null
          : detail.data?.item === null
            ? "Output is no longer available."
            : detail.error,
      empty: fetches && item !== wireItem,
    },
  };
}

interface ToolOutputState {
  readonly output: string | null;
  readonly images: ReturnType<typeof turnItemOutputImages>;
  readonly environmentId: EnvironmentId;
  readonly pending: boolean;
  readonly error: string | null;
  readonly empty: boolean;
  readonly onImageExpand?: ((preview: ExpandedImagePreview) => void) | undefined;
}

const ANSI_COLOR_CLASS_NAMES: Record<AnsiColor, string> = {
  red: "text-red-600 dark:text-red-400",
  green: "text-emerald-600 dark:text-emerald-400",
  yellow: "text-amber-600 dark:text-amber-300",
  blue: "text-blue-600 dark:text-blue-400",
  magenta: "text-fuchsia-600 dark:text-fuchsia-400",
  cyan: "text-cyan-600 dark:text-cyan-400",
  gray: "text-muted-foreground",
};

function AnsiText({ text }: { readonly text: string }) {
  const segments = useMemo(() => parseAnsi(text), [text]);
  if (segments.length === 1 && segments[0]?.color === null) return segments[0].text;
  return segments.map((segment, index) =>
    segment.color === null && !segment.bold && !segment.dim ? (
      segment.text
    ) : (
      // Runs are positional and never reorder for a given text.
      <span
        key={index}
        className={cn(
          segment.color && ANSI_COLOR_CLASS_NAMES[segment.color],
          segment.bold && "font-semibold",
          segment.dim && "opacity-60",
        )}
      >
        {segment.text}
      </span>
    ),
  );
}

function ToolOutput(props: ToolOutputState) {
  const images = props.images.map((resource) => (
    <ChatMarkdownAssetImage
      key={resource.index}
      environmentId={props.environmentId}
      resource={resource}
      alt="Tool output image"
      maxHeightRem={16}
      onImageExpand={props.onImageExpand}
    />
  ));
  const text = props.output ? (
    <div className="text-foreground/70">
      <AnsiText text={props.output} />
    </div>
  ) : props.pending ? (
    <div className="text-muted-foreground italic">Loading output…</div>
  ) : props.error ? (
    <div className="text-destructive">Couldn&apos;t load output: {props.error}</div>
  ) : props.empty && images.length === 0 ? (
    <div className="text-muted-foreground italic">No output.</div>
  ) : null;
  return (
    <>
      {images}
      {text}
    </>
  );
}

function toolOutputHasContent(props: ToolOutputState): boolean {
  return Boolean(
    props.output || props.images.length > 0 || props.pending || props.error || props.empty,
  );
}

/** Fetched output for rows that show their own plain text instead of the inspector. */
export function FetchedToolOutput(props: {
  readonly projectedItem: OrchestrationV2ProjectedTurnItem;
  readonly environmentId: EnvironmentId;
  readonly onImageExpand?: ((preview: ExpandedImagePreview) => void) | undefined;
}) {
  const { output } = useFetchedTurnItem(props.projectedItem, props.environmentId);
  return (
    <div className={cn("max-h-72 space-y-1.5 overflow-auto px-3 py-2", monoClassName)}>
      <ToolOutput {...output} onImageExpand={props.onImageExpand} />
    </div>
  );
}

function ToolCallStatus({ outcome }: { readonly outcome: ToolCallOutcome }) {
  switch (outcome.kind) {
    case "running":
      return <span className="text-muted-foreground">Running…</span>;
    case "stopped":
      return (
        <Badge size="sm" variant="warning">
          Stopped
        </Badge>
      );
    case "failed":
      return (
        <Badge size="sm" variant="error">
          {outcome.exitCode === null ? "Failed" : `exit ${outcome.exitCode}`}
        </Badge>
      );
    case "succeeded":
      return outcome.exitCode === null ? (
        <CheckIcon aria-label="Succeeded" className="size-3.5 text-success" />
      ) : (
        <Badge size="sm" variant="success">
          exit {outcome.exitCode}
        </Badge>
      );
  }
}

/**
 * A tool call's body as one card: a header naming the tool with its outcome,
 * the call itself in the foreground, and its result in a recessed pane below.
 */
function ToolCallCard(
  props: ToolOutputState & {
    readonly heading: ReactNode;
    readonly outcome: ToolCallOutcome;
    readonly durationMs: number | null;
    readonly copyText: string | null;
    readonly copyLabel: string;
    readonly children: ReactNode;
  },
) {
  return (
    <div className="min-w-0">
      <div className="flex h-8 min-w-0 items-center gap-2 border-b border-border/60 ps-3 pe-1.5 text-xs text-muted-foreground">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 truncate">{props.heading}</div>
        {props.durationMs !== null && props.outcome.kind !== "running" ? (
          <span className="shrink-0 tabular-nums">{formatDuration(props.durationMs)}</span>
        ) : null}
        <span className="flex shrink-0 items-center">
          <ToolCallStatus outcome={props.outcome} />
        </span>
        {props.copyText ? (
          <MessageCopyButton
            text={props.copyText}
            label={props.copyLabel}
            size="icon-xs"
            variant="ghost"
          />
        ) : (
          <span className="w-0.5" />
        )}
      </div>
      {props.children}
      {toolOutputHasContent(props) ? (
        <div
          className={cn(
            "max-h-72 space-y-1.5 overflow-auto border-t border-border/60 bg-background/60 px-3 py-2",
            monoClassName,
          )}
        >
          <ToolOutput {...props} />
        </div>
      ) : null}
    </div>
  );
}

function CommandCallCard(
  props: ToolOutputState & {
    readonly item: Extract<OrchestrationV2TurnItem, { type: "command_execution" }>;
  },
) {
  const { item, ...output } = props;
  const call = toolCallLines({ command: item.input });
  return (
    <ToolCallCard
      {...output}
      heading={<span className="font-medium text-foreground/80">Shell</span>}
      outcome={toolCallOutcome(item)}
      durationMs={turnItemDurationMs(item)}
      copyText={call.command}
      copyLabel="Copy command"
    >
      {call.command ? (
        <div className={cn("flex min-w-0 gap-2 px-3 py-2", monoClassName)}>
          <span aria-hidden className="shrink-0 select-none text-muted-foreground/70">
            $
          </span>
          <div className="min-w-0 flex-1">
            <ShellCommandBlock command={call.command} />
          </div>
        </div>
      ) : null}
    </ToolCallCard>
  );
}

function DynamicToolCallCard(
  props: ToolOutputState & {
    readonly item: Extract<OrchestrationV2TurnItem, { type: "dynamic_tool" }>;
  },
) {
  const { item, ...output } = props;
  const call = toolCallLines({ args: item.input });
  const heading = toolCallHeading(item.toolName, item.toolSource?.name);
  const hasCall = call.args !== null || call.argsText !== null;
  return (
    <ToolCallCard
      {...output}
      heading={
        <>
          {heading.source ? (
            <span className="max-w-[40%] shrink-0 truncate">{heading.source}</span>
          ) : null}
          {heading.source ? <span className="shrink-0 text-muted-foreground/50">/</span> : null}
          <span className="truncate font-mono font-medium text-foreground/80">{heading.name}</span>
        </>
      }
      outcome={toolCallOutcome(item)}
      durationMs={turnItemDurationMs(item)}
      copyText={hasCall ? JSON.stringify(item.input, null, 2) : null}
      copyLabel="Copy input"
    >
      {call.args ? (
        <dl
          className={cn(
            "grid max-h-72 grid-cols-[minmax(0,max-content)_minmax(0,1fr)] gap-x-3 gap-y-1 overflow-auto px-3 py-2",
            monoClassName,
          )}
        >
          {call.args.map(([key, value]) => (
            <div key={key} className="contents">
              <dt className="truncate text-muted-foreground">{key}</dt>
              <dd className="min-w-0 text-foreground/85">
                {key === "code" && isJavaScriptReplTool(item.toolName) ? (
                  <StructuredValue value={value} language="typescript" />
                ) : (
                  value
                )}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {call.argsText ? (
        <div className="px-3 py-2">
          <StructuredValue value={call.argsText} highlightJson />
        </div>
      ) : null}
    </ToolCallCard>
  );
}

export const V2ItemInspector = memo(function V2ItemInspector(props: V2ItemInspectorProps) {
  const fetched = useFetchedTurnItem(props.projectedItem, props.environmentId);
  const item = fetched.item;
  const outputState = fetched.output;
  const support = useV2ItemSupport({
    environmentId: props.environmentId,
    sourceThreadId: props.projectedItem.sourceThreadId,
    sourceItemId: props.projectedItem.sourceItemId,
  });
  if (item.type === "command_execution") {
    return (
      <div className="text-xs" data-v2-item-inspector={item.type}>
        <CommandCallCard item={item} {...outputState} onImageExpand={props.onImageExpand} />
      </div>
    );
  }
  if (item.type === "dynamic_tool") {
    return (
      <div className="text-xs" data-v2-item-inspector={item.type}>
        <DynamicToolCallCard item={item} {...outputState} onImageExpand={props.onImageExpand} />
      </div>
    );
  }
  return (
    <div className="space-y-2 p-3 text-xs" data-v2-item-inspector={item.type}>
      {item.type === "reasoning" && item.text ? (
        <div className="rounded-md border border-border/45 bg-muted/15 p-2 italic text-muted-foreground">
          <ChatMarkdown
            text={item.text}
            cwd={props.cwd}
            threadRef={{
              environmentId: props.environmentId,
              threadId: props.projectedItem.sourceThreadId,
            }}
            lineBreaks
          />
        </div>
      ) : null}

      {item.type === "file_change" ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-muted-foreground">
              {formatWorkspaceRelativePath(item.fileName, props.workspaceRoot)}
            </span>
            {item.additions !== undefined || item.deletions !== undefined ? (
              <span>
                <span className="text-success">+{formatDiffCount(item.additions ?? 0)}</span>{" "}
                <span className="text-destructive">-{formatDiffCount(item.deletions ?? 0)}</span>
              </span>
            ) : null}
            {item.runId !== null ? (
              <Button
                size="xs"
                variant="outline"
                onClick={() => props.onOpenTurnDiff(item.runId!, item.fileName)}
              >
                Open diff
              </Button>
            ) : null}
          </div>
          {item.status === "failed" && item.diffStr?.trim() ? (
            <StructuredValue value={item.diffStr} />
          ) : null}
          {item.changes !== undefined && item.changes.length > 0 ? (
            <ul className="space-y-1 font-mono text-muted-foreground">
              {item.changes.map((change, index) => (
                <li key={`${change.operation}:${change.path}:${index}`}>
                  {change.operation} {change.oldPath ? `${change.oldPath} → ` : ""}
                  {formatWorkspaceRelativePath(change.path, props.workspaceRoot)}
                  {change.fileType || change.mimeType
                    ? ` (${[change.fileType, change.mimeType].filter(Boolean).join(", ")})`
                    : ""}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {item.type === "file_search" && item.pattern?.trim() ? (
        <div className={cn("text-foreground/85", monoClassName)}>{item.pattern}</div>
      ) : null}

      {item.type === "web_search" && item.patterns?.length ? (
        <div className={cn("text-foreground/85", monoClassName)}>{item.patterns.join("\n")}</div>
      ) : null}

      {item.type === "file_search" && item.results?.length ? (
        <ul className="space-y-1">
          {item.results.map((result) => (
            <li key={JSON.stringify(result)}>
              <span className="font-mono text-foreground/80">
                {formatWorkspaceRelativePath(result.fileName, props.workspaceRoot)}
                {result.line === undefined ? "" : `:${result.line}`}
                {result.column === undefined ? "" : `:${result.column}`}
              </span>
              {result.preview ? (
                <p className="mt-0.5 whitespace-pre-wrap text-muted-foreground">{result.preview}</p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {item.type === "web_search" && item.results?.length ? (
        <ul className="space-y-1.5">
          {item.results.map((result) => {
            const safeHref = resolveExternalWebLinkHref(result.url);
            return (
              <li key={JSON.stringify(result)}>
                {safeHref ? (
                  <a
                    href={safeHref}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 font-medium text-foreground hover:underline"
                  >
                    {result.title ?? result.url}
                    <ExternalLinkIcon className="size-3" />
                  </a>
                ) : (
                  <p className="font-medium text-foreground">
                    {result.title ?? result.url ?? "Search result"}
                  </p>
                )}
                {result.snippet ? <p className="text-muted-foreground">{result.snippet}</p> : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {item.type === "approval_request" ? <StructuredValue value={item.prompt} /> : null}
      {item.type === "user_input_request" ? (
        <StructuredValue value={item.questions.map((question) => question.question).join("\n\n")} />
      ) : null}
      {item.type === "notification" ? <StructuredValue value={item.detail} /> : null}
      {item.type === "system_notice" ? <StructuredValue value={item.message} /> : null}
      {item.type === "error" ? <StructuredValue value={item.failure.message} /> : null}
      {item.type === "proposed_plan" ? <StructuredValue value={item.markdown} /> : null}
      {item.type === "todo_list" ? (
        <StructuredValue
          value={item.steps
            .map((step) => `${step.status === "completed" ? "✓" : "○"} ${step.text}`)
            .join("\n")}
        />
      ) : null}

      {item.type === "checkpoint" ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground">
            {support.checkpoint?.status ?? item.status} · {item.files.length} files
          </span>
          {props.onRollbackCheckpoint && support.checkpoint?.status === "ready" ? (
            <Button
              size="xs"
              variant="outline"
              onClick={() =>
                props.onRollbackCheckpoint?.({
                  checkpointId: item.checkpointId,
                  scopeId: item.scopeId,
                })
              }
            >
              <RotateCcwIcon className="size-3" />
              Roll back
            </Button>
          ) : null}
        </div>
      ) : null}

      {item.type === "fork" ? (
        <Button size="xs" variant="outline" onClick={() => props.onOpenThread(item.targetThreadId)}>
          <GitBranchIcon className="size-3" />
          Open fork
        </Button>
      ) : null}

      {item.type === "subagent" && item.childThreadId !== null ? (
        <Button size="xs" variant="outline" onClick={() => props.onOpenThread(item.childThreadId!)}>
          Open subagent thread
        </Button>
      ) : null}

      {item.type === "handoff" ? (
        <div className="space-y-1 text-muted-foreground">
          <p>
            {item.fromProviderInstanceIds.join(", ")} → {item.toProviderInstanceId}
          </p>
          <p>
            {item.strategy.replaceAll("_", " ")} · {support.contextHandoff?.status ?? item.status}
          </p>
          {support.contextTransfer ? (
            <p>
              Transfer {support.contextTransfer.type.replaceAll("_", " ")} ·{" "}
              {support.contextTransfer.status}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});
