// Persist a handful of small UI preferences across page reloads.
//
// Used (opt-in via the `persist` option) to remember whether the formatting
// toolbar is expanded and whether the outline panel is open. All values live
// under a single localStorage key as one JSON blob, so a host can namespace
// several editors by passing distinct keys. Every access is guarded: when
// storage is unavailable (private mode, disabled, non-browser host) it silently
// degrades to no persistence.

export interface Prefs {
  /** The stored value for `name`, or undefined when absent / unreadable. */
  get(name: string): unknown;
  set(name: string, value: unknown): void;
}

export function createPrefs(key: string): Prefs {
  const read = (): Record<string, unknown> => {
    try {
      const raw = globalThis.localStorage?.getItem(key);
      return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  };
  return {
    get(name) {
      return read()[name];
    },
    set(name, value) {
      try {
        const data = read();
        data[name] = value;
        globalThis.localStorage?.setItem(key, JSON.stringify(data));
      } catch {
        // Storage unavailable: skip persistence rather than throw.
      }
    },
  };
}
