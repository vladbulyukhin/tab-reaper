import type { Page } from "@playwright/test";

export const sendExtensionMessage = <T>(
  page: Page,
  type: string,
  payload: unknown,
): Promise<T> =>
  page.evaluate(
    ([messageType, messagePayload]) =>
      chrome.runtime.sendMessage({
        type: messageType,
        payload: messagePayload,
      }),
    [type, payload],
  );
