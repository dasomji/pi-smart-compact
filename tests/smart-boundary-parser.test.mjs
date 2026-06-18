import { describe, it } from "vitest";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const parserPath = path.join(root, "src", "smart-boundary-parser.ts");

async function loadParser() {
  const mod = await import(pathToFileURL(parserPath).href);
  const parse =
    mod.parseSmartBoundaryInput ??
    mod.parseSmartBoundaryCommand ??
    mod.parseSmartBoundary ??
    mod.default;

  assert.equal(typeof parse, "function", "smart-boundary parser must export a parse function");
  return parse;
}

function normalizeParseResult(result) {
  assert.ok(result && typeof result === "object", "parser should return a structured result object");

  const rawAction = result.action ?? result.type ?? result.kind;
  const action = typeof rawAction === "string" ? rawAction.toLowerCase() : rawAction;
  const ok = result.ok !== false && action !== "error" && action !== "invalid";
  const tokens = result.tokens ?? result.boundaryTokens ?? result.boundary ?? result.value;
  const message = result.message ?? result.error ?? result.reason;
  const warning = result.warning ?? result.note;

  return { ok, action, tokens, message, warning, raw: result };
}

async function parse(input) {
  const parser = await loadParser();
  return normalizeParseResult(await parser(input));
}

function assertShow(result) {
  assert.equal(result.ok, true, "show input should parse successfully");
  assert.match(String(result.action), /show|current|get/, "show input should be classified as a read/current-setting action");
}

function assertReset(result) {
  assert.equal(result.ok, true, "reset input should parse successfully");
  assert.match(String(result.action), /reset|default/, "reset input should be classified as a reset-to-default action");
}

function assertSet(result, expectedTokens) {
  assert.equal(result.ok, true, `set input should parse successfully: ${JSON.stringify(result.raw)}`);
  assert.match(String(result.action), /set|update|boundary/, "token input should be classified as a set-boundary action");
  assert.equal(result.tokens, expectedTokens);
}

function assertRejected(result, label) {
  assert.equal(result.ok, false, `${label} should be rejected`);
  assert.ok(typeof result.message === "string" && result.message.trim().length > 0, `${label} should include a helpful message`);
}

describe("U2 smart-boundary parser", () => {
  it("parses empty or whitespace input as a show-current-boundary request", async () => {
    assertShow(await parse(""));
    assertShow(await parse("   \t  "));
  });

  it("parses reset with surrounding whitespace as a reset-to-default request", async () => {
    assertReset(await parse("reset"));
    assertReset(await parse("  reset  "));
  });

  it("accepts k shorthand, plain integers, surrounding whitespace, and low positive manual-test values", async () => {
    assertSet(await parse("100k"), 100_000);
    assertSet(await parse("120000"), 120_000);
    assertSet(await parse("  120000  "), 120_000);
    assertSet(await parse("100"), 100);
  });

  it("rejects invalid text, zero, negative values, fractional forms, and unsafe integers", async () => {
    for (const input of [
      "abc",
      "0",
      "-1",
      "-100k",
      "1.5",
      "1.5k",
      "100.0k",
      String(Number.MAX_SAFE_INTEGER + 1),
      "9007199254741k",
    ]) {
      assertRejected(await parse(input), input);
    }
  });
});
