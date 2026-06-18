import { ESCALATION_INTERVAL_TOKENS } from "./constants.js";

export interface EscalationBandInput {
  tokens: number | null | undefined;
  boundaryTokens: number;
  intervalTokens?: number;
}

export function calculateEscalationBand({
  tokens,
  boundaryTokens,
  intervalTokens = ESCALATION_INTERVAL_TOKENS,
}: EscalationBandInput): number | undefined {
  if (!Number.isFinite(tokens) || tokens === null || tokens === undefined) {
    return undefined;
  }

  if (!Number.isSafeInteger(boundaryTokens) || boundaryTokens <= 0) {
    return undefined;
  }

  if (!Number.isSafeInteger(intervalTokens) || intervalTokens <= 0) {
    return undefined;
  }

  if (tokens < boundaryTokens) {
    return undefined;
  }

  return Math.floor((tokens - boundaryTokens) / intervalTokens);
}

export function isHigherEscalationBand(band: number | undefined, highestSentBand: number): band is number {
  return band !== undefined && Number.isInteger(band) && band > highestSentBand;
}
