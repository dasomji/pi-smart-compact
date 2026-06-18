import { describe, it, beforeAll, afterAll } from "vitest";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createMockPi } from "./fixtures/mock-pi.mjs";

const root = path.resolve(import.meta.dirname, "..");
const extensionPath = path.join(root, "extensions", "smart-compact.ts");
const CONFIG_ENV = "PI_SMART_COMPACT_CONFIG_PATH";

let tempRoot;
let previousConfigEnv;
let testCounter = 0;

beforeAll(async () => {
  previousConfigEnv = process.env[CONFIG_ENV];
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "pi-smart-compact-u4-tool-"));
});

afterAll(async () => {
  if (previousConfigEnv === undefined) {
    delete process.env[CONFIG_ENV];
  } else {
    process.env[CONFIG_ENV] = previousConfigEnv;
  }
  await rm(tempRoot, { recursive: true, force: true });
});

async function setupExtension() {
  testCounter += 1;
  process.env[CONFIG_ENV] = path.join(tempRoot, `smart-boundary-${testCounter}.json`);
  const extensionModule = await import(pathToFileURL(extensionPath).href);
  const mock = createMockPi();
  await extensionModule.default(mock.pi);
  return mock;
}

function getSmartCompactTool(mock) {
  const tool = mock.state.tools.get("smart_compact");
  assert.ok(tool, "U4 should register a smart_compact tool for agent-authored compaction handoffs");
  assert.equal(typeof tool.execute, "function", "smart_compact should be executable through Pi's custom tool interface");
  return tool;
}

async function invokeSmartCompact(tool, params, ctx) {
  return tool.execute("call-smart-compact", params, new AbortController().signal, () => {}, ctx);
}

function toolResultText(result) {
  if (typeof result === "string") {
    return result;
  }
  if (Array.isArray(result?.content)) {
    return result.content
      .map((part) => (part?.type === "text" ? part.text : typeof part === "string" ? part : JSON.stringify(part)))
      .join("\n");
  }
  return JSON.stringify(result ?? "");
}

function validHandoff(label = "initial") {
  return [
    `Progress/current task: ${label} implementation is paused at a safe boundary.`,
    "Decisions made: keep compaction same-session and cooperative.",
    "Files/artifacts: extensions/smart-compact.ts and tests/smart-compact-tool.test.mjs are relevant.",
    "Validation status: targeted tests have been run or are pending as noted.",
    "Risks/blockers: no replacement session APIs may be used.",
    "Next steps: resume with the next green implementation step.",
  ].join("\n");
}

function assertStartedAndTerminates(result) {
  const text = toolResultText(result);
  assert.match(text, /compact|compaction/i, "tool result should communicate compaction status");
  assert.match(text, /start|started|underway|begun/i, "tool result should say compaction has started");
  assert.match(text, /no\s+further\s+action|wait|continuation|continue/i, "tool result should tell the agent no more work is needed until continuation");
  assert.equal(result?.terminate, true, "smart_compact must be a terminal tool result for the current mini-phase");
}

