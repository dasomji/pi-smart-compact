import type {
  AgentToolResult,
  CompactOptions,
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  SessionBeforeCompactEvent,
  SessionCompactEvent,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { createSmartBoundaryConfig, type SmartBoundaryConfigStore } from "../src/config.js";
import { SMART_BOUNDARY_COMMAND_NAME, SMART_COMPACT_COMMAND_NAME, SMART_COMPACT_TOOL_NAME } from "../src/constants.js";
import { calculateEscalationBand, isHigherEscalationBand } from "../src/escalation.js";
import {
  buildEscalationPrompt,
  buildManualSmartCompactRequestPrompt,
  SMART_COMPACT_HANDOFF_GUIDANCE,
  SMART_COMPACT_PROMPT_GUIDELINES,
  SMART_COMPACT_PROMPT_SNIPPET,
} from "../src/prompts.js";
import { parseSmartBoundaryInput } from "../src/smart-boundary-parser.js";
import {
  beginPendingSmartCompaction,
  clearPendingSmartCompaction,
  createSmartCompactRuntimeState,
  expirePendingSmartCompaction,
  getPendingSmartCompaction,
  markEscalationBandSent,
  resetEscalationState,
  syncEscalationBoundary,
  type PendingSmartCompactionState,
  type SmartCompactRuntimeState,
} from "../src/smart-compact-state.js";

type SmartBeforeCompactResult = {
  compaction: {
    summary: string;
    firstKeptEntryId: string;
    tokensBefore: number;
    details: Record<string, unknown>;
  };
};

export default function smartCompactExtension(pi: ExtensionAPI) {
  const config = createSmartBoundaryConfig();
  const runtimeState = createSmartCompactRuntimeState();

  pi.on("session_start", () => {
    resetEscalationState(runtimeState);
  });

  pi.on("turn_end", async (_event, ctx) => {
    await monitorContextUsage(pi, ctx, config, runtimeState);
  });

  registerSmartCompactCommand(pi);
  registerSmartCompactTool(pi, runtimeState);
  registerSmartCompactionHooks(pi, runtimeState);

  pi.registerCommand(SMART_BOUNDARY_COMMAND_NAME, {
    description: "Show, set, or reset the global smart compaction token boundary.",
    handler: async (args: string, ctx: ExtensionCommandContext): Promise<void> => {
      const parsed = parseSmartBoundaryInput(args);

      if (!parsed.ok) {
        return notify(ctx, parsed.message, "error") as unknown as void;
      }

      if (parsed.action === "show") {
        const current = await config.read();
        return notify(
          ctx,
          describeCurrentBoundary(current.tokens, current.source === "default", current.warning),
          current.warning ? "warning" : "info",
        ) as unknown as void;
      }

      if (parsed.action === "reset") {
        const current = await config.reset();
        resetEscalationState(runtimeState);
        const resetFeedback = notify(
          ctx,
          `Smart boundary reset to the default ${formatTokens(current.tokens)}.`,
          current.warning ? "warning" : "info",
        );
        const warningFeedback = current.warning ? notify(ctx, current.warning, "warning") : undefined;
        const fallback = [resetFeedback, warningFeedback].filter(Boolean).join("\n") || undefined;
        return fallback as unknown as void;
      }

      const saved = await config.write(parsed.tokens);
      resetEscalationState(runtimeState);
      return notify(ctx, `Smart boundary set to ${formatTokens(saved.tokens)}.`) as unknown as void;
    },
  });
}

function registerSmartCompactCommand(pi: ExtensionAPI): void {
  pi.registerCommand(SMART_COMPACT_COMMAND_NAME, {
    description: "Request cooperative smart compaction with an agent-authored handoff.",
    handler: async (args: string, ctx: ExtensionCommandContext): Promise<void> => {
      if (args.trim()) {
        return notify(
          ctx,
          "Run /smart-compact without handoff text. The active agent must author the handoff from its current context and then call smart_compact.",
          "error",
        ) as unknown as void;
      }

      try {
        await sendManualSmartCompactRequest(pi, ctx);
        return notify(
          ctx,
          "Smart compaction requested. The agent has been asked to stop at the next safe boundary, write a handoff, and call smart_compact.",
        ) as unknown as void;
      } catch (error) {
        return notify(ctx, `Smart compaction request could not be sent: ${errorMessage(error)}`, "error") as unknown as void;
      }
    },
  });
}

async function sendManualSmartCompactRequest(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
  const message = buildManualSmartCompactRequestPrompt();
  const options = shouldDeliverCommandMessageAsSteer(ctx) ? { deliverAs: "steer" as const } : {};
  await Promise.resolve(pi.sendUserMessage(message, options));
}

function shouldDeliverCommandMessageAsSteer(ctx: ExtensionCommandContext): boolean {
  try {
    return typeof ctx.isIdle === "function" ? !ctx.isIdle() : false;
  } catch {
    return false;
  }
}

function registerSmartCompactTool(pi: ExtensionAPI, runtimeState: SmartCompactRuntimeState): void {
  pi.registerTool({
    name: SMART_COMPACT_TOOL_NAME,
    label: "Smart compact",
    description: [
      "Submit an agent-authored handoff and start same-session smart compaction.",
      "Use this when the smart compaction boundary asks you to compact after a safe stopping point.",
      `The handoff must include ${SMART_COMPACT_HANDOFF_GUIDANCE}.`,
      "Call smart_compact alone as the final action/only tool call for the current mini-phase; do not do more work until continuation.",
    ].join("\n"),
    promptSnippet: SMART_COMPACT_PROMPT_SNIPPET,
    promptGuidelines: SMART_COMPACT_PROMPT_GUIDELINES,
    parameters: Type.Object(
      {
        handoff: Type.String({
          minLength: 1,
          description: `Required non-empty handoff covering ${SMART_COMPACT_HANDOFF_GUIDANCE}.`,
        }),
      },
      { additionalProperties: false },
    ),
    executionMode: "sequential",
    execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
      return executeSmartCompact(params as { handoff?: unknown }, ctx, runtimeState);
    },
  });
}

