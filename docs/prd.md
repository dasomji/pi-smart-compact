# PRD: pi-smart-compact

## Problem Statement

Pi users often instruct agents and subagents to keep working through a multi-step plan until the work is complete. Native compaction happens only when context pressure is high enough for pi to summarize automatically, and waiting until the agent becomes idle is too late for long-running agent loops: the agent may never intentionally stop between tasks, or it may continue into substantial new work with an unhealthy context window.

The user needs a cooperative context-boundary mechanism that nudges the active agent before context becomes dangerous, lets the agent choose a safe stopping point, has the agent preserve important state in its own words, and then resumes work without human interaction. This must work for main agents and subagents without creating replacement sessions that confuse parent/subagent run identity.

## Solution

Build a pi extension named `pi-smart-compact` that monitors context usage and sends increasingly firm steering messages once a configurable smart boundary is crossed. The default boundary is 100k tokens. Every additional 20k tokens sends a more demanding reminder, similar to a parent progressively telling children to stop playing and go to bed: first instructional, then increasingly firm, but never an arbitrary hard cutoff.

The extension gives the agent a `smart_compact` tool. When the agent reaches a natural boundary, it saves any important artifacts, writes a handoff for itself, and calls `smart_compact` with that handoff. The extension then uses the handoff as the compaction summary through pi's compaction hook and automatically sends a continuation prompt after compaction completes.

The extension also provides a `/smart-boundary` command to set the global smart boundary. Native pi auto-compaction remains untouched as the underlying safety behavior; this extension does not force compaction on its own.

## User Stories

1. As a pi user, I want the agent warned before context becomes unhealthy, so that long-running work does not drift into context overflow.
2. As a pi user, I want the default smart boundary to be 100k tokens, so that the extension works sensibly without setup.
3. As a pi user, I want to configure the smart boundary globally, so that my preferred threshold applies across main agents and subagents.
4. As a pi user, I want `/smart-boundary` to show the current boundary, so that I can verify the active setting quickly.
5. As a pi user, I want `/smart-boundary` to accept token values like `100k` or `120000`, so that the command is convenient to use.
6. As a pi user, I want `/smart-boundary reset`, so that I can return to the default behavior easily.
7. As a pi user, I want the first warning to be instructional, so that the agent understands it should look for a natural stopping point rather than panic.
8. As a pi user, I want later warnings to become firmer every 20k tokens, so that the agent increasingly prioritizes wrapping up.
9. As a pi user, I want the extension to steer the agent after the current turn rather than wait for full idle, so that it works while the agent is executing a multi-step plan.
10. As a pi user, I want the agent to decide when the current atomic task is complete, so that the compaction boundary does not interrupt fragile edits or partial reasoning.
11. As a pi user, I want the agent to save important state as artifacts before compacting, so that valuable work is not only preserved in volatile conversation context.
12. As a pi user, I want the agent to write its own handoff, so that the summary reflects what the agent believes is necessary to continue.
13. As a pi user, I want the handoff passed into a tool instead of inferred from a temporary file, so that the flow is explicit and reliable.
14. As a pi user, I want `smart_compact` to be treated as a terminal tool call for the current mini-phase, so that the agent does not continue acting while compaction is underway.
15. As a pi user, I want the handoff to become the compaction summary, so that the post-compaction context starts from the agent-authored continuation state.
16. As a pi user, I want the extension to automatically send `continue` after compaction, so that the agent resumes without requiring me to intervene.
17. As a pi user, I want same-session compaction, so that subagent run identity and parent orchestration are preserved.
18. As a pi user, I want no automatic new session creation, so that subagent tracking is not confused by replacement sessions.
19. As a pi user, I want native pi auto-compaction left alone, so that existing pi safety behavior still works if the agent ignores the smart boundary.
20. As a pi user, I do not want the extension to impose a hard cutoff, so that the agent can choose a coherent stopping point.
21. As a pi user, I want repeated warnings to avoid spamming at every turn within the same threshold band, so that the agent is nudged without noise.
22. As a pi user, I want warnings to be visible in the conversation, so that the agent treats them as real steering input.
23. As a pi user, I want the extension to work in main agent sessions, so that normal long-running tasks benefit from it.
24. As a pi user, I want the extension to work in subagent sessions, so that delegated workers also preserve their context intelligently.
25. As a subagent, I want clear instructions for when to call `smart_compact`, so that I can wrap up safely without asking the parent for permission.
26. As a parent agent, I want a subagent to remain in the same run after compaction, so that I can still receive its eventual result normally.
27. As an agent, I want escalation messages that distinguish current atomic task from future work, so that I know to finish the current unit but avoid starting another major step.
28. As an agent, I want the `smart_compact` tool description to specify the handoff shape, so that I include progress, decisions, files, artifacts, risks, and next steps.
29. As an agent, I want `smart_compact` to report that compaction has started, so that I understand no further action is required until continuation.
30. As an extension user, I want notifications or status updates when smart compaction starts and completes, so that I can trust the automation.
31. As an extension user, I want the global setting to survive pi restarts, so that I do not have to reconfigure it each time.
32. As an extension user, I want invalid `/smart-boundary` values rejected with helpful messages, so that configuration mistakes are obvious.
33. As an extension user, I want the extension to avoid duplicate continuation prompts, so that the agent does not receive multiple `continue` messages after one compaction.
34. As an extension user, I want pending handoff state cleared after compaction, so that future native compactions do not reuse stale handoff content.
35. As an extension user, I want manual or native compaction without a pending smart handoff to behave normally, so that the extension does not break existing pi workflows.
36. As an extension maintainer, I want the behavior implemented using public pi extension APIs, so that it remains compatible with pi upgrades.
37. As an extension maintainer, I want escalation state reconstructed or reset safely on session start, so that reloads do not cause confusing repeated prompts.
38. As an extension maintainer, I want tests around threshold crossing, so that boundary behavior is predictable.
39. As an extension maintainer, I want tests around compaction hook behavior, so that only pending smart handoffs override compaction summaries.
40. As an extension maintainer, I want tests around command parsing and persistence, so that global configuration remains dependable.

