/**
 * Reusable mock for pi extension tests.
 * Captures public extension API registrations and session interactions without
 * invoking a real pi runtime, provider, or LLM session.
 */
export function createMockPi() {
  const state = {
    commands: new Map(),
    tools: new Map(),
    handlers: new Map(),
    sentUserMessages: [],
    notifications: [],
    compactCalls: [],
    replacementSessionCalls: [],
  };

  const pi = {
    registerCommand(name, definition) {
      state.commands.set(name, definition);
    },
    registerTool(definition) {
      state.tools.set(definition?.name, definition);
    },
    on(eventName, handler) {
      const handlers = state.handlers.get(eventName) ?? [];
      handlers.push(handler);
      state.handlers.set(eventName, handlers);
    },
    async sendUserMessage(message, options = {}) {
      state.sentUserMessages.push({ message, options });
    },
    // These APIs are intentionally tracked as forbidden for pi-smart-compact's
    // same-session contract. Tests can assert the array remains empty.
    async newSession(...args) {
      state.replacementSessionCalls.push({ api: "newSession", args });
    },
    async fork(...args) {
      state.replacementSessionCalls.push({ api: "fork", args });
    },
    async switchSession(...args) {
      state.replacementSessionCalls.push({ api: "switchSession", args });
    },
  };

  function createContext(overrides = {}) {
    const ctx = {
      ui: {
        notify(message, level = "info") {
          state.notifications.push({ message, level });
        },
      },
      async compact(...args) {
        state.compactCalls.push(args);
        return undefined;
      },
      async getContextUsage() {
        return undefined;
      },
      ...overrides,
    };
    return ctx;
  }

  async function trigger(eventName, event = {}, ctx = createContext()) {
    const results = [];
    for (const handler of state.handlers.get(eventName) ?? []) {
      results.push(await handler(event, ctx));
    }
    return results;
  }

  return { pi, state, createContext, trigger };
}
