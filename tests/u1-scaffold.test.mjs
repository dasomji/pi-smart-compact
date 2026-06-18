import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createMockPi } from "./fixtures/mock-pi.mjs";

const root = path.resolve(import.meta.dirname, "..");
const packageJsonPath = path.join(root, "package.json");
const constantsPath = path.join(root, "src", "constants.ts");
const extensionPath = path.join(root, "extensions", "smart-compact.ts");

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

describe("U1 package scaffold", () => {
  it("declares a public MIT Pi package with an extension manifest", async () => {
    assert.equal(existsSync(packageJsonPath), true, "package.json must exist at the package root");

    const manifest = await readJson(packageJsonPath);

    assert.equal(manifest.name, "pi-smart-compact");
    assert.equal(manifest.license, "MIT");
    assert.notEqual(manifest.private, true, "package should be publishable, not private");
    assert.ok(manifest.description?.includes("smart"), "package should describe smart compaction");
    assert.ok(manifest.keywords?.includes("pi-package"), "Pi packages must include the pi-package keyword");
    assert.match(String(manifest.repository?.url ?? manifest.repository ?? ""), /pi-smart-compact/);

    assert.ok(Array.isArray(manifest.pi?.extensions), "package.json must declare pi.extensions");
    assert.ok(
      manifest.pi.extensions.some((entry) => String(entry).replace(/^\.\//, "") === "extensions"),
      "pi.extensions should point at the extensions directory",
    );
  });

  it("declares TypeScript test harness scripts and Pi peer dependencies", async () => {
    assert.equal(existsSync(packageJsonPath), true, "package.json must exist at the package root");

    const manifest = await readJson(packageJsonPath);

    assert.match(manifest.scripts?.test ?? "", /vitest|node --test/, "package should expose a test command");
    assert.ok(manifest.devDependencies?.typescript, "TypeScript should be available for the scaffold");
    assert.ok(manifest.devDependencies?.vitest, "Vitest should be available for planned tests");
    assert.equal(
      manifest.peerDependencies?.["@earendil-works/pi-coding-agent"],
      "*",
      "Pi extension types/runtime package should be a peer dependency, not bundled",
    );
  });
});

describe("U1 exported constants", () => {
  it("exports stable package, boundary, command, and tool constants", async () => {
    assert.equal(existsSync(constantsPath), true, "src/constants.ts must exist");

    const constants = await import(pathToFileURL(constantsPath).href);

    assert.equal(constants.PACKAGE_NAME, "pi-smart-compact");
    assert.equal(constants.DEFAULT_SMART_BOUNDARY_TOKENS, 100_000);
    assert.equal(constants.ESCALATION_INTERVAL_TOKENS, 20_000);
    assert.equal(constants.SMART_BOUNDARY_COMMAND_NAME, "smart-boundary");
    assert.equal(constants.SMART_COMPACT_TOOL_NAME, "smart_compact");
  });
});

describe("U1 extension entrypoint scaffold", () => {
  it("loads through the Pi extension entrypoint and can be registered with a mock Pi API", async () => {
    assert.equal(existsSync(extensionPath), true, "extensions/smart-compact.ts must exist");

    const extensionModule = await import(pathToFileURL(extensionPath).href);
    assert.equal(typeof extensionModule.default, "function", "extension should default-export a Pi factory function");

    const mock = createMockPi();
    await extensionModule.default(mock.pi);

    assert.equal(mock.state.replacementSessionCalls.length, 0, "scaffold must not create/fork/switch sessions during registration");
  });
});
