# pi-smart-compact usage analysis — 2026-06-21

## Scope and method

I analyzed local Pi session logs for `pi-smart-compact` usage across:

- `~/.pi/agent/sessions/**.jsonl`
- `~/.pi/agent.backup.20260527-112015/sessions/**.jsonl`

Search terms included `smart_compact`, `pi-smart-compact`, `Smart compaction boundary reached`, smart-compaction compaction summaries, and smart-compaction metadata. The scan covered 1,121 JSONL files. It found smart-compaction-relevant events in five project session groups:

- `Harnesssssing-Agent`
- `Harnesssssing`
- `me-tracker`
- `audionautiq-web`
- `pi-footer`

This report focuses on actual runtime behavior, handoff quality, subagent behavior, and whether the current prompts appear to push agents too early.

## Executive summary

`pi-smart-compact` is working well for main agents: boundary warnings are delivered, agents usually respond quickly, the tool produces same-session compaction summaries with metadata, and the resulting handoffs are generally useful enough to continue work. The handoffs are often quite strong: they include current task, progress, files/artifacts, validation, risks, and next steps.

The biggest issue is subagent tool availability. Smart-compaction boundary messages reached subagents, but some subagents did not have the `smart_compact` tool. In those cases they produced a manual final answer/handoff instead of calling the tool. A smaller number of subagents did have and use the tool successfully. So the extension is not uniformly available across child runs.

I do **not** see strong evidence that the prompt is generally pushing main agents too hard. Most main-agent compactions occurred after an atomic unit had completed or after a durable artifact/report/progress ledger was written. However, a few cases show the agent compacting in the middle of an unresolved investigation, with a good handoff but no artifact beyond the handoff itself. This is acceptable for safety, but the prompt could better emphasize: “if you are in a short diagnostic loop, finish the current hypothesis check first and save a note/report if useful.”

## Quantitative findings

From the scan:

| Event type | Total | Main sessions | Subagent sessions |
|---|---:|---:|---:|
| Smart boundary warnings | 23 | 16 | 7 |
| `smart_compact` tool calls | 17 | 15 | 2 |
| Smart compaction summaries written by hook | 17 | 15 | 2 |
| Explicit signs `smart_compact` unavailable | at least 4 real subagent cases | 0 real main cases | 4 |

Notes:

- The raw text search produced additional false-positive “unavailable” hits because later sessions quoted previous logs; the meaningful evidence is in child final answers stating `smart_compact tool is not available in this child toolset`.
- All observed successful tool calls produced matching compaction entries with `details.source = "pi-smart-compact"` and `fromHook = true`.
- I found no smart-compaction escalation-band messages. All observed warnings were first-band boundary warnings around 100k tokens.

## Main-agent behavior

Main agents usually compacted immediately after the boundary warning or after a small amount of finishing work. Examples:

- `Harnesssssing-Agent`, line 367 warning → line 368 `smart_compact` → line 369 compaction. Handoff: 2,558 chars, 373 words.
- `Harnesssssing`, line 219 warning → line 220 `smart_compact` → line 221 compaction. Handoff: 3,871 chars, 559 words.
- `audionautiq-web`, line 36 warning → line 37 `smart_compact` → line 38 compaction. Handoff: 4,646 chars, 680 words.
- `me-tracker`, multiple orchestrated TDD sessions: handoffs ranged from ~4,258 to ~9,827 chars and preserved progress-ledger state, subagent results, test status, and next steps.
- `pi-footer`, several debug sessions: one warning allowed additional diagnostic work before compacting, which appears appropriate because the agent was validating a hypothesis before stopping.

There was one warning in `me-tracker` (`2026-06-20T22:34:20Z`) with no later `smart_compact` in the same file. This may mean the user/session ended or a later native flow took over. It is worth watching, but it is not enough evidence of systemic failure.

## Handoff quality

Successful handoffs were mostly strong. Automated category checks over 17 smart-compaction summaries found:

