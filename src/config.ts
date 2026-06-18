import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import nodePath from "node:path";

import { DEFAULT_SMART_BOUNDARY_TOKENS, PACKAGE_NAME } from "./constants.js";

export const SMART_BOUNDARY_CONFIG_ENV = "PI_SMART_COMPACT_CONFIG_PATH";

export interface SmartBoundaryConfigOptions {
  configPath?: string;
  path?: string;
}

export interface SmartBoundaryConfigReadResult {
  tokens: number;
  boundaryTokens: number;
  source: "default" | "custom";
  warning?: string;
}

export interface SmartBoundaryConfigStore {
  read(options?: SmartBoundaryConfigOptions): Promise<SmartBoundaryConfigReadResult>;
  write(tokens: number, options?: SmartBoundaryConfigOptions): Promise<SmartBoundaryConfigReadResult>;
  reset(options?: SmartBoundaryConfigOptions): Promise<SmartBoundaryConfigReadResult>;
}

interface OnDiskSmartBoundaryConfig {
  smartBoundaryTokens?: unknown;
  boundaryTokens?: unknown;
  tokens?: unknown;
}

export function createSmartBoundaryConfig(options: SmartBoundaryConfigOptions = {}): SmartBoundaryConfigStore {
  return {
    read: (overrideOptions = {}) => readSmartBoundaryConfig(mergeOptions(options, overrideOptions)),
    write: (tokens, overrideOptions = {}) => writeSmartBoundaryConfig(tokens, mergeOptions(options, overrideOptions)),
    reset: (overrideOptions = {}) => resetSmartBoundaryConfig(mergeOptions(options, overrideOptions)),
  };
}

export const createConfigStore = createSmartBoundaryConfig;

export async function readSmartBoundaryConfig(
  options: SmartBoundaryConfigOptions = {},
): Promise<SmartBoundaryConfigReadResult> {
  const filePath = resolveSmartBoundaryConfigPath(options);

  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as OnDiskSmartBoundaryConfig;
    const tokens = extractBoundaryTokens(parsed);

    if (tokens === undefined) {
      return defaultResult(`Could not read smart-boundary config at ${filePath}: missing a positive whole-number boundary.`);
    }

    return { tokens, boundaryTokens: tokens, source: "custom" };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return defaultResult();
    }

    return defaultResult(`Could not read smart-boundary config at ${filePath}: ${errorMessage(error)}. Using default.`);
  }
}

export async function writeSmartBoundaryConfig(
  tokens: number,
  options: SmartBoundaryConfigOptions = {},
): Promise<SmartBoundaryConfigReadResult> {
  assertPositiveWholeTokens(tokens);

  const filePath = resolveSmartBoundaryConfigPath(options);
  await mkdir(nodePath.dirname(filePath), { recursive: true });

  const tempPath = nodePath.join(
    nodePath.dirname(filePath),
    `${nodePath.basename(filePath)}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`,
  );
  const payload = `${JSON.stringify({ smartBoundaryTokens: tokens }, null, 2)}\n`;

  try {
    await writeFile(tempPath, payload, "utf8");
    await rename(tempPath, filePath);
  } catch (error) {
    await unlink(tempPath).catch(() => undefined);
    throw error;
  }

  return { tokens, boundaryTokens: tokens, source: "custom" };
}

export async function resetSmartBoundaryConfig(
  options: SmartBoundaryConfigOptions = {},
): Promise<SmartBoundaryConfigReadResult> {
  const filePath = resolveSmartBoundaryConfigPath(options);

  try {
    await unlink(filePath);
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") {
      return defaultResult(`Could not remove smart-boundary config at ${filePath}: ${errorMessage(error)}. Using default.`);
    }
  }

  return defaultResult();
}

export function resolveSmartBoundaryConfigPath(options: SmartBoundaryConfigOptions = {}): string {
  return (
    options.configPath ??
    options.path ??
    process.env[SMART_BOUNDARY_CONFIG_ENV] ??
    nodePath.join(process.env.XDG_CONFIG_HOME ?? nodePath.join(os.homedir(), ".config"), PACKAGE_NAME, "config.json")
  );
}

function mergeOptions(
  base: SmartBoundaryConfigOptions,
  override: SmartBoundaryConfigOptions,
): SmartBoundaryConfigOptions {
  return { ...base, ...override };
}

function extractBoundaryTokens(config: OnDiskSmartBoundaryConfig): number | undefined {
  if (!config || typeof config !== "object") {
    return undefined;
  }

  const candidate = config.smartBoundaryTokens ?? config.boundaryTokens ?? config.tokens;
  return isPositiveWholeNumber(candidate) ? candidate : undefined;
}

function assertPositiveWholeTokens(tokens: number): void {
  if (!isPositiveWholeNumber(tokens)) {
    throw new RangeError("Smart boundary must be a positive whole-number token count.");
  }
}

function isPositiveWholeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function defaultResult(warning?: string): SmartBoundaryConfigReadResult {
  return {
    tokens: DEFAULT_SMART_BOUNDARY_TOKENS,
    boundaryTokens: DEFAULT_SMART_BOUNDARY_TOKENS,
    source: "default",
    ...(warning ? { warning } : {}),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