function registerSmartCompactionHooks(pi: ExtensionAPI, runtimeState: SmartCompactRuntimeState): void {
  pi.on("session_before_compact", async (event, ctx) => {
    return prepareSmartCompactionSummary(event, ctx, runtimeState);
  });

  pi.on("session_compact", async (event, ctx) => {
    await continueAfterSmartCompaction(pi, event, ctx, runtimeState);
  });
}

function prepareSmartCompactionSummary(
  event: SessionBeforeCompactEvent,
  ctx: ExtensionContext,
  runtimeState: SmartCompactRuntimeState,
): SmartBeforeCompactResult | undefined {
  const pending = getPendingSmartCompaction(runtimeState);
  if (!pending) {
    return undefined;
  }

  const preparation = event.preparation;
  if (event.signal?.aborted || !isValidCompactionPreparation(preparation)) {
    expirePendingSmartCompaction(runtimeState, pending.id);
    notifyIfAvailable(ctx, "Smart compaction could not safely customize the compaction summary; falling back to Pi default compaction.", "warning");
    return undefined;
  }

  return {
    compaction: {
      summary: buildSmartCompactionSummary(pending.handoff),
      firstKeptEntryId: preparation.firstKeptEntryId,
      tokensBefore: preparation.tokensBefore,
      details: buildSmartCompactionDetails(pending),
    },
  };
}

async function continueAfterSmartCompaction(
  pi: ExtensionAPI,
  event: SessionCompactEvent,
  ctx: ExtensionContext,
  runtimeState: SmartCompactRuntimeState,
): Promise<void> {
  const pending = getPendingSmartCompaction(runtimeState);
  if (!pending) {
    return;
  }

  const completedSmartCompactionId = getSmartCompactionIdFromDetails(event.compactionEntry?.details);
  if (completedSmartCompactionId !== pending.id) {
    return;
  }

  clearPendingSmartCompaction(runtimeState, pending.id);
  resetEscalationState(runtimeState);
  notifyIfAvailable(ctx, "Smart compaction completed. Continuing the same session.");

  try {
    await Promise.resolve(pi.sendUserMessage("continue", {}));
  } catch (error) {
    notifyIfAvailable(ctx, `Smart compaction completed, but automatic continuation could not be sent: ${errorMessage(error)}`, "error");
  }
}

async function executeSmartCompact(
  params: { handoff?: unknown },
  ctx: ExtensionContext,
  runtimeState: SmartCompactRuntimeState,
): Promise<AgentToolResult<unknown>> {
  const rawHandoff = params?.handoff;
  const handoff = typeof rawHandoff === "string" ? rawHandoff.trim() : "";

  if (!handoff) {
    return toolResult("smart_compact requires a non-empty handoff. Write the handoff text before retrying.", false, true);
  }

  const existingPending = getPendingSmartCompaction(runtimeState);
  if (existingPending) {
    return toolResult(
      "Smart compaction is already pending/in progress. Do not overwrite the handoff; wait for compaction or retry only after it fails.",
      true,
    );
  }

  const pending = beginPendingSmartCompaction(runtimeState, handoff);
  if (!pending) {
    return toolResult(
      "Smart compaction is already pending/in progress. Do not overwrite the handoff; wait for compaction or retry only after it fails.",
      true,
    );
  }

  let callbackError: Error | undefined;
  const compactOptions: CompactOptions = {
    onError: (error) => {
      callbackError = error;
      expirePendingSmartCompaction(runtimeState, pending.id);
      notifyIfAvailable(ctx, `Smart compaction failed: ${errorMessage(error)}`, "error");
    },
  };

  try {
    ctx.compact(compactOptions);
  } catch (error) {
    expirePendingSmartCompaction(runtimeState, pending.id);
    notifyIfAvailable(ctx, `Smart compaction could not start: ${errorMessage(error)}`, "error");
    return toolResult(`Smart compaction could not start: ${errorMessage(error)}. The pending handoff was cleared so you can retry.`, false, true);
  }

  if (callbackError) {
    return toolResult(
      `Smart compaction failed: ${errorMessage(callbackError)}. The pending handoff was cleared so you can retry.`,
      false,
      true,
    );
  }

  notifyIfAvailable(ctx, "Smart compaction started. The pending handoff has been saved.");
  return toolResult("Smart compaction has started. No further action is needed until the continuation after compaction.", true);
}

