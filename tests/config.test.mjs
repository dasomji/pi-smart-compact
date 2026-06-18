import { describe, it, afterEach } from "vitest";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, mkdir, chmod } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const configPath = path.join(root, "src", "config.ts");
const tmpRoots = [];

async function makeTempConfigPath(name = "smart-boundary.json") {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pi-smart-compact-u2-config-"));
  tmpRoots.push(dir);
  return path.join(dir, name);
}

afterEach(async () => {
  while (tmpRoots.length > 0) {
    const dir = tmpRoots.pop();
    await chmodTreeWritable(dir).catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
  }
});

async function chmodTreeWritable(target) {
  await chmod(target, 0o700).catch(() => undefined);
}

async function loadConfigModule() {
  return import(pathToFileURL(configPath).href);
}

function resultTokens(result) {
  if (typeof result === "number") return result;
  if (result && typeof result === "object") {
    return result.tokens ?? result.boundaryTokens ?? result.boundary ?? result.value;
  }
  return undefined;
}

function resultWarning(result) {
  if (result && typeof result === "object") {
    return result.warning ?? result.message ?? result.error ?? result.reason;
  }
  return undefined;
}

async function makeStore(filePath) {
  const mod = await loadConfigModule();

  if (typeof mod.createSmartBoundaryConfig === "function") {
    const store = mod.createSmartBoundaryConfig({ configPath: filePath, path: filePath });
    return normalizeStore(store, filePath);
  }

  if (typeof mod.createConfigStore === "function") {
    const store = mod.createConfigStore({ configPath: filePath, path: filePath });
    return normalizeStore(store, filePath);
  }

  if (typeof mod.readSmartBoundaryConfig === "function" && typeof mod.writeSmartBoundaryConfig === "function") {
    return {
      read: () => mod.readSmartBoundaryConfig({ configPath: filePath, path: filePath }),
      write: (tokens) => mod.writeSmartBoundaryConfig(tokens, { configPath: filePath, path: filePath }),
      reset: () => mod.resetSmartBoundaryConfig?.({ configPath: filePath, path: filePath }),
    };
  }

  throw new TypeError("config module must expose a test-path-overridable smart-boundary config store");
}

function normalizeStore(store, filePath) {
  assert.ok(store && typeof store === "object", "config factory should return a store object");
  const read = store.read ?? store.get ?? store.getBoundary ?? store.readBoundary;
  const write = store.write ?? store.set ?? store.setBoundary ?? store.writeBoundary;
  const reset = store.reset ?? store.remove ?? store.resetBoundary ?? store.clear;

  assert.equal(typeof read, "function", "config store must expose a read/get operation");
  assert.equal(typeof write, "function", "config store must expose a write/set operation");
  assert.equal(typeof reset, "function", "config store must expose a reset/remove operation");

  return {
    read: () => read.call(store, { configPath: filePath, path: filePath }),
    write: (tokens) => write.call(store, tokens, { configPath: filePath, path: filePath }),
    reset: () => reset.call(store, { configPath: filePath, path: filePath }),
  };
}

describe("U2 smart-boundary global config", () => {
  it("falls back to the 100000-token default when the config file is missing", async () => {
    const filePath = await makeTempConfigPath();
    const store = await makeStore(filePath);

    const read = await store.read();

    assert.equal(resultTokens(read), 100_000);
  });

  it("persists a custom boundary and reloads it through a new store instance", async () => {
    const filePath = await makeTempConfigPath();
    const firstStore = await makeStore(filePath);
    await firstStore.write(120_000);

    const secondStore = await makeStore(filePath);
    const reloaded = await secondStore.read();

    assert.equal(resultTokens(reloaded), 120_000);
    const onDisk = await readFile(filePath, "utf8");
    assert.match(onDisk, /120000/, "custom boundary should be written to the extension-owned config file");
  });

  it("reset removes the custom boundary and returns future reads to the default", async () => {
    const filePath = await makeTempConfigPath();
    const store = await makeStore(filePath);
    await store.write(120_000);

    await store.reset();
    const read = await store.read();

    assert.equal(resultTokens(read), 100_000);
  });

  it("falls back to default with a warning for corrupt config content", async () => {
    const filePath = await makeTempConfigPath();
    await writeFile(filePath, "{ this is not json", "utf8");
    const store = await makeStore(filePath);

    const read = await store.read();

    assert.equal(resultTokens(read), 100_000);
    assert.ok(String(resultWarning(read) ?? "").trim().length > 0, "corrupt config fallback should surface a warning/reason");
  });

  it("falls back to default with a warning when the configured path cannot be read as a file", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "pi-smart-compact-u2-unreadable-"));
    tmpRoots.push(dir);
    const unreadablePath = path.join(dir, "config-as-directory");
    await mkdir(unreadablePath);
    const store = await makeStore(unreadablePath);

    const read = await store.read();

    assert.equal(resultTokens(read), 100_000);
    assert.ok(String(resultWarning(read) ?? "").trim().length > 0, "unreadable config fallback should surface a warning/reason");
  });
});