- Current task present: 16/17
- Progress present: 16/17
- Decisions/rationale present: 14/17
- Files/artifacts present: 17/17
- Validation present: 17/17
- Risks/blockers present: 16/17
- Next steps present: 17/17

The strongest handoffs were in orchestrated work. They named:

- Current plan or unit
- Progress ledger path
- Subagent roles and results
- Changed files
- Tests and commands run
- Acceptance status
- Residual risks
- Exact next step for continuation

Examples of good durable artifacts referenced:

- `docs/plans/2026-06-12-001-track-studio-habit-day-retroactive-editing-progress.md`
- `docs/plans/2026-06-21-pr19-orchestration-retrospective.md`
- `/tmp/me-tracker-unit5-evidence/*`
- package/docs files in `pi-footer` and `pi-smart-compact`

Weaknesses in a few handoffs:

1. Some handoffs were very detailed but relied on the compaction summary as the only durable artifact.
2. Two or three handoffs did not clearly label decisions/rationale, even though enough state was present to continue.
3. One debug handoff had weak “progress” language because it focused on current state and hypotheses rather than what had been conclusively completed.
4. Some handoffs referenced local temp artifacts without saying whether they should be considered disposable or copied into the repo.

Overall, the handoff content is good. The gap is less “agents omit crucial information” and more “agents do not always write a repo-local artifact when the task is analysis/planning/debugging.”

## Subagent behavior

Subagent behavior is mixed.

### Successful subagent smart compaction

I found two subagent sessions that successfully called `smart_compact` and produced smart compaction summaries:

- `me-tracker/.../4c2ba1c2/run-0/session.jsonl`, line 59 warning → line 60 tool call → line 61 compaction. The handoff was excellent: 11,093 chars / 1,581 words, with task, progress, files, validation, risks, and next steps.
- `audionautiq-web/.../a1325d3a/run-0/session.jsonl`, line 56 warning → line 57 tool call → line 58 compaction. The handoff was also excellent: 12,047 chars / 1,800 words.

This proves same-session smart compaction can work inside subagents when the tool is available.

### Subagents where warning arrived but tool was unavailable

At least three `me-tracker` child sessions and some quoted reports show the warning reached child sessions, but the final output said the tool was unavailable. Example child final text included:

> `smart_compact tool is not available in this child toolset.`

Those subagents still returned useful final answers with acceptance reports. For example, a verifier child completed Unit 5 verification and listed:

- PASS result
- Requirements checked
- Commands run
- Evidence artifacts
- Skipped gates
- Residual risks
- Acceptance report JSON

So work was not lost, but these subagents were not able to compact in the intended same-session way.

### Interpretation

This is likely not a `pi-smart-compact` runtime bug. It looks like a subagent configuration / tool inheritance issue:

- Boundary steering can reach child sessions.
- The tool itself may be absent depending on child tool/extension allowlists.
- Some child runs include `smart_compact`; others do not.

## Are agents being pushed too hard?

Mostly no.

The current wording says:

> Finish the current atomic task/current unit at a natural stopping point, but avoid starting major new work or the next major step.

Observed behavior aligns with that in most main sessions. Agents did not usually drop everything instantly; they compacted after a natural boundary, often after writing or updating an artifact.

Where it may be too strong:

- When the boundary arrives during a short diagnostic loop, the agent may compact before completing the immediate hypothesis check if it interprets “urgent” too literally.
- In one current-task handoff, the agent explicitly wrote that it was “in the middle of a task” and compacted after only reading/assessing files, with edits still pending. The handoff was good, but a tiny additional artifact or completing one more bounded inspection would have improved continuity.
- In some subagents, if `smart_compact` is unavailable, the instruction to call it creates minor confusion. They recover by returning a normal final answer, but the prompt should anticipate unavailable tool surfaces.

Recommended adjustment: keep the instruction cooperative, but add a sentence that defines “current atomic task” more concretely:

> If you are in the middle of a short tool-driven check or file write that will make the handoff substantially safer, finish that bounded check/write first; do not begin a new unit of work.

## Are agents writing enough artifacts?

