# pi-smart-compact

`pi-smart-compact` is a [pi](https://pi.dev) package that adds cooperative, handoff-driven compaction for long-running main agents and subagents.

Instead of imposing a hard cutoff, the extension watches context usage, sends visible boundary warnings, asks the active agent to finish the current atomic task, save important state, write its own handoff, and call the `smart_compact` tool. That handoff becomes the same-session compaction summary, then the extension sends one automatic `continue` so work resumes without creating a replacement session.

> Status: development package with the core extension behavior implemented and covered by mocked Pi API tests. Manual verification in a real Pi session should follow [`docs/manual-testing.md`](docs/manual-testing.md) before publishing.

## Installation

Install from GitHub:

```sh
pi install https://github.com/dasomji/pi-smart-compact.git
```

Install from a local checkout while developing:

```sh
pi install ../pi-smart-compact
# or
pi install /absolute/path/to/pi-smart-compact
```

## Configure `/smart-boundary`

The default smart boundary is `100k` tokens (`100,000`). Warnings escalate every additional `20k` tokens. The setting is global for this package and applies to main agents and subagents.

```text
/smart-boundary
```

Show the current boundary.

```text
/smart-boundary 100k
/smart-boundary 120000
```

Set the boundary using `k` shorthand or a plain positive whole-number token count. Deliberately low positive values are accepted for manual testing.

```text
/smart-boundary reset
```

Reset to the default `100k` boundary.

## Agent workflow

When usage crosses the configured boundary, pi-smart-compact sends a visible steering warning. Later warnings become firmer at each `20k` escalation band, but the extension still does not force compaction.

Expected flow: warning -> handoff -> `smart_compact` -> same-session compaction -> `continue`.

The agent should finish the current atomic task/current unit at a safe stopping point, avoid starting major new work, save important files or artifacts, and then call `smart_compact` alone as the final tool call for that mini-phase. If a short bounded check or file write would materially improve the handoff, the agent may finish that check first; it should not start a new unit of work.

For substantial analysis, review, or debugging findings, the agent should save a concise report or notes artifact when practical and include its path in the handoff.

The `smart_compact` handoff should include:

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

If `smart_compact` is unavailable in the active toolset, the agent should return a final handoff-style response with the same fields instead of trying to continue expanding the task.

After `smart_compact` starts compaction, the pending handoff is used by the `session_before_compact` hook as the compaction summary. When the matching `session_compact` event completes, the pending handoff is cleared and exactly one `continue` user message is sent in the same session.

## Subagent tool access

Subagents can use smart compaction only when `smart_compact` is present in that child agent's toolset. Boundary warnings may still reach a child that cannot call the tool; in that case the child should use the fallback above and return a final handoff-style response.

Before relying on smart compaction for a long-running subagent, the parent/orchestrating agent should check the selected child agent configuration:

1. Inspect available subagents and the target agent details with the subagent management surface, for example `subagent({ action: "list" })` followed by `subagent({ action: "get", agent: "worker" })` or the relevant runtime agent name.
2. Look for an explicit `tools` allowlist. If the child has one, it must include `smart_compact` for same-session smart compaction to work.
3. For persistent custom agents, add `smart_compact` to the agent file or override, for example `tools: read, grep, find, ls, bash, smart_compact`. With subagent management actions, use a matching tools string such as `"read,grep,find,ls,bash,smart_compact"`.
4. For important long-running workflows, run a low-boundary smoke test and confirm the child can actually call `smart_compact`, not just receive the warning.

Child agents can also self-check at a boundary: if `smart_compact` appears in their available tools, they should call it after the safe stopping point; if it is absent, they should produce the handoff-style final response instead.

## Failure, cancel, and native compaction behavior

If smart compaction fails to start, errors, is cancelled, or cannot safely customize the summary, the pending stale handoff is cleared/expired. A later manual/native compaction is not overridden by that stale handoff, no automatic `continue` is sent for the failed flow, and the agent or user may retry explicitly by calling `smart_compact` again with a fresh handoff.

Manual or native Pi compaction without a pending smart handoff behaves normally. Native pi auto-compaction remains unchanged and independent as the underlying safety net.

## Limitations

- pi-smart-compact is cooperative and does not force compaction; agent compliance is not guaranteed.
- There are no project-specific, per-agent, or per-subagent boundary settings yet.
- Native pi auto-compaction remains unchanged and independent.
- The extension preserves same-session behavior and intentionally does not create replacement sessions.
- `smart_compact` is designed as a terminal mini-phase tool call, but a multi-tool batch may still depend on Pi runtime termination semantics.

## Development

```sh
npm test
npx tsc --noEmit
```

See [`docs/prd.md`](docs/prd.md) for product requirements and [`docs/manual-testing.md`](docs/manual-testing.md) for manual verification.

## License

MIT © Daniel
