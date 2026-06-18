export interface PendingSmartCompactionState {
  id: string;
  handoff: string;
  startedAt: number;
  status: "pending" | "expired";
}

export interface SmartCompactRuntimeState {
  highestEscalationBandSent: number;
  activeBoundaryTokens?: number;
  pendingSmartCompaction?: PendingSmartCompactionState;
  nextPendingSmartCompactionId: number;
}

export function createSmartCompactRuntimeState(): SmartCompactRuntimeState {
  return { highestEscalationBandSent: -1, nextPendingSmartCompactionId: 1 };
}

export function resetEscalationState(state: SmartCompactRuntimeState): void {
  state.highestEscalationBandSent = -1;
  state.activeBoundaryTokens = undefined;
}

export function syncEscalationBoundary(state: SmartCompactRuntimeState, boundaryTokens: number): void {
  if (state.activeBoundaryTokens !== boundaryTokens) {
    state.highestEscalationBandSent = -1;
    state.activeBoundaryTokens = boundaryTokens;
  }
}

export function markEscalationBandSent(state: SmartCompactRuntimeState, band: number): void {
  state.highestEscalationBandSent = band;
}

export function getPendingSmartCompaction(state: SmartCompactRuntimeState): PendingSmartCompactionState | undefined {
  return state.pendingSmartCompaction?.status === "pending" ? state.pendingSmartCompaction : undefined;
}

export function beginPendingSmartCompaction(
  state: SmartCompactRuntimeState,
  handoff: string,
): PendingSmartCompactionState | undefined {
  if (getPendingSmartCompaction(state)) {
    return undefined;
  }

  const pending: PendingSmartCompactionState = {
    id: `smart-compact-${state.nextPendingSmartCompactionId}`,
    handoff,
    startedAt: Date.now(),
    status: "pending",
  };
  state.nextPendingSmartCompactionId += 1;
  state.pendingSmartCompaction = pending;
  return pending;
}

export function expirePendingSmartCompaction(state: SmartCompactRuntimeState, id?: string): void {
  const pending = state.pendingSmartCompaction;
  if (!pending || (id !== undefined && pending.id !== id)) {
    return;
  }

  pending.status = "expired";
  state.pendingSmartCompaction = undefined;
}

export function clearPendingSmartCompaction(state: SmartCompactRuntimeState, id?: string): void {
  const pending = state.pendingSmartCompaction;
  if (!pending || (id !== undefined && pending.id !== id)) {
    return;
  }

  state.pendingSmartCompaction = undefined;
}
