import type {
  IBrowserAlarmAPI,
  IBrowserApiProvider,
  IBrowserExtensionActionAPI,
  IBrowserRuntimeAPI,
  IBrowserStorageAPI,
  IBrowserTabAPI,
} from "./IBrowserApiProvider";
import {
  type ResolvedExtensionApi,
  extensionApi,
  extensionApiType,
} from "./extensionApi";

type ApiMethod = (...args: unknown[]) => unknown;

const asApiMethod = (method: unknown): ApiMethod | undefined =>
  typeof method === "function" ? (method as ApiMethod) : undefined;

const callApi = <T>(
  resolved: ResolvedExtensionApi,
  context: unknown,
  method: unknown,
  args: unknown[],
  expectsCallback = true,
): Promise<T> => {
  const fn = asApiMethod(method);
  if (!fn) return Promise.resolve(undefined as T);

  if (resolved.type === "browser") {
    return Promise.resolve().then(() => fn.apply(context, args) as T);
  }

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const settle = (handler: () => void) => {
      if (settled) return;
      settled = true;
      handler();
    };

    const callback = (result: T) => {
      const lastError = resolved.api.runtime?.lastError;
      if (lastError) {
        settle(() =>
          reject(new Error(lastError.message ?? "Browser API failed")),
        );
        return;
      }
      settle(() => resolve(result));
    };

    let returned: unknown;
    try {
      returned = fn.apply(
        context,
        expectsCallback ? [...args, callback] : args,
      );
    } catch (error) {
      settle(() => reject(error));
      return;
    }

    if (returned && typeof (returned as Promise<T>).then === "function") {
      (returned as Promise<T>).then(
        (result) => settle(() => resolve(result)),
        (error) => settle(() => reject(error)),
      );
      return;
    }

    if (!expectsCallback) settle(() => resolve(undefined as T));
  });
};

const eventOrUndefined = <T>(event: T | undefined): T => event as T;

const createStorageApi = (
  resolved: ResolvedExtensionApi,
  storageArea: unknown,
): IBrowserStorageAPI => {
  const area = storageArea as { [key: string]: unknown } | undefined;

  return {
    clear: () => callApi(resolved, area, area?.clear, []),
    get: (keys) => callApi(resolved, area, area?.get, [keys]),
    onChanged: eventOrUndefined<chrome.storage.StorageChangedEvent>(
      area?.onChanged as chrome.storage.StorageChangedEvent | undefined,
    ),
    remove: (keys) => callApi(resolved, area, area?.remove, [keys]),
    set: (items) => callApi(resolved, area, area?.set, [items]),
  };
};

type StorageChangeListener = (
  changes: Record<string, chrome.storage.StorageChange>,
  areaName: string,
) => void;

const createMemoryStorageApi = (): IBrowserStorageAPI => {
  const values = new Map<string, unknown>();
  const listeners = new Set<StorageChangeListener>();

  const emitChanges = (
    changes: Record<string, chrome.storage.StorageChange>,
  ) => {
    if (Object.keys(changes).length === 0) return;
    for (const listener of listeners) listener(changes, "session");
  };

  const onChanged = {
    addListener: (listener: StorageChangeListener) => listeners.add(listener),
    hasListener: (listener: StorageChangeListener) => listeners.has(listener),
    hasListeners: () => listeners.size > 0,
    removeListener: (listener: StorageChangeListener) =>
      listeners.delete(listener),
  } as unknown as chrome.storage.StorageChangedEvent;

  return {
    async clear() {
      const changes: Record<string, chrome.storage.StorageChange> = {};
      for (const [key, oldValue] of values) {
        changes[key] = { oldValue, newValue: undefined };
      }
      values.clear();
      emitChanges(changes);
    },
    async get<T>(keys?: T): Promise<T> {
      if (keys == null) {
        return Object.fromEntries(values) as T;
      }

      if (typeof keys === "string") {
        return (values.has(keys) ? { [keys]: values.get(keys) } : {}) as T;
      }

      if (Array.isArray(keys)) {
        return Object.fromEntries(
          keys
            .filter((key): key is string => typeof key === "string")
            .filter((key) => values.has(key))
            .map((key) => [key, values.get(key)]),
        ) as T;
      }

      if (typeof keys === "object") {
        const result = { ...keys } as Record<string, unknown>;
        for (const key of Object.keys(result)) {
          if (values.has(key)) result[key] = values.get(key);
        }
        return result as T;
      }

      return {} as T;
    },
    onChanged,
    async remove(keys) {
      const changes: Record<string, chrome.storage.StorageChange> = {};
      for (const key of typeof keys === "string" ? [keys] : keys) {
        if (!values.has(key)) continue;
        changes[key] = { oldValue: values.get(key), newValue: undefined };
        values.delete(key);
      }
      emitChanges(changes);
    },
    async set(items) {
      const changes: Record<string, chrome.storage.StorageChange> = {};
      for (const [key, newValue] of Object.entries(items)) {
        const oldValue = values.get(key);
        if (values.has(key) && Object.is(oldValue, newValue)) continue;
        changes[key] = { oldValue, newValue };
        values.set(key, newValue);
      }
      emitChanges(changes);
    },
  };
};