For implementation/orchestration work: yes. The best sessions maintained progress ledgers, evidence directories, or report files before compacting.

For pure analysis/debug sessions: mixed. Some wrote durable reports; some only put the analysis into the handoff. This is not always wrong, but for longer research or review tasks a repo-local or temp-file artifact improves continuity and makes the handoff less load-bearing.

Suggested policy:

- If the current task is implementation: ensure changed files/tests/evidence are saved before compacting.
- If the current task is analysis/review/debugging and findings exceed a few paragraphs: write a markdown report or notes artifact before compacting.
- If writing a repo-local artifact would be inappropriate, write to `/tmp` and mention the path and durability caveat in the handoff.

## Recommendations

### 1. Keep the core behavior

Do not radically change `pi-smart-compact`. The observed same-session compaction flow works and handoffs are usually high quality.

### 2. Improve subagent tool availability

Audit pi-subagents / agent configs so `smart_compact` is available to child agents where same-session continuation matters. In particular:

- Ensure `smart_compact` is included when subagent tool allowlists are used.
- Ensure the smart-compact extension is not excluded by child `extensions` settings.
- Add a small smoke test or diagnostic subagent that reports whether it sees `smart_compact`.
- Consider whether read-only reviewer/verifier agents should receive `smart_compact`; I think yes, because compacting is not domain mutation and preserves long review sessions.

### 3. Make unavailable-tool behavior explicit in the prompt

Add to prompt guidance:

> If `smart_compact` is unavailable in this toolset, return a final handoff-style response with the same fields instead of attempting more work.

This matches how subagents already recovered and reduces confusion.

### 4. Strengthen artifact guidance slightly

Current guidance says “save important artifacts or files.” That is good but broad. Add a more operational version:

> For analysis/review/debug tasks with non-trivial findings, save a short report or notes artifact before compacting when practical, and include its path in the handoff.

### 5. Keep the boundary at 100k for now

Observed handoffs happened around 100k–115k tokens. I saw no escalation-band usage and no strong evidence that 100k is too early. The boundary gives enough room for agents to finish a small unit and hand off safely.

### 6. Consider structured handoff fields later, but not urgently

The freeform `handoff` works surprisingly well. A structured schema could improve consistency, but it may also make the tool more cumbersome. A softer improvement would be to include a template in the prompt/tool description rather than changing the schema.

Example template:

```md
Current task / atomic stopping point:
Progress completed:
Decisions / rationale:
Files and artifacts:
Validation:
Risks / blockers:
Next steps:
```

## Suggested prompt changes

Current prompt guidance in `src/prompts.ts` is broadly good. I would adjust it like this:

```ts
export const SMART_COMPACT_PROMPT_GUIDELINES = [
  "Call `smart_compact` only after finishing the current atomic task/current unit and saving important files or artifacts.",
  "If you are in the middle of a short bounded check or file write that will materially improve the handoff, finish that check/write first; do not start a new unit of work.",
  "For analysis/review/debug tasks with non-trivial findings, save a concise report or notes artifact when practical and include its path.",
  "The `handoff` must cover current task/stopping point, progress, decisions/rationale, files/artifacts, validation, risks/blockers, and next steps.",
  "If `smart_compact` is unavailable in the current toolset, return a final handoff-style response with the same fields.",
  "Call `smart_compact` alone as the final action/only tool call for this mini-phase, then wait for continuation after compaction.",
];
```

And update the boundary warning wording similarly:

```text
Finish the current atomic task/current unit at a natural stopping point. If a short bounded check or file write will materially improve the handoff, complete it first; do not start a new unit of work.
Before compacting, save important artifacts or files. For substantial analysis/debug findings, save a concise report or notes artifact when practical.
```

## Bottom line

Do change a little, but not much.

- The extension is doing its core job.
- Main-agent handoffs are good enough and often excellent.
- Subagent availability is the main operational gap.
- Artifact guidance should be made slightly more concrete, especially for analysis/debug tasks.
- The current “finish the atomic task” instruction is mostly right; clarify it rather than making it stricter or looser.
