import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const readText = (relativePath) =>
  existsSync(join(root, relativePath))
    ? readFileSync(join(root, relativePath), "utf8")
    : "";

const README_PATH = "README.md";
const MANUAL_PATH = "docs/manual-testing.md";

function expectMatches(text, pattern, label) {
  expect.soft(text, label).toMatch(pattern);
}

function expectNotMatches(text, pattern, label) {
  expect.soft(text, label).not.toMatch(pattern);
}

function expectCommandExamples(text, label) {
  expectMatches(
    text,
    /\/smart-boundary(?:`|\s|\n|$)/i,
    `${label} names the public /smart-boundary command`,
  );
  expectMatches(
    text,
    /\/smart-boundary\s*(?:`|\n|$)[\s\S]{0,160}\b(?:show|current|display|inspect)\b/i,
    `${label} explains that /smart-boundary with no value shows the current boundary`,
  );
  expectMatches(
    text,
    /\/smart-boundary\s+100k\b/i,
    `${label} gives a k-shorthand set example such as /smart-boundary 100k`,
  );
  expectMatches(
    text,
    /\/smart-boundary\s+120000\b/i,
    `${label} gives a plain-token set example such as /smart-boundary 120000`,
  );
  expectMatches(
    text,
    /\/smart-boundary\s+reset\b/i,
    `${label} gives a reset example`,
  );
}

function expectHandoffShape(text, label) {
  expectMatches(text, /smart_compact/i, `${label} names the public smart_compact tool`);
  expectMatches(text, /handoff/i, `${label} describes the agent-authored handoff`);
  for (const [pattern, part] of [
    [/progress|current task/i, "progress/current task"],
    [/decision/i, "decisions"],
    [/files?|artifacts?/i, "files or artifacts"],
    [/validation|test/i, "validation status"],
    [/risks?|blockers?/i, "risks or blockers"],
    [/next steps?/i, "next steps"],
  ]) {
    expectMatches(text, pattern, `${label} includes handoff shape item: ${part}`);
  }
}

function expectKnownLimitations(text, label) {
  for (const [pattern, part] of [
    [/does not force|no forced|not force/i, "no forced compaction"],
    [/project-specific|project specific/i, "no project-specific settings"],
    [/native(?: pi)? (?:auto-)?compaction[\s\S]{0,120}(?:independent|unchanged|untouched)|(?:independent|unchanged|untouched)[\s\S]{0,120}native(?: pi)? (?:auto-)?compaction/i, "native compaction remains independent"],
    [/cooperative|agent compliance|not guaranteed|agent may ignore/i, "cooperative compliance limitation"],
  ]) {
    expectMatches(text, pattern, `${label} documents limitation: ${part}`);
  }
}

describe("U6 documentation contract", () => {
  test("README documents installation, status, and public command/tool usage", () => {
    const readme = readText(README_PATH);

    expect(readme, "README.md exists").not.toEqual("");
    expectMatches(
      readme,
      /pi\s+install\s+(?:git\+)?https:\/\/github\.com\/dasomji\/pi-smart-compact(?:\.git)?/i,
      "README shows installation from GitHub",
    );
    expectMatches(
      readme,
      /pi\s+install\s+(?:\.\.?\/|\/|~\/|file:)/i,
      "README shows installation from a local path",
    );
    expectMatches(readme, /status\s*:/i, "README has a status note");
    expectNotMatches(
      readme,
      /planned pi extension|early scaffold|prd-only|product requirements are captured/i,
      "README status is no longer PRD-only or scaffold-only",
    );
    expectCommandExamples(readme, "README");
  });

  test("README explains warning-to-handoff workflow, handoff shape, failures, and limitations", () => {
    const readme = readText(README_PATH);

    expectMatches(
      readme,
      /warning|steer|boundary/i,
      "README describes boundary warnings/steering",
    );
    expectMatches(
      readme,
      /finish(?:es)? the current atomic task|current atomic task/i,
      "README tells agents to finish the current atomic task before compacting",
    );
    expectMatches(
      readme,
      /warning[\s\S]{0,500}handoff[\s\S]{0,500}smart_compact[\s\S]{0,500}compaction[\s\S]{0,500}continue/i,
      "README describes the warning -> handoff -> smart_compact -> compaction -> continue workflow",
    );
    expectHandoffShape(readme, "README");
    expectMatches(
      readme,
      /fail|error|cancel/i,
      "README describes compaction failure or cancellation behavior",
    );
    expectMatches(
      readme,
      /stale handoff|manual\/native|native\/manual|retry/i,
      "README explains stale handoff is not reused and retry/manual-native behavior after failure/cancel",
    );
    expectKnownLimitations(readme, "README");
  });

  test("manual verification guide exists and covers low-boundary main-agent and subagent scenarios", () => {
    const manual = readText(MANUAL_PATH);

    expect(existsSync(join(root, MANUAL_PATH)), "docs/manual-testing.md exists").toBe(true);
    expectCommandExamples(manual, "manual testing guide");
    expectMatches(
      manual,
      /low|deliberately low|artificial/i,
      "manual testing guide explains using a deliberately low boundary",
    );
    expectMatches(
      manual,
      /\/smart-boundary\s+(?:[1-9]\d{0,4}|[1-9]\d?k)\b/i,
      "manual testing guide gives a low-boundary /smart-boundary example",
    );
    expectMatches(manual, /main[- ]agent/i, "manual testing guide includes a main-agent scenario");
    expectMatches(manual, /subagent|sub-agent/i, "manual testing guide includes a subagent scenario");
    expectMatches(
      manual,
      /warning[\s\S]{0,700}handoff[\s\S]{0,700}smart_compact[\s\S]{0,700}same[- ]session[\s\S]{0,700}(?:single\s+)?continue/i,
      "manual testing guide verifies warning -> handoff -> smart_compact -> same-session compaction -> single continue",
    );
  });

  test("manual verification guide covers failure/cancel behavior, limitations, and public names", () => {
    const manual = readText(MANUAL_PATH);

    expect(existsSync(join(root, MANUAL_PATH)), "docs/manual-testing.md exists").toBe(true);
    expectMatches(manual, /\/smart-boundary/i, "manual testing guide names /smart-boundary");
    expectMatches(manual, /smart_compact/i, "manual testing guide names smart_compact");
    expectHandoffShape(manual, "manual testing guide");
    expectMatches(
      manual,
      /fail|error|cancel/i,
      "manual testing guide includes compaction failure or cancellation behavior",
    );
    expectMatches(
      manual,
      /stale handoff/i,
      "manual testing guide says stale handoffs are not reused after failure/cancel",
    );
    expectMatches(
      manual,
      /manual\/native|native\/manual|native compaction|manual compaction/i,
      "manual testing guide verifies later manual/native compaction is unaffected after failure/cancel",
    );
    expectKnownLimitations(manual, "manual testing guide");
  });
});
