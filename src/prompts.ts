export const SMART_COMPACT_HANDOFF_GUIDANCE = [
  "progress/current task state and where the current atomic task stopped",
  "decisions made and important rationale",
  "relevant files and saved artifacts",
  "validation status, including tests or checks run and any not run",
  "remaining risks or blockers",
  "concrete next steps for the continuation",
].join("; ");

export const SMART_COMPACT_PROMPT_SNIPPET =
  "Call `smart_compact` with an agent-authored handoff when you reach a safe compaction boundary.";

export const SMART_COMPACT_PROMPT_GUIDELINES = [
  "Call `smart_compact` only after finishing the current atomic task/current unit and saving important files or artifacts.",
  "The `handoff` must cover progress/current task, decisions, files/artifacts, validation, risks/blockers, and next steps.",
  "Call `smart_compact` alone as the final action/only tool call for this mini-phase, then wait for continuation after compaction.",
];

export interface EscalationPromptInput {
  tokens: number;
  boundaryTokens: number;
  band: number;
}

export function buildEscalationPrompt({ tokens, boundaryTokens, band }: EscalationPromptInput): string {
  const tokenContext = `Current estimated context usage is ${formatTokens(tokens)} tokens; the configured smart boundary is ${formatTokens(boundaryTokens)} tokens.`;

  if (band <= 0) {
    return [
      "Smart compaction boundary reached.",
      tokenContext,
      "Finish the current atomic task/current unit at a natural stopping point, but avoid starting major new work or the next major step.",
      "Before compacting, save important artifacts or files, then write a concise handoff covering progress, decisions, validation, risks, and next steps.",
      "When ready, call `smart_compact` with that handoff so the session can compact safely and continue.",
    ].join("\n");
  }

  if (band === 1) {
    return [
      "Smart compaction escalation: this is now urgent and should be a higher priority.",
      tokenContext,
      "Finish only the current atomic task/current unit; avoid major new work, future work, or another substantial step.",
      "Save important artifacts now, prepare the handoff, and call `smart_compact` as soon as you reach the next safe stopping point.",
      "The handoff should preserve progress, decisions, relevant files/artifacts, validation status, risks, and concrete next steps.",
    ].join("\n");
  }

  return [
    `Smart compaction escalation level ${band + 1}: strong reminder to stop expanding scope now.`,
    tokenContext,
    "Complete the current atomic task/current unit only, avoid all major new work or next-major-step planning, and prioritize a safe handoff.",
    "Save artifacts, write the handoff with progress, decisions, files/artifacts, validation, risks, and next steps, then call `smart_compact` when ready.",
  ].join("\n");
}

function formatTokens(tokens: number): string {
  return tokens.toLocaleString("en-US");
}
