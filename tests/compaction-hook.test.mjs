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
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "pi-smart-compact-u5-hooks-"));
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
  assert.ok(tool, "U4 should register smart_compact so U5 can drive pending handoff through the public tool");
  assert.equal(typeof tool.execute, "function");
  return tool;
}

function getOnlyHandler(mock, eventName) {
  const handlers = mock.state.handlers.get(eventName) ?? [];
  assert.equal(handlers.length, 1, `U5 should register exactly one ${eventName} hook`);
  return handlers[0];
}

async function invokeSmartCompact(tool, params, ctx) {
  return tool.execute("call-smart-compact", params, new AbortController().signal, () => {}, ctx);
}

async function invokeBeforeCompact(mock, event, ctx = mock.createContext({ hasUI: true })) {
  return getOnlyHandler(mock, "session_before_compact")(event, ctx);
}

async function invokeSessionCompact(mock, event, ctx = mock.createContext({ hasUI: true })) {
  return getOnlyHandler(mock, "session_compact")(event, ctx);
}

function validHandoff(label = "handoff") {
  return [
    `Progress/current task: ${label} is paused at a safe smart compaction boundary.`,
    "Decisions made: use same-session compaction and keep parent/subagent identity intact.",
    "Files/artifacts: tests/compaction-hook.test.mjs captures the required continuation flow.",
    "Validation status: targeted U5 tests are being run in RED phase.",
    "Risks/blockers: stale handoff state must not leak into native compactions.",
    "Next steps: after compaction, continue with the GREEN implementation.",
  ].join("\n");
}

function compactionEvent(overrides = {}) {
  const signal = overrides.signal ?? new AbortController().signal;
  const preparation = Object.hasOwn(overrides, "preparation")
    ? overrides.preparation
    : {
        firstKeptEntryId: "entry-keep-42",
        messagesToSummarize: [],
        turnPrefixMessages: [],
        isSplitTurn: false,
        tokensBefore: 123456,
        previousSummary: "previous native summary",
        fileOps: { readFiles: [], modifiedFiles: [] },
        settings: { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 },
      };

  return {
    type: "session_before_compact",
    preparation,
    branchEntries: [],
    signal,
    ...overrides,
  };
}

function compactionEntryFromResult(result, overrides = {}) {
  const compaction = result?.compaction;
  assert.ok(compaction, "expected a custom compaction result to build the session_compact event");
  return {
    type: "compaction",
    id: "saved-compaction-entry-1",
    parentId: "entry-before-compaction",
    timestamp: Date.now(),
    summary: compaction.summary,
    firstKeptEntryId: compaction.firstKeptEntryId,
    tokensBefore: compaction.tokensBefore,
    fromHook: true,
    details: compaction.details,
    ...overrides,
  };
}

function assertNoOverride(result, message) {
  assert.ok(
    result === undefined || result?.compaction === undefined,
    `${message}; got ${JSON.stringify(result)}`,
  );
}

function sentContinueMessages(mock) {
  return mock.state.sentUserMessages.filter(({ message }) => message === "continue");
}

