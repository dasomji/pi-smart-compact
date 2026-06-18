# Manual testing guide

Use this guide to verify `pi-smart-compact` in a real Pi session after the automated tests pass. The guide intentionally uses a deliberately low boundary so the full warning, handoff, compaction, and continuation path can be exercised without filling a real 100k-token context.

## Setup

Install the package from GitHub or from a local checkout:

```sh
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

- progress/current task state and where the current atomic task stopped;
- decisions made and important rationale;
- relevant files and saved artifacts;
- validation status, including tests or checks run and any not run;
- remaining risks or blockers;
- concrete next steps for the continuation.

## Main-agent scenario

1. Start a normal main-agent Pi session with the package enabled.
2. Run `/smart-boundary 100` or another deliberately low positive boundary.
3. Ask the agent to do a small multi-step task that creates enough conversation/tool output to cross the low boundary.
4. Verify a visible boundary warning/steering message appears. It should tell the agent to finish the current atomic task, save artifacts, write a handoff, and call `smart_compact` when ready.
5. Let the agent reach a natural stopping point. Verify the workflow: warning -> handoff -> `smart_compact` -> same-session compaction -> single continue.
6. After the automatic `continue`, verify the agent resumes in the same session using the handoff summary, rather than a replacement session.
7. Check that only one `continue` message is sent for that smart compaction.
8. Run `/smart-boundary reset` when done.

## Subagent scenario

1. Start a parent/main agent and ask it to launch or delegate work to a subagent in the usual Pi way.
2. Ensure the global boundary is low before the subagent does substantial work, for example `/smart-boundary 100`.
3. Give the subagent a small multi-step task that crosses the low boundary.
4. Verify the subagent receives the warning, finishes only the current atomic task, writes its handoff, and calls `smart_compact`.
5. Verify the subagent path also follows warning -> handoff -> `smart_compact` -> same-session compaction -> single continue.
6. Confirm the parent still tracks the same subagent run and receives the eventual result normally; no new replacement session should appear.
7. Reset the boundary with `/smart-boundary reset`.

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
