import type { IBrowserStorageAPI } from "../../api/IBrowserApiProvider";

type Changes = Record<string, chrome.storage.StorageChange>;
type Listener = (changes: Changes) => void;

export type StorageContext = IBrowserStorageAPI & {
  // Delivers this context's queued change events, oldest first.
  deliver: (count?: number) => void;
};

// Test double: one storage area seen from several extension contexts (two
// installed copies, two Safari profiles). Change events queue per context and
// arrive only when the test delivers them, so they can be late or reordered.
export const createSharedStorage = () => {
  let values: Record<string, unknown> = {};
  const queues: Changes[][] = [];
  const announce = (changes: Changes) => {
    for (const queue of queues) queue.push(changes);
  };

  const context = (): StorageContext => {
    const listeners = new Set<Listener>();
    const queue: Changes[] = [];
    queues.push(queue);
    return {
      get: async () => structuredClone(values),
      set: async (items: Record<string, unknown>) => {
        const copied = structuredClone(items);
        const changes: Changes = {};
        for (const [key, newValue] of Object.entries(copied)) {
          changes[key] = { oldValue: values[key], newValue };
        }
        values = { ...values, ...copied };
        announce(structuredClone(changes));
      },
      remove: async (keys: string | string[]) => {
        const changes: Changes = {};
        for (const key of [keys].flat()) {
          if (!(key in values)) continue;
          changes[key] = { oldValue: values[key] };
          delete values[key];
        }
        announce(structuredClone(changes));
      },
      clear: async () => {
        values = {};
      },
      onChanged: {
        addListener: (listener: Listener) => listeners.add(listener),
        removeListener: (listener: Listener) => listeners.delete(listener),
        hasListener: (listener: Listener) => listeners.has(listener),
        hasListeners: () => listeners.size > 0,
      },
      deliver: (count = queue.length) => {
        for (const changes of queue.splice(0, count)) {
          for (const listener of listeners) listener(changes);
        }
      },
    } as unknown as StorageContext;
  };

  return { context, values: () => values };
};