export function createBrowserApiProvider(
  resolved: ResolvedExtensionApi,
): IBrowserApiProvider {
  const api = resolved.api;
  const action = api.action ?? api.browserAction;
  const storage = api.storage;
  const localStorage = storage?.local;
  const syncStorage = storage?.sync ?? localStorage;
  // Older Safari workers intentionally lose transient state on restart rather
  // than inheriting stale tab IDs from durable local storage.
  const sessionStorage = storage?.session
    ? createStorageApi(resolved, storage.session)
    : createMemoryStorageApi();

  const actionApi: IBrowserExtensionActionAPI = {
    setBadgeBackgroundColor: (details) =>
      callApi(resolved, action, action?.setBadgeBackgroundColor, [details]),
    setBadgeText: (details) =>
      callApi(resolved, action, action?.setBadgeText, [details]),
    setBadgeTextColor: (details) =>
      callApi(resolved, action, action?.setBadgeTextColor, [details]),
    setIcon: (details) => callApi(resolved, action, action?.setIcon, [details]),
    setTitle: (details) =>
      callApi(resolved, action, action?.setTitle, [details]),
  };

  const alarmApi: IBrowserAlarmAPI = {
    clear: (name) => callApi(resolved, api.alarms, api.alarms?.clear, [name]),
    create: (name, alarmInfo) =>
      callApi(
        resolved,
        api.alarms,
        api.alarms?.create,
        [name, alarmInfo],
        false,
      ),
    getAll: () => callApi(resolved, api.alarms, api.alarms?.getAll, []),
    onAlarm: eventOrUndefined(api.alarms?.onAlarm),
  };

  const runtimeApi: IBrowserRuntimeAPI = {
    onInstalled: eventOrUndefined(api.runtime?.onInstalled),
    onMessage: eventOrUndefined(api.runtime?.onMessage),
    onStartup: eventOrUndefined(api.runtime?.onStartup),
    sendMessage: (message) =>
      callApi(resolved, api.runtime, api.runtime?.sendMessage, [message]),
  };

  const tabApi: IBrowserTabAPI = {
    create: (createProperties) =>
      callApi(resolved, api.tabs, api.tabs?.create, [createProperties]),
    get: (tabId) => callApi(resolved, api.tabs, api.tabs?.get, [tabId]),
    onActivated: eventOrUndefined(api.tabs?.onActivated),
    onCreated: eventOrUndefined(api.tabs?.onCreated),
    onRemoved: eventOrUndefined(api.tabs?.onRemoved),
    onUpdated: eventOrUndefined(api.tabs?.onUpdated),
    query: (queryInfo) =>
      callApi(resolved, api.tabs, api.tabs?.query, [queryInfo]),
    remove: (tabId) => callApi(resolved, api.tabs, api.tabs?.remove, [tabId]),
    sendMessage: (tabId, message) =>
      callApi(resolved, api.tabs, api.tabs?.sendMessage, [tabId, message]),
  };

  return {
    action: actionApi,
    alarm: alarmApi,
    localStorage: createStorageApi(resolved, localStorage),
    runtime: runtimeApi,
    sessionStorage,
    sessionStorageKind: storage?.session ? "native" : "memory-fallback",
    syncStorage: createStorageApi(resolved, syncStorage),
    tab: tabApi,
  };
}

export const chromeApiProvider = createBrowserApiProvider({
  api: extensionApi,
  type: extensionApiType,
});