function toolResult(text: string, terminate: boolean, isError = false): AgentToolResult<unknown> {
  return {
    content: [{ type: "text", text }],
    isError,
    terminate,
  } as unknown as AgentToolResult<unknown>;
}

function buildSmartCompactionSummary(handoff: string): string {
  return [
    "Smart compaction summary from pi-smart-compact (`smart_compact`).",
    "The following handoff was authored by the agent at a cooperative same-session compaction boundary.",
    "",
    handoff,
  ].join("\n");
}

function buildSmartCompactionDetails(pending: PendingSmartCompactionState): Record<string, unknown> {
  return {
    source: "pi-smart-compact",
    tool: SMART_COMPACT_TOOL_NAME,
    smartCompactionId: pending.id,
    smart_compact: {
      id: pending.id,
      startedAt: pending.startedAt,
    },
  };
}

function isValidCompactionPreparation(preparation: SessionBeforeCompactEvent["preparation"] | undefined): preparation is SessionBeforeCompactEvent["preparation"] {
  return (
    typeof preparation?.firstKeptEntryId === "string" &&
    preparation.firstKeptEntryId.length > 0 &&
    typeof preparation.tokensBefore === "number" &&
    Number.isFinite(preparation.tokensBefore)
  );
}

function getSmartCompactionIdFromDetails(details: unknown): string | undefined {
  if (!isRecord(details)) {
    return undefined;
  }

  if (typeof details.smartCompactionId === "string") {
    return details.smartCompactionId;
  }

  const nested = details.smart_compact;
  if (isRecord(nested) && typeof nested.id === "string") {
    return nested.id;
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function monitorContextUsage(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  config: SmartBoundaryConfigStore,
  runtimeState: SmartCompactRuntimeState,
): Promise<void> {
  let usage;

  try {
    usage = ctx.getContextUsage();
  } catch (error) {
    notifyIfAvailable(ctx, `Smart compact monitoring could not read context usage: ${errorMessage(error)}`, "warning");
    return;
  }

  const tokens = usage?.tokens;
  if (tokens === null || tokens === undefined) {
    return;
  }

  let boundaryTokens: number;
  try {
    boundaryTokens = (await config.read()).tokens;
  } catch (error) {
    notifyIfAvailable(ctx, `Smart compact monitoring could not read boundary config: ${errorMessage(error)}`, "warning");
    return;
  }

  syncEscalationBoundary(runtimeState, boundaryTokens);
  const band = calculateEscalationBand({ tokens, boundaryTokens });
  if (!isHigherEscalationBand(band, runtimeState.highestEscalationBandSent)) {
    return;
  }

  const message = buildEscalationPrompt({ tokens, boundaryTokens, band });

  try {
    await Promise.resolve(pi.sendUserMessage(message, { deliverAs: "steer" }));
    markEscalationBandSent(runtimeState, band);
  } catch (error) {
    notifyIfAvailable(ctx, `Smart compact monitoring could not deliver steering warning: ${errorMessage(error)}`, "warning");
  }
}

function notifyIfAvailable(
  ctx: ExtensionContext,
  message: string,
  level: "info" | "warning" | "error" = "info",
): void {
  if (ctx.hasUI === false) {
    return;
  }

  try {
    ctx.ui?.notify?.(message, level);
  } catch {
    // Monitoring must never break future turns because notification delivery failed.
  }
}

function describeCurrentBoundary(tokens: number, isDefault: boolean, warning?: string): string {
  const prefix = isDefault ? "Current smart boundary is the default" : "Current smart boundary is";
  const message = `${prefix} ${formatTokens(tokens)}.`;
  return warning ? `${message}\nWarning: ${warning}` : message;
}

function formatTokens(tokens: number): string {
  return `${tokens.toLocaleString("en-US")} tokens`;
}

function notify(ctx: ExtensionCommandContext, message: string, level: "info" | "warning" | "error" = "info"): string | undefined {
  if (typeof ctx.ui?.notify === "function") {
    ctx.ui.notify(message, level);
    return undefined;
  }

  return message;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
