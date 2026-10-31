import type { IBrowserApiProvider } from "../../api/IBrowserApiProvider";
import type {
  Message,
  MessagePayloads,
  MessageResponses,
  MessageTypes,
  RuntimeMessage,
} from "../models/Message";

export type CleanUp = () => void;

type MessageCallback<M extends MessageTypes> = (
  payload: MessagePayloads[M],
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: MessageResponses[M]) => void,
) => void | Promise<void>;

const transportErrorMarker = "__tabReaperMessageServiceTransportError";
const fallbackHandlerErrorMessage = "Message handler failed";

type TransportError = {
  [transportErrorMarker]: true;
  message: string;
};

function isTransportError(response: unknown): response is TransportError {
  return (
    typeof response === "object" &&
    response !== null &&
    (response as Record<string, unknown>)[transportErrorMarker] === true &&
    typeof (response as Record<string, unknown>).message === "string"
  );
}

function normalizeHandlerError(error: unknown): string {
  try {
    return error instanceof Error ? error.message : String(error);
  } catch {
    return fallbackHandlerErrorMessage;
  }
}

export interface IMessageService {
  listen(): CleanUp;
  onMessage<K extends MessageTypes>(
    type: K,
    callback: MessageCallback<K>,
  ): CleanUp;
  sendMessage<K extends MessageTypes>(
    type: K,
    payload: MessagePayloads[K],
  ): Promise<MessageResponses[K]>;
}

export class MessageService implements IMessageService {
  // Request/response messages have exactly one owner, unlike broadcast events.
  // biome-ignore lint/suspicious/noExplicitAny: allows any type of callback
  private listeners: Map<MessageTypes, MessageCallback<any>> = new Map();
  private runtimeListener?: (
    message: Message | RuntimeMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ) => boolean;

  constructor(
    private readonly browserApiProvider: Pick<IBrowserApiProvider, "runtime">,
  ) {
    this.sendMessage = this.sendMessage.bind(this);
  }

  public listen(): CleanUp {
    if (this.runtimeListener) {
      return () => this.removeRuntimeListener();
    }

    this.runtimeListener = (
      message: Message | RuntimeMessage,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response?: unknown) => void,
    ) => {
      const messageType = message?.type;

      if (!messageType || typeof messageType !== "string") {
        return false;
      }
      const callback = this.listeners.get(messageType as MessageTypes);

      if (!callback) {
        return false;
      }

      let handlerCompleted = false;
      let responseSent = false;
      let bufferedResponse: unknown;
      let hasBufferedResponse = false;

      function sendBufferedResponse() {
        if (!hasBufferedResponse || responseSent) return;
        responseSent = true;
        sendResponse(bufferedResponse);
      }

      function respond(response: unknown) {
        if (hasBufferedResponse || responseSent) return;
        bufferedResponse = response;
        hasBufferedResponse = true;
        if (handlerCompleted) {
          sendBufferedResponse();
        }
      }

      function sendTransportError(error: unknown) {
        if (responseSent) return;
        responseSent = true;
        sendResponse({
          [transportErrorMarker]: true,
          message: normalizeHandlerError(error),
        });
      }

      try {
        const result = callback(
          message.payload as never,
          sender,
          respond as never,
        );
        if (result) {
          void result.then(() => {
            handlerCompleted = true;
            sendBufferedResponse();
          }, sendTransportError);
        } else {
          handlerCompleted = true;
          sendBufferedResponse();
        }
      } catch (error) {
        sendTransportError(error);
      }

      return true;
    };

    this.browserApiProvider.runtime.onMessage.addListener(this.runtimeListener);

    return () => this.removeRuntimeListener();
  }

  public onMessage<K extends MessageTypes>(
    type: K,
    callback: (
      payload: MessagePayloads[K],
      sender: chrome.runtime.MessageSender,
      sendResponse: (response: MessageResponses[K]) => void,
    ) => void | Promise<void>,
  ): CleanUp {
    if (this.listeners.has(type)) {
      throw new Error(`A handler is already registered for ${type}`);
    }
    this.listeners.set(type, callback);

    return () => {
      if (this.listeners.get(type) === callback) {
        this.listeners.delete(type);
      }
    };
  }

  public async sendMessage<K extends MessageTypes>(
    type: K,
    payload: MessagePayloads[K],
  ): Promise<MessageResponses[K]> {
    const response: MessageResponses[K] =
      await this.browserApiProvider.runtime.sendMessage({ type, payload });
    if (isTransportError(response)) {
      throw new Error(response.message);
    }
    return response;
  }

  private removeRuntimeListener(): void {
    if (!this.runtimeListener) return;
    this.browserApiProvider.runtime.onMessage.removeListener(
      this.runtimeListener,
    );
    this.runtimeListener = undefined;
  }
}