## Implementation Decisions

- The project will be distributed as a pi package containing a TypeScript extension.
- The extension will rely on pi's public extension APIs for lifecycle hooks, commands, custom tools, context usage, steering messages, and compaction customization.
- The extension will register a `/smart-boundary` command that reads and writes a global user-level boundary setting.
- The default smart boundary will be 100,000 tokens.
- Escalation intervals will be 20,000 tokens above the configured boundary.
- The extension will monitor context usage after turns complete, because pi exposes current context usage from extension contexts and steering messages are delivered between turns while the agent is still active.
- The extension will send real user steering messages rather than hidden custom messages, because the agent must treat the boundary warning as an instruction that can influence its next action.
- Escalation prompts will become progressively more forceful while preserving the central rule: finish the current atomic task, save important state, write a handoff, and call `smart_compact`.
- The extension will track the highest escalation band already sent for the current session context to avoid repeating the same message every turn.
- The extension will register a `smart_compact` tool that accepts handoff content from the agent.
- The `smart_compact` tool will store the handoff as pending smart-compaction state before triggering compaction.
- The compaction hook will use the pending handoff as the compaction summary and will let ordinary pi compaction proceed unchanged when no pending handoff exists.
- The handoff summary will include a marker or metadata indicating that it came from `smart_compact`, so future debugging can distinguish agent-authored summaries from native summaries.
- After smart compaction completes, the extension will clear pending handoff state and send a continuation message automatically.
- The continuation message will be minimal by default, such as `continue`, because the handoff summary already carries the resumed context.
- The extension will not create a new session as part of the default flow.
- The extension will not force compaction merely because multiple escalation bands have been crossed.
- Native pi auto-compaction will remain enabled and unmodified unless the user independently changes pi settings.
- The extension will treat `smart_compact` as a terminal operation from the agent's perspective; once called, the agent should wait for compaction and continuation rather than continue performing work in the same tool batch.
- The extension will prefer global user configuration for the smart boundary because the user wants the setting to apply across agents and subagents.
- Project-specific configuration is out of scope for the first version, though the design should not prevent it later.
- The handoff prompt guidance will emphasize artifacts, current task state, decisions, changed files conceptually, validation status, risks, and next steps.
- The extension should remain usable in interactive and non-interactive pi modes where the relevant APIs are available, but user-facing notifications may be no-ops outside UI-capable modes.

## Testing Decisions

- Tests should focus on external behavior: what messages are sent, what command settings are persisted, when the tool triggers compaction, and when compaction summaries are overridden.
- Tests should avoid asserting private implementation details such as exact internal variable names or timer structure.
- The highest-value seam is the extension API boundary: simulate pi lifecycle events and assert calls to context usage, steering messages, compaction, and compaction hook results.
- Command parsing should be tested at the command-handler seam with values such as empty input, `100k`, `120000`, invalid text, negative numbers, and `reset`.
- Escalation behavior should be tested with context usage sequences that remain below the boundary, cross the initial boundary, cross multiple 20k bands, and reload after messages have already been sent.
- Steering behavior should be tested by asserting that the extension sends user messages with steering delivery while the agent is active.
- Compaction behavior should be tested by calling `smart_compact` and then invoking the compaction hook to verify that the handoff becomes the summary.
- Native compaction compatibility should be tested by invoking the compaction hook without pending handoff state and asserting that it does not override the default behavior.
- Completion behavior should be tested by simulating compaction completion and asserting that pending state is cleared and a single continuation message is sent.
- Subagent compatibility should be tested at the package/runtime level by ensuring the extension behavior does not require new-session APIs and does not rely on parent-only orchestration state.
- Persistence behavior should be tested by setting the global boundary, reloading extension state, and verifying the configured value is reused.
- Good tests will model pi's event flow at a high level rather than invoking provider APIs or real LLM calls.
- Manual exploratory testing should run the extension in a pi session with an artificially low boundary to verify escalation, tool use, compaction, and continuation without needing a real 100k-token session.

## Out of Scope

- Creating replacement sessions as part of smart compaction.
- Forcing compaction after a fixed maximum number of warnings.
- Disabling or replacing pi's native auto-compaction behavior.
- Invoking the existing handoff skill and scraping a temporary handoff file.
- Building a full custom summarizer model pipeline for the first version.
- Project-specific smart-boundary settings.
- Per-agent or per-subagent boundary overrides.
- A graphical configuration UI beyond the slash command.
- Guaranteeing that an agent will obey the escalation prompts before native pi compaction becomes necessary.
- Changing pi core behavior.

## Further Notes

The core product decision is cooperative compaction rather than forced compaction. The extension should behave like an increasingly firm reminder, not an execution interrupt. This preserves agent judgment and lets the active agent create the most useful handoff at a coherent boundary.

The design intentionally keeps work in the same session. This is especially important for subagents, where creating a new session could make the parent agent lose track of the child run or receive an unexpected result shape.

The extension should be developed against pi's documented extension surfaces: context usage, steering user messages, custom tools, compaction hooks, compaction completion events, and global package configuration.
