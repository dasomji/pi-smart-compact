# pi-smart-compact

A planned [pi](https://pi.dev) extension for cooperative, handoff-driven compaction before context windows become unhealthy.

`pi-smart-compact` is designed for long-running agents and subagents that keep working through multi-step plans. Instead of imposing a hard cutoff, it nudges the active agent at configurable context boundaries, asks it to finish the current atomic task, save important state, write its own handoff, and call a `smart_compact` tool. The handoff is then used as the compaction summary and the agent is automatically told to continue.

> Status: PRD-stage. The product requirements are captured in [`docs/prd.md`](docs/prd.md); implementation has not started yet.

## Intended behavior

- Default smart boundary: `100k` tokens.
- Configurable global boundary via `/smart-boundary`.
- Escalation every `20k` tokens after the boundary.
- Steering messages become progressively firmer, but never force a cutoff.
- The agent decides when its current atomic task is safe to stop.
- The agent calls `smart_compact` with a self-authored handoff.
- The extension injects that handoff as the compaction summary.
- After compaction, the extension automatically sends `continue`.
- Same-session behavior preserves main-agent and subagent run identity.
- Native pi auto-compaction remains untouched as the underlying safety net.

## Why

Native compaction is useful, but long-running agents may never become idle at a convenient point. A hard cutoff can interrupt fragile work; a purely idle-based flow is too late. This extension explores a cooperative model: warn early, escalate gradually, and let the agent choose a coherent handoff boundary.

## Planned package shape

```text
pi-smart-compact/
├── docs/
│   └── prd.md
├── extensions/
│   └── smart-compact.ts
├── package.json
├── LICENSE
└── README.md
```

## Planned pi APIs

The implementation is expected to use public pi extension surfaces:

- `ctx.getContextUsage()` for token usage.
- `turn_end` for threshold checks.
- `pi.sendUserMessage(..., { deliverAs: "steer" })` for escalation prompts.
- `pi.registerCommand("smart-boundary", ...)` for global configuration.
- `pi.registerTool({ name: "smart_compact", ... })` for agent-authored handoff submission.
- `ctx.compact()` to trigger compaction.
- `session_before_compact` to provide the handoff as the compaction summary.
- `session_compact` to clear pending state and continue.

## License

MIT © Daniel