describe("U5 compaction summary hook and continuation flow", () => {
  it("registers session_before_compact and session_compact hooks", async () => {
    const mock = await setupExtension();

    getOnlyHandler(mock, "session_before_compact");
    getOnlyHandler(mock, "session_compact");
  });

  it("returns no override for manual/native compaction when no smart handoff is pending", async () => {
    const mock = await setupExtension();

    const result = await invokeBeforeCompact(mock, compactionEvent());

    assertNoOverride(result, "manual/native compaction without pending smart handoff should fall back to Pi default behavior");
    assert.equal(mock.state.sentUserMessages.length, 0, "fallback compaction should not send continuation");
  });

  it("uses a pending smart_compact handoff as the custom summary with provenance while preserving Pi preparation fields", async () => {
    const mock = await setupExtension();
    const tool = getSmartCompactTool(mock);
    const ctx = mock.createContext({ hasUI: true });
    const handoff = validHandoff("custom summary preservation");

    await invokeSmartCompact(tool, { handoff }, ctx);
    const result = await invokeBeforeCompact(mock, compactionEvent(), ctx);

    assert.ok(result?.compaction, "pending smart_compact handoff should override compaction summary");
    assert.equal(result.compaction.firstKeptEntryId, "entry-keep-42", "custom summary must preserve Pi's prepared firstKeptEntryId");
    assert.equal(result.compaction.tokensBefore, 123456, "custom summary must preserve Pi's prepared tokensBefore");
    assert.match(result.compaction.summary, /custom summary preservation/, "summary should contain the agent-authored handoff text");
    assert.match(result.compaction.summary, /smart[_ -]?compact|pi-smart-compact/i, "summary should include provenance that it came from smart_compact");
    assert.match(JSON.stringify(result.compaction.details ?? {}), /smart[_ -]?compact|pi-smart-compact/i, "details should include smart compaction provenance for matching completion");
    assert.match(JSON.stringify(result.compaction.details ?? {}), /smart-compact-\d+/, "details should carry a smart compaction id for matching session_compact");
  });

  it("clears pending state and sends exactly one continue when the matching smart compaction completes", async () => {
    const mock = await setupExtension();
    const tool = getSmartCompactTool(mock);
    const ctx = mock.createContext({ hasUI: true });
    const handoff = validHandoff("complete once");

    await invokeSmartCompact(tool, { handoff }, ctx);
    const beforeResult = await invokeBeforeCompact(mock, compactionEvent(), ctx);
    const completedEvent = {
      type: "session_compact",
      compactionEntry: compactionEntryFromResult(beforeResult),
      fromExtension: true,
    };

    await invokeSessionCompact(mock, completedEvent, ctx);
    await invokeSessionCompact(mock, completedEvent, ctx);

    assert.deepEqual(
      mock.state.sentUserMessages,
      [{ message: "continue", options: {} }],
      "matching smart compaction should send exactly one plain continue message even if session_compact is duplicated",
    );

    const laterManual = await invokeBeforeCompact(mock, compactionEvent({ preparation: { ...compactionEvent().preparation, firstKeptEntryId: "later-entry", tokensBefore: 777 } }), ctx);
    assertNoOverride(laterManual, "completed smart compaction should clear pending handoff so later manual/native compaction is not overridden");
  });

  it("does not send continue for unrelated/manual session_compact events while a smart compaction is pending", async () => {
    const mock = await setupExtension();
    const tool = getSmartCompactTool(mock);
    const ctx = mock.createContext({ hasUI: true });

    await invokeSmartCompact(tool, { handoff: validHandoff("pending but unrelated completion") }, ctx);

    await invokeSessionCompact(
      mock,
      {
        type: "session_compact",
        fromExtension: false,
        compactionEntry: {
          type: "compaction",
          id: "manual-compaction-entry",
          parentId: "manual-parent",
          timestamp: Date.now(),
          summary: "Native/manual compaction summary",
          firstKeptEntryId: "manual-keep",
          tokensBefore: 222,
          details: { source: "native" },
        },
      },
      ctx,
    );

    assert.equal(sentContinueMessages(mock).length, 0, "unrelated/manual compaction completion must not resume the agent");

    const result = await invokeBeforeCompact(mock, compactionEvent(), ctx);
    assert.ok(result?.compaction, "unrelated manual completion should not clear the still-pending smart handoff");
    assert.match(result.compaction.summary, /pending but unrelated completion/);
  });

  it("does not leak stale handoff into later native compaction after smart compaction fails through ctx.compact onError", async () => {
    const mock = await setupExtension();
    const tool = getSmartCompactTool(mock);
    const failedHandoff = validHandoff("failed stale handoff");
    const ctx = mock.createContext({
      hasUI: true,
      compact(...args) {
        mock.state.compactCalls.push(args);
        const options = args[0];
        options?.onError?.(new Error("simulated compaction cancellation"));
      },
    });

    await invokeSmartCompact(tool, { handoff: failedHandoff }, ctx);
    const laterNativeResult = await invokeBeforeCompact(mock, compactionEvent(), ctx);

    assertNoOverride(laterNativeResult, "failed/cancelled smart compaction must expire pending state before later native compaction");
    assert.equal(sentContinueMessages(mock).length, 0, "failed/cancelled smart compaction must not send continue");
  });

  it("falls back safely when compaction preparation is missing or the hook signal is already aborted", async () => {
    const mock = await setupExtension();
    const tool = getSmartCompactTool(mock);
    const ctx = mock.createContext({ hasUI: true });

    await invokeSmartCompact(tool, { handoff: validHandoff("aborted or missing prep") }, ctx);

    const missingPrepResult = await invokeBeforeCompact(mock, compactionEvent({ preparation: undefined }), ctx);
    assertNoOverride(missingPrepResult, "missing compaction preparation should not produce a corrupt custom summary");

    await invokeSmartCompact(tool, { handoff: validHandoff("aborted signal") }, ctx);
    const controller = new AbortController();
    controller.abort();
    const abortedResult = await invokeBeforeCompact(mock, compactionEvent({ signal: controller.signal }), ctx);
    assertNoOverride(abortedResult, "aborted compaction hook should fall back safely");

    const laterNativeResult = await invokeBeforeCompact(mock, compactionEvent(), ctx);
    assertNoOverride(laterNativeResult, "missing/aborted prep should clear or ignore stale smart handoff for later native compaction");
    assert.equal(sentContinueMessages(mock).length, 0, "fallback before_compact paths must not continue the agent");
  });
});
