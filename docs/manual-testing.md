# Manual testing guide

Use this guide to verify `pi-smart-compact` in a real Pi session after the automated tests pass. The guide intentionally uses a deliberately low boundary so the full warning, handoff, compaction, and continuation path can be exercised without filling a real 100k-token context.

## Setup

Install the package from npm, GitHub, or from a local checkout:

```sh
pi install npm:@wienerberliner/pi-smart-compact
pi install https://github.com/dasomji/pi-smart-compact.git
pi install ../pi-smart-compact
```

Confirm and adjust the public command:

```text
/smart-boundary
```

Show the current boundary.

```text
/smart-boundary 100k
/smart-boundary 120000
/smart-boundary reset
```

Standard set/reset examples.

For manual testing, set an artificial low boundary such as:

```text
/smart-boundary 100
```

Reset when finished:

```text
/smart-boundary reset
```

## What to verify

The public names are `/smart-boundary` for user configuration and `smart_compact` for the agent-authored handoff tool.

A valid `smart_compact` handoff should include:

- current task / atomic stopping point;
- progress completed;
- decisions made and important rationale;
- relevant files and saved artifacts;
- validation status, including tests or checks run and any not run;
- remaining risks or blockers;
- concrete next steps for the continuation.

Soft handoff template:

```md
Current task / atomic stopping point:
Progress completed:
Decisions / rationale:
Files and artifacts:
Validation:
Risks / blockers:
Next steps:
```

For substantial analysis, review, or debugging findings, verify the agent saves a concise report or notes artifact when practical and includes its path in the handoff. If `smart_compact` is unavailable in the active toolset, the expected fallback is a final handoff-style response with the same fields.

## Subagent tool-access checks

Subagents can use smart compaction only if `smart_compact` is available in that child agent's toolset. A child may still receive the boundary warning even when it cannot call the tool.

Before testing or relying on long-running subagent smart compaction:

1. From the parent/orchestrator, inspect subagent discovery and the target agent details, for example with `subagent({ action: "list" })` and `subagent({ action: "get", agent: "worker" })` or the relevant runtime agent name.
2. Check whether the child has an explicit `tools` allowlist. If it does, confirm `smart_compact` is included.
3. For custom agents or overrides with explicit tools, configure the tools list to include `smart_compact`, for example `tools: read, grep, find, ls, bash, smart_compact`.
4. Run the low-boundary subagent scenario below and verify the child can actually call `smart_compact`. If the child cannot call it, verify it returns the fallback handoff-style final response instead.

Child-agent self-check: at a boundary, use `smart_compact` if it appears in the available tools. If it is absent, stop after the current atomic unit and return the same handoff fields in the final response.

## Main-agent scenario

1. Start a normal main-agent Pi session with the package enabled.
2. Run `/smart-boundary 100` or another deliberately low positive boundary.
3. Ask the agent to do a small multi-step task that creates enough conversation/tool output to cross the low boundary.
4. Verify a visible boundary warning/steering message appears. It should tell the agent to finish the current atomic task, optionally complete only a short bounded check or file write that materially improves the handoff, save artifacts, write a handoff, and call `smart_compact` when ready.
5. Let the agent reach a natural stopping point. Verify the workflow: warning -> handoff -> `smart_compact` -> same-session compaction -> single continue.
6. After the automatic `continue`, verify the agent resumes in the same session using the handoff summary, rather than a replacement session.
7. Check that only one `continue` message is sent for that smart compaction.
8. Run `/smart-boundary reset` when done.

## Subagent scenario

1. Start a parent/main agent and ask it to launch or delegate work to a subagent in the usual Pi way.
2. Ensure the global boundary is low before the subagent does substantial work, for example `/smart-boundary 100`.
3. Confirm the selected subagent has `smart_compact` in its toolset, especially if it has an explicit `tools` allowlist.
4. Give the subagent a small multi-step task that crosses the low boundary.
5. Verify the subagent receives the warning, finishes only the current atomic task, writes its handoff, and calls `smart_compact`. If the subagent toolset lacks `smart_compact`, verify it returns a final handoff-style response with the same fields instead.
6. Verify the subagent path also follows warning -> handoff -> `smart_compact` -> same-session compaction -> single continue.
7. Confirm the parent still tracks the same subagent run and receives the eventual result normally; no new replacement session should appear.
8. Reset the boundary with `/smart-boundary reset`.

## Failure, cancel, and manual/native compaction scenario

Use one of these safe ways to observe failure/cancel behavior: cancel compaction from the UI if available, simulate a provider/runtime compaction error in a development environment, or interrupt only a disposable test session.

Expected behavior:

- If `smart_compact` cannot start, fails, or is cancelled, no automatic `continue` should be sent.
- The pending stale handoff should be cleared/expired and not reused.
- A later manual/native compaction or native compaction should proceed normally and must not use the stale handoff as its summary.
- The agent or user may retry explicitly by calling `smart_compact` again with a fresh handoff after the failure/cancel path is understood.
- Manual compaction and native Pi auto-compaction without a pending smart handoff should remain unchanged.

## Limitations to check and explain

- The extension does not force compaction; it only warns and escalates cooperatively.
- Agent compliance is cooperative and not guaranteed; an agent may ignore warnings until native Pi compaction happens.
- Native pi auto-compaction remains unchanged and independent.
- There are no project-specific settings or per-agent/subagent boundary overrides in this version.
- Same-session behavior is required; replacement sessions are intentionally out of scope.
