import { describe, it, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createMockPi } from "./fixtures/mock-pi.mjs";

const root = path.resolve(import.meta.dirname, "..");
const extensionPath = path.join(root, "extensions", "smart-compact.ts");
const CONFIG_ENV = "PI_SMART_COMPACT_CONFIG_PATH";

let tempRoot;
let commandConfigPath;
let previousConfigEnv;

beforeAll(async () => {
  previousConfigEnv = process.env[CONFIG_ENV];
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "pi-smart-compact-u2-command-"));
  commandConfigPath = path.join(tempRoot, "smart-boundary.json");
  process.env[CONFIG_ENV] = commandConfigPath;
});

beforeEach(async () => {
  await rm(commandConfigPath, { recursive: true, force: true });
});

afterEach(async () => {
  await rm(commandConfigPath, { recursive: true, force: true });
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
  process.env[CONFIG_ENV] = commandConfigPath;
  const extensionModule = await import(pathToFileURL(extensionPath).href);
  const mock = createMockPi();
  await extensionModule.default(mock.pi);
  const command = mock.state.commands.get("smart-boundary");
  assert.ok(command, "extension should register the /smart-boundary command");
  assert.match(String(command.description ?? ""), /boundary|token/i, "/smart-boundary should describe token-boundary configuration");
  assert.equal(typeof command.handler, "function", "/smart-boundary command should expose a handler");
  return { mock, command };
}

function getSmartCompactCommand(setup) {
  const command = setup.mock.state.commands.get("smart-compact");
  assert.ok(command, "extension should register the /smart-compact command");
  assert.match(String(command.description ?? ""), /smart|compact|handoff/i, "/smart-compact should describe smart compaction");
  assert.equal(typeof command.handler, "function", "/smart-compact command should expose a handler");
  return command;
}

async function invokeSmartBoundary(input, setup = undefined, contextOverrides = { hasUI: true }) {
  const current = setup ?? (await setupExtension());
  const ctx = current.mock.createContext(contextOverrides);
  const notificationStart = current.mock.state.notifications.length;
  const result = await current.command.handler(input, ctx);
  const notifications = current.mock.state.notifications.slice(notificationStart).map((entry) => entry.message);
  const output = [
    typeof result === "string" ? result : result === undefined ? "" : JSON.stringify(result),
    ...notifications,
  ]
    .filter(Boolean)
    .join("\n");
  assert.ok(output.trim().length > 0, `/smart-boundary ${input} should provide user-facing feedback`);
  return output;
}

function assertMentionsTokens(output, tokens) {
  const compact = output.replace(/[,_\s]/g, "").toLowerCase();
  assert.ok(
    compact.includes(String(tokens)) || compact.includes(`${tokens / 1000}k`),
    `expected feedback to mention ${tokens} tokens, got: ${output}`,
  );
}

function assertErrorFeedback(output, input) {
  assert.match(output, /invalid|reject|positive|integer|whole|usage|error/i, `expected helpful rejection feedback for ${input}: ${output}`);
}

describe("/smart-compact command", () => {
  it("registers a slash command that requests agent-authored smart compaction without compacting immediately", async () => {
    const setup = await setupExtension();
    const command = getSmartCompactCommand(setup);
    const ctx = setup.mock.createContext({ hasUI: true });

    const result = await command.handler("", ctx);

    assert.equal(result, undefined, "/smart-compact should use UI feedback when available");
    assert.equal(setup.mock.state.compactCalls.length, 0, "no-arg /smart-compact should not compact without an agent-authored handoff");
    assert.equal(setup.mock.state.sentUserMessages.length, 1, "no-arg /smart-compact should steer the agent to create a handoff");
    assert.match(setup.mock.state.sentUserMessages[0].message, /manual smart compaction requested|smart_compact|handoff/i);
    assert.deepEqual(setup.mock.state.sentUserMessages[0].options, {}, "idle command requests can be sent immediately");
    assert.match(setup.mock.state.notifications.at(-1).message, /requested|agent|handoff|smart_compact/i);
    assert.equal(setup.mock.state.replacementSessionCalls.length, 0, "/smart-compact must preserve same-session identity");
  });

  it("sends no-arg /smart-compact as steering when the agent is not idle", async () => {
    const setup = await setupExtension();
    const command = getSmartCompactCommand(setup);
    const ctx = setup.mock.createContext({ hasUI: true, isIdle: () => false });

    await command.handler("", ctx);

    assert.equal(setup.mock.state.sentUserMessages.length, 1);
    assert.deepEqual(setup.mock.state.sentUserMessages[0].options, { deliverAs: "steer" });
    assert.equal(setup.mock.state.compactCalls.length, 0, "active no-arg /smart-compact should still wait for the agent handoff");
  });

  it("rejects command arguments because the active agent must author the handoff", async () => {
    const setup = await setupExtension();
    const command = getSmartCompactCommand(setup);
    const ctx = setup.mock.createContext({ hasUI: true });

    await command.handler("Current task: user-supplied handoff text should not be accepted.", ctx);

    assert.equal(setup.mock.state.compactCalls.length, 0, "user-supplied command text must not start compaction");
    assert.equal(setup.mock.state.sentUserMessages.length, 0, "invalid argument mode should not ask the agent until the user reruns /smart-compact alone");
    assert.match(setup.mock.state.notifications.at(-1).message, /without|handoff|agent|current context|smart_compact/i);
    assert.equal(setup.mock.state.notifications.at(-1).level, "error");
    assert.equal(setup.mock.state.replacementSessionCalls.length, 0, "/smart-compact must not create replacement sessions");
  });
});

describe("U2 /smart-boundary command", () => {
  it("registers a command handler that shows the default boundary when config is missing", async () => {
    const setup = await setupExtension();

    const output = await invokeSmartBoundary("", setup);

    assertMentionsTokens(output, 100_000);
    assert.match(output, /current|default|boundary/i);
    assert.equal(setup.mock.state.replacementSessionCalls.length, 0, "/smart-boundary must not create replacement sessions");
  });

  it("returns feedback instead of crashing when command context has no UI notifier", async () => {
    const setup = await setupExtension();

    const output = await invokeSmartBoundary("", setup, { ui: undefined });

    assertMentionsTokens(output, 100_000);
    assert.match(output, /current|default|boundary/i);
    assert.equal(setup.mock.state.notifications.length, 0, "no UI notifier should mean no notification is recorded");
  });

  it("stores 100k shorthand and survives simulated extension reload", async () => {
    let setup = await setupExtension();
    let output = await invokeSmartBoundary("100k", setup);
    assertMentionsTokens(output, 100_000);

    setup = await setupExtension();
    output = await invokeSmartBoundary("", setup);
    assertMentionsTokens(output, 100_000);
  });

  it("stores plain integer input with surrounding whitespace and survives simulated extension reload", async () => {
    let setup = await setupExtension();
    let output = await invokeSmartBoundary("  120000  ", setup);
    assertMentionsTokens(output, 120_000);

    setup = await setupExtension();
    output = await invokeSmartBoundary("", setup);
    assertMentionsTokens(output, 120_000);
  });

  it("resets a custom value back to the 100000-token default", async () => {
    const setup = await setupExtension();
    await invokeSmartBoundary("120000", setup);

    const resetOutput = await invokeSmartBoundary(" reset ", setup);
    assertMentionsTokens(resetOutput, 100_000);
    assert.match(resetOutput, /reset|default/i);

    const showOutput = await invokeSmartBoundary("", await setupExtension());
    assertMentionsTokens(showOutput, 100_000);
  });

  it("accepts low positive boundaries for manual testing", async () => {
    const setup = await setupExtension();

    const output = await invokeSmartBoundary("100", setup);

    assertMentionsTokens(output, 100);
    assert.doesNotMatch(output, /invalid|reject|error/i, "low positive values should not be rejected");
  });

  it("rejects invalid, zero, negative, and fractional values without changing the previous boundary", async () => {
    const setup = await setupExtension();
    await invokeSmartBoundary("120000", setup);

    for (const input of ["abc", "0", "-1", "1.5", "1.5k", String(Number.MAX_SAFE_INTEGER + 1), "9007199254741k"]) {
      const output = await invokeSmartBoundary(input, setup);
      assertErrorFeedback(output, input);
      const showOutput = await invokeSmartBoundary("", setup);
      assertMentionsTokens(showOutput, 120_000);
    }
  });

  it("falls back to default instead of crashing when config is corrupt", async () => {
    await writeFile(commandConfigPath, "{ not valid json", "utf8");
    const setup = await setupExtension();

    const output = await invokeSmartBoundary("", setup);

    assertMentionsTokens(output, 100_000);
    assert.match(output, /default|corrupt|invalid|warning|could not|failed/i);
  });

  it("falls back to default instead of crashing when config cannot be read as a file", async () => {
    await mkdir(commandConfigPath);
    const setup = await setupExtension();

    const output = await invokeSmartBoundary("", setup);

    assertMentionsTokens(output, 100_000);
    assert.match(output, /default|unreadable|could not|failed|warning/i);
  });
});