describe("U4 smart_compact tool and pending handoff state", () => {
  it("registers smart_compact with a required handoff parameter and terminal-use guidance", async () => {
    const mock = await setupExtension();
    const tool = getSmartCompactTool(mock);

    assert.equal(tool.name, "smart_compact");
    assert.match(String(tool.description ?? ""), /handoff|compact|compaction/i);

    const handoffProperty = tool.parameters?.properties?.handoff;
    assert.ok(handoffProperty, "smart_compact parameters should include a handoff string");
    assert.ok(
      Array.isArray(tool.parameters?.required) && tool.parameters.required.includes("handoff"),
      "handoff should be required by the public tool schema",
    );

    const guidance = [
      tool.description,
      tool.promptSnippet,
      ...(Array.isArray(tool.promptGuidelines) ? tool.promptGuidelines : []),
      handoffProperty?.description,
    ]
      .filter(Boolean)
      .join("\n");

    assert.match(guidance, /progress|current\s+task/i, "guidance should ask for progress/current task state");
    assert.match(guidance, /decision/i, "guidance should ask for decisions made");
    assert.match(guidance, /file|artifact/i, "guidance should ask for relevant files/artifacts");
    assert.match(guidance, /validation|test/i, "guidance should ask for validation status");
    assert.match(guidance, /risk|blocker/i, "guidance should ask for risks/blockers");
    assert.match(guidance, /next\s+step/i, "guidance should ask for concrete next steps");
    assert.match(guidance, /alone|only\s+tool|final\s+action|last\s+action/i, "guidance should say to call smart_compact alone as the final action");
  });

  it("accepts a valid handoff, starts same-session compaction once, and returns a terminating started result", async () => {
    const mock = await setupExtension();
    const tool = getSmartCompactTool(mock);
    const ctx = mock.createContext({ hasUI: true });

    const result = await invokeSmartCompact(tool, { handoff: validHandoff() }, ctx);

    assert.equal(mock.state.compactCalls.length, 1, "valid smart_compact handoff should call ctx.compact() exactly once");
    assertStartedAndTerminates(result);
    assert.equal(mock.state.replacementSessionCalls.length, 0, "smart_compact must preserve same-session identity");
  });

  it("rejects a whitespace-only handoff without compacting", async () => {
    const mock = await setupExtension();
    const tool = getSmartCompactTool(mock);
    const ctx = mock.createContext({ hasUI: true });

    const result = await invokeSmartCompact(tool, { handoff: " \n\t  " }, ctx);

    assert.equal(mock.state.compactCalls.length, 0, "blank handoffs must not trigger compaction");
    assert.match(toolResultText(result), /handoff|non-empty|required|blank|empty|invalid/i);
    assert.equal(mock.state.replacementSessionCalls.length, 0, "rejected handoffs must not replace the current session");
  });

  it("does not silently overwrite an already-pending smart-compaction handoff", async () => {
    const mock = await setupExtension();
    const tool = getSmartCompactTool(mock);
    const ctx = mock.createContext({ hasUI: true });

    const first = await invokeSmartCompact(tool, { handoff: validHandoff("first") }, ctx);
    assertStartedAndTerminates(first);

    const second = await invokeSmartCompact(tool, { handoff: validHandoff("second") }, ctx);

    assert.equal(mock.state.compactCalls.length, 1, "a second call while pending must not start another compaction or overwrite silently");
    assert.match(toolResultText(second), /pending|already|in\s+progress|underway|wait|retry/i);
    assert.equal(mock.state.replacementSessionCalls.length, 0, "pending-hand-off handling must remain same-session");
  });

  it("clears failed pending state when compaction start throws and does not send continue", async () => {
    const mock = await setupExtension();
    const tool = getSmartCompactTool(mock);
    let failNextCompact = true;
    const ctx = mock.createContext({
      hasUI: true,
      compact(...args) {
        mock.state.compactCalls.push(args);
        if (failNextCompact) {
          failNextCompact = false;
          throw new Error("simulated compact failure");
        }
      },
    });

    const failed = await invokeSmartCompact(tool, { handoff: validHandoff("failed") }, ctx);

    assert.equal(mock.state.compactCalls.length, 1, "the failed attempt should still have tried to start compaction once");
    assert.match(toolResultText(failed), /fail|error|could\s+not|unable/i, "the tool should report compaction start failure safely");
    assert.equal(mock.state.sentUserMessages.length, 0, "failed smart compaction must not send an automatic continue message");

    const retry = await invokeSmartCompact(tool, { handoff: validHandoff("retry after failure") }, ctx);

    assert.equal(mock.state.compactCalls.length, 2, "failed pending state should be cleared/expired so a later handoff can retry explicitly");
    assertStartedAndTerminates(retry);
    assert.equal(mock.state.sentUserMessages.length, 0, "starting or failing smart_compact must not send continue before compaction completes");
    assert.equal(mock.state.replacementSessionCalls.length, 0, "compaction failure handling must not create a replacement session");
  });

  it("expires pending state when ctx.compact reports failure through onError and does not send continue", async () => {
    const mock = await setupExtension();
    const tool = getSmartCompactTool(mock);
    let failNextCompact = true;
    const ctx = mock.createContext({
      hasUI: true,
      compact(...args) {
        mock.state.compactCalls.push(args);
        const options = args[0];
        if (failNextCompact) {
          failNextCompact = false;
          options?.onError?.(new Error("simulated async compact failure"));
        }
      },
    });

    await invokeSmartCompact(tool, { handoff: validHandoff("callback failure") }, ctx);

    assert.equal(mock.state.compactCalls.length, 1, "the failed callback attempt should have tried to start compaction once");
    assert.equal(mock.state.sentUserMessages.length, 0, "onError failure must not send automatic continue");

    const retry = await invokeSmartCompact(tool, { handoff: validHandoff("retry after callback failure") }, ctx);

    assert.equal(mock.state.compactCalls.length, 2, "onError should expire failed pending state so a later explicit handoff can retry");
    assertStartedAndTerminates(retry);
    assert.equal(mock.state.sentUserMessages.length, 0, "retry start must still wait for real compaction completion before continue");
    assert.equal(mock.state.replacementSessionCalls.length, 0, "onError handling must not create a replacement session");
  });
});
