export const SMART_COMPACT_HANDOFF_ITEMS = [
  "Current task / atomic stopping point",
  "Progress completed",
  "Decisions / rationale",
  "Files and artifacts",
  "Validation",
  "Risks / blockers",
  "Next steps",
];

export const SMART_COMPACT_HANDOFF_GUIDANCE = [
  "progress/current task state and where the current atomic task stopped",
  "progress completed",
  "decisions made and important rationale",
  "relevant files and saved artifacts",
  "validation status, including tests or checks run and any not run",
  "remaining risks or blockers",
  "concrete next steps for the continuation",
].join("; ");

export const SMART_COMPACT_HANDOFF_TEMPLATE = SMART_COMPACT_HANDOFF_ITEMS.map((item) => `${item}:`).join("\n");

export const SMART_COMPACT_PROMPT_SNIPPET =
  "Call `smart_compact` with an agent-authored handoff when you reach a safe compaction boundary.";

export const SMART_COMPACT_PROMPT_GUIDELINES = [
  "Call `smart_compact` only after finishing the current atomic task/current unit and saving important files or artifacts.",
  "If you are in the middle of a short bounded check or file write that will materially improve the handoff, finish it first; do not start a new unit of work.",
  "For analysis/review/debug tasks with non-trivial findings, save a concise report or notes artifact when practical and include its path.",
  `Use this soft handoff template when helpful:\n${SMART_COMPACT_HANDOFF_TEMPLATE}`,
  "The `handoff` must cover progress/current task, stopping point, decisions/rationale, files/artifacts, validation, risks/blockers, and next steps.",
  "If `smart_compact` is unavailable in the current toolset, return a final handoff-style response with the same fields instead of attempting more work.",
  "Call `smart_compact` alone as the final action/only tool call for this mini-phase, then wait for continuation after compaction.",
];

export interface EscalationPromptInput {
  tokens: number;
  boundaryTokens: number;
  band: number;
}

export function buildManualSmartCompactRequestPrompt(): string {
  return [
    "Manual smart compaction requested by the user.",
    "Finish the current atomic task/current unit at a natural stopping point. If a short bounded check or file write will materially improve the handoff, complete it first; avoid major new work and do not start a new unit of work.",
    "Before compacting, save important artifacts or files. For substantial analysis/review/debug findings, save a concise report or notes artifact when practical.",
    "Write a concise handoff covering progress/current task state, stopping point, decisions, files/artifacts, validation, risks, and next steps.",
    `Soft handoff template when helpful:\n${SMART_COMPACT_HANDOFF_TEMPLATE}`,
    "When ready, call `smart_compact` with that handoff. Call `smart_compact` alone as the final action/only tool call for this mini-phase, then wait for continuation after compaction.",
    "If `smart_compact` is unavailable in this toolset, return a final handoff-style response with the same fields instead.",
  ].join("\n");
}

export function buildEscalationPrompt({ tokens, boundaryTokens, band }: EscalationPromptInput): string {
  const tokenContext = `Current estimated context usage is ${formatTokens(tokens)} tokens; the configured smart boundary is ${formatTokens(boundaryTokens)} tokens.`;

  if (band <= 0) {
    return [
      "Smart compaction boundary reached.",
      tokenContext,
      "Finish the current atomic task/current unit at a natural stopping point. If a short bounded check or file write will materially improve the handoff, complete it first; avoid major new work and do not start a new unit of work.",
      "Before compacting, save important artifacts or files. For substantial analysis/review/debug findings, save a concise report or notes artifact when practical.",
      "Write a concise handoff covering progress, stopping point, decisions, files/artifacts, validation, risks, and next steps.",
      `Soft handoff template when helpful:\n${SMART_COMPACT_HANDOFF_TEMPLATE}`,
      "When ready, call `smart_compact` with that handoff so the session can compact safely and continue. If `smart_compact` is unavailable in this toolset, return a final handoff-style response with the same fields instead.",
    ].join("\n");
  }

  if (band === 1) {
    return [
      "Smart compaction escalation: this is now urgent and should be a higher priority.",
      tokenContext,
      "Finish only the current atomic task/current unit; avoid major new work, future work, or another substantial step. Complete only a short bounded check/file write if it materially improves the handoff.",
      "Save important artifacts now, including a concise report/notes artifact for substantial analysis/review/debug findings when practical.",
      "Prepare the handoff and call `smart_compact` as soon as you reach the next safe stopping point.",
      "The handoff should preserve progress, stopping point, decisions, relevant files/artifacts, validation status, risks, and concrete next steps.",
      `Soft handoff template when helpful:\n${SMART_COMPACT_HANDOFF_TEMPLATE}`,
      "If `smart_compact` is unavailable in this toolset, return a final handoff-style response with the same fields instead.",
    ].join("\n");
  }

  return [
    `Smart compaction escalation level ${band + 1}: strong reminder to stop expanding scope now.`,
    tokenContext,
    "Complete the current atomic task/current unit only, avoid all major new work or next-major-step planning, and prioritize a safe handoff. Complete only a short bounded check/file write if it materially improves the handoff.",
    "Save artifacts, including a concise report/notes artifact for substantial analysis/review/debug findings when practical.",
    "Write the handoff with progress, stopping point, decisions, files/artifacts, validation, risks, and next steps, then call `smart_compact` when ready.",
    `Soft handoff template when helpful:\n${SMART_COMPACT_HANDOFF_TEMPLATE}`,
    "If `smart_compact` is unavailable in this toolset, return a final handoff-style response with the same fields instead.",
  ].join("\n");
}

function formatTokens(tokens: number): string {
  return tokens.toLocaleString("en-US");
}
