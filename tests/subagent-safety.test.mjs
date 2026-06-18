import { describe, it, beforeAll, afterAll } from "vitest";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "pi-smart-compact-u5-subagent-"));
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
  assert.ok(tool, "smart_compact should be registered for subagents as the public handoff interface");
  return tool;
}

function getOnlyHandler(mock, eventName) {
  const handlers = mock.state.handlers.get(eventName) ?? [];
  assert.equal(handlers.length, 1, `U5 should register exactly one ${eventName} hook for same-session continuation`);
  return handlers[0];
}

function compactionEvent() {
  return {
    type: "session_before_compact",
    preparation: {
      firstKeptEntryId: "subagent-keep-entry",
      messagesToSummarize: [],
      turnPrefixMessages: [],
      isSplitTurn: false,
      tokensBefore: 98765,
      fileOps: { readFiles: [], modifiedFiles: [] },
      settings: { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 },
    },
    branchEntries: [],
    signal: new AbortController().signal,
  };
}

function validSubagentHandoff() {
  return [
    "Progress/current task: delegated subagent work reached a natural compaction boundary.",
    "Decisions made: continuation must remain in the same subagent session/run.",
    "Files/artifacts: saved work is already on disk before smart_compact.",
    "Validation status: U5 subagent-safety test exercises the public extension surface.",
    "Risks/blockers: replacement sessions would confuse parent run tracking.",
    "Next steps: continue the delegated task after compaction.",
  ].join("\n");
}

describe("U5 subagent same-session safety", () => {
  it("does not reference replacement-session APIs in production source", async () => {
    const productionFiles = [
      path.join(root, "extensions", "smart-compact.ts"),
      path.join(root, "src", "smart-compact-state.ts"),
      path.join(root, "src", "prompts.ts"),
      path.join(root, "src", "escalation.ts"),
    ];

    for (const file of productionFiles) {
      const source = await readFile(file, "utf8");
      assert.doesNotMatch(source, /\b(newSession|fork|switchSession)\s*\(/, `${path.relative(root, file)} must not create or switch sessions`);
    }
  });

  it("keeps a smart-compacted subagent in the same session and sends one continue without replacement APIs", async () => {
    const mock = await setupExtension();
    const tool = getSmartCompactTool(mock);
    const ctx = mock.createContext({ hasUI: true, isSubagent: true });

    await tool.execute("subagent-smart-compact", { handoff: validSubagentHandoff() }, new AbortController().signal, () => {}, ctx);
    const beforeResult = await getOnlyHandler(mock, "session_before_compact")(compactionEvent(), ctx);

    assert.ok(beforeResult?.compaction, "subagent smart_compact should customize summary in the same session");
    await getOnlyHandler(mock, "session_compact")(
      {
        type: "session_compact",
        fromExtension: true,
        compactionEntry: {
          type: "compaction",
          id: "subagent-saved-compaction",
          parentId: "subagent-parent-entry",
          timestamp: Date.now(),
          summary: beforeResult.compaction.summary,
          firstKeptEntryId: beforeResult.compaction.firstKeptEntryId,
          tokensBefore: beforeResult.compaction.tokensBefore,
          fromHook: true,
          details: beforeResult.compaction.details,
        },
      },
      ctx,
    );

    assert.equal(mock.state.replacementSessionCalls.length, 0, "smart compaction must not call newSession/fork/switchSession for subagents");
    assert.deepEqual(mock.state.sentUserMessages, [{ message: "continue", options: {} }], "subagent should receive one same-session continue");
  });
});
