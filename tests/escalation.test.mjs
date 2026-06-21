import { describe, it, beforeAll, afterAll, beforeEach } from "vitest";
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
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "pi-smart-compact-u3-escalation-"));
});

beforeEach(async () => {
  testCounter += 1;
  process.env[CONFIG_ENV] = path.join(tempRoot, `smart-boundary-${testCounter}.json`);
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
  const extensionModule = await import(pathToFileURL(extensionPath).href);
  const mock = createMockPi();
  await extensionModule.default(mock.pi);
  return mock;
}

function assertTurnEndRegistered(mock) {
  assert.ok(
    (mock.state.handlers.get("turn_end") ?? []).length > 0,
    "U3 should register turn_end so it can monitor token usage after turns",
  );
}

function assertSessionStartRegistered(mock) {
  assert.ok(
    (mock.state.handlers.get("session_start") ?? []).length > 0,
    "U3 should register session_start so monitoring state resets safely on startup/reload",
  );
}

function contextWithTokens(mock, tokens, overrides = {}) {
  return mock.createContext({
    hasUI: true,
    getContextUsage() {
      return tokens === undefined ? undefined : { tokens, contextWindow: 200_000, percent: tokens / 200_000 };
    },
    ...overrides,
  });
}

async function triggerUsage(mock, tokens, overrides = {}) {
  return mock.trigger("turn_end", { type: "turn_end" }, contextWithTokens(mock, tokens, overrides));
}

async function invokeCommand(mock, name, input) {
  const command = mock.state.commands.get(name);
  assert.ok(command, `expected /${name} command to be registered`);
  return command.handler(input, mock.createContext({ hasUI: true }));
}

function lastSteeringMessage(mock) {
  const sent = mock.state.sentUserMessages.at(-1);
  assert.ok(sent, "expected a steering user message to be sent");
  assert.equal(sent.options?.deliverAs, "steer", "monitoring warnings must be delivered as steering user messages");
  assert.equal(typeof sent.message, "string", "steering warning should be visible text for the agent");
  return sent.message;
}

function assertPromptInstructsSmartCompaction(message) {
  assert.match(message, /current\s+atomic\s+task|atomic\s+task|current\s+unit/i);
  assert.match(message, /avoid|do\s+not|don't|before\s+starting/i);
  assert.match(message, /major\s+new\s+work|new\s+major\s+step|future\s+work|next\s+major/i);
  assert.match(message, /short\s+bounded\s+check|bounded\s+check|file\s+write/i);
  assert.match(message, /artifact/i);
  assert.match(message, /handoff/i);
  assert.match(message, /Current task\s*\/\s*atomic stopping point/i);
  assert.match(message, /Risks\s*\/\s*blockers/i);
  assert.match(message, /unavailable[\s\S]{0,120}handoff-style|handoff-style[\s\S]{0,120}unavailable/i);
  assert.match(message, /smart_compact/i);
}

describe("U3 token monitoring and escalation steering", () => {
  it("calculates the default boundary band and keeps below-boundary turns as a no-op", async () => {
    const mock = await setupExtension();
    assertTurnEndRegistered(mock);

    await triggerUsage(mock, 99_999);

    assert.equal(mock.state.sentUserMessages.length, 0, "usage below the 100000-token boundary should not warn");
    assert.equal(mock.state.compactCalls.length, 0, "monitoring must not force compaction below the boundary");
    assert.equal(mock.state.replacementSessionCalls.length, 0, "monitoring must preserve same-session identity");
  });

  it("sends the first instructional steering warning at the configured boundary", async () => {
    const mock = await setupExtension();

    await triggerUsage(mock, 100_000);

    assert.equal(mock.state.sentUserMessages.length, 1, "the first boundary band should send one warning");
    const message = lastSteeringMessage(mock);
    assertPromptInstructsSmartCompaction(message);
    assert.match(message, /when\s+ready|natural\s+stopping|stopping\s+point|finish/i);
    assert.equal(mock.state.compactCalls.length, 0, "monitoring warnings must not call ctx.compact()");
    assert.equal(mock.state.replacementSessionCalls.length, 0, "monitoring warnings must not call replacement-session APIs");
  });

  it("escalates once usage reaches the next +20000-token band", async () => {
    const mock = await setupExtension();

    await triggerUsage(mock, 100_000);
    const firstMessage = lastSteeringMessage(mock);
    await triggerUsage(mock, 119_999);
    assert.equal(mock.state.sentUserMessages.length, 1, "remaining in band 0 must not duplicate the first warning");

    await triggerUsage(mock, 120_000);

    assert.equal(mock.state.sentUserMessages.length, 2, "crossing boundary + 20000 should send the next escalation");
    const secondMessage = lastSteeringMessage(mock);
    assertPromptInstructsSmartCompaction(secondMessage);
    assert.notEqual(secondMessage, firstMessage, "the +20000 warning should be a distinct, firmer escalation");
    assert.match(secondMessage, /urgent|firm|escalat|again|now|immediate|higher|priority|strong/i);
    assert.equal(mock.state.compactCalls.length, 0, "escalation monitoring must still not force compaction");
    assert.equal(mock.state.replacementSessionCalls.length, 0, "escalation monitoring must still preserve the current session");
  });

  it("does not spam duplicate warnings for repeated turns in the same band", async () => {
    const mock = await setupExtension();

    await triggerUsage(mock, 100_000);
    await triggerUsage(mock, 100_001);
    await triggerUsage(mock, 110_000);
    await triggerUsage(mock, 119_999);

    assert.equal(mock.state.sentUserMessages.length, 1, "band 0 should only warn once until a higher band is reached");
    assert.equal(mock.state.sentUserMessages[0].options?.deliverAs, "steer");
  });

  it("treats undefined context usage as a safe no-op", async () => {
    const mock = await setupExtension();
    assertTurnEndRegistered(mock);

    await assert.doesNotReject(() => triggerUsage(mock, undefined));

    assert.equal(mock.state.sentUserMessages.length, 0, "missing usage data should not send a warning");
    assert.equal(mock.state.compactCalls.length, 0, "missing usage data should not trigger compaction");
    assert.equal(mock.state.replacementSessionCalls.length, 0, "missing usage data should not replace sessions");
  });

  it("uses a custom /smart-boundary value when calculating bands", async () => {
    const mock = await setupExtension();
    await invokeCommand(mock, "smart-boundary", "75000");

    await triggerUsage(mock, 74_999);
    assert.equal(mock.state.sentUserMessages.length, 0, "usage below the custom boundary should not warn");

    await triggerUsage(mock, 75_000);
    assert.equal(mock.state.sentUserMessages.length, 1, "usage at the custom boundary should warn");
    assertPromptInstructsSmartCompaction(lastSteeringMessage(mock));

    await triggerUsage(mock, 94_999);
    assert.equal(mock.state.sentUserMessages.length, 1, "custom band 0 should not duplicate before +20000");

    await triggerUsage(mock, 95_000);
    assert.equal(mock.state.sentUserMessages.length, 2, "custom boundary + 20000 should escalate to band 1");
    assert.equal(mock.state.sentUserMessages.at(-1).options?.deliverAs, "steer");
  });

  it("resets escalation state on session_start/reload without depending on stale runtime state", async () => {
    const mock = await setupExtension();

    await triggerUsage(mock, 100_000);
    await triggerUsage(mock, 100_001);
    assert.equal(mock.state.sentUserMessages.length, 1, "same-band duplicate should be suppressed before reload");
    assertSessionStartRegistered(mock);

    await mock.trigger("session_start", { type: "session_start" }, mock.createContext({ hasUI: true }));
    await triggerUsage(mock, 100_001);

    assert.equal(mock.state.sentUserMessages.length, 2, "session_start should reset in-memory band tracking safely");
    assert.equal(mock.state.sentUserMessages.at(-1).options?.deliverAs, "steer");
  });

  it("does not call compact or replacement-session APIs from any monitoring path", async () => {
    const mock = await setupExtension();

    await triggerUsage(mock, 100_000);
    await triggerUsage(mock, 120_000);

    assert.equal(mock.state.sentUserMessages.length, 2, "test precondition: monitoring should have crossed two warning bands");
    assert.deepEqual(mock.state.compactCalls, [], "token monitoring must never call ctx.compact(); only smart_compact may do that later");
    assert.deepEqual(
      mock.state.replacementSessionCalls,
      [],
      "token monitoring must not call newSession, fork, or switchSession because smart compaction is same-session",
    );
  });

  it("handles sendUserMessage failures without crashing future monitoring", async () => {
    const mock = await setupExtension();
    let attempts = 0;
    mock.pi.sendUserMessage = async (message, options = {}) => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("simulated steering delivery failure");
      }
      mock.state.sentUserMessages.push({ message, options });
    };

    await assert.doesNotReject(
      () => triggerUsage(mock, 100_000),
      "a failed steering send should be contained by monitoring rather than escaping the turn_end handler",
    );
    assert.equal(mock.state.sentUserMessages.length, 0, "the failed first send should not record a delivered warning");

    await assert.doesNotReject(() => triggerUsage(mock, 120_000));

    assert.equal(mock.state.sentUserMessages.length, 1, "future monitoring should still be able to send a later-band warning");
    assert.equal(mock.state.sentUserMessages[0].options?.deliverAs, "steer");
    assertPromptInstructsSmartCompaction(mock.state.sentUserMessages[0].message);
    assert.equal(mock.state.compactCalls.length, 0, "send failure recovery must not fall back to forced compaction");
    assert.equal(mock.state.replacementSessionCalls.length, 0, "send failure recovery must not replace sessions");
  });
});
