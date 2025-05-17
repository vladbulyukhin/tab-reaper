import type { IBrowserApiProvider } from "../../api/IBrowserApiProvider";
import type {
  Message,
  MessagePayloads,
  MessageResponses,
  MessageTypes,
} from "../models/Message";

export type CleanUp = () => void;

type MessageCallback<M extends MessageTypes> = (
  payload: MessagePayloads[M],
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: MessageResponses[M]) => void
) => void;

export interface IMessageService {
  listen(): CleanUp;
  onMessage<K extends MessageTypes>(
    type: K,
    callback: MessageCallback<K>
  ): CleanUp;
  sendMessage<K extends MessageTypes>(
    type: K,
    payload: MessagePayloads[K]
  ): Promise<MessageResponses[K]>;
}

export class MessageService implements IMessageService {
  // biome-ignore lint/suspicious/noExplicitAny: allows any type of callback
  private listeners: Map<MessageTypes, Set<MessageCallback<any>>> = new Map();

  constructor(
    private readonly browserApiProvider: Pick<IBrowserApiProvider, "runtime">
  ) {
    this.sendMessage = this.sendMessage.bind(this);
  }

  public listen(): CleanUp {
    const listener = (
      message: Message,
      sender: chrome.runtime.MessageSender,
      sendResponse: () => void
    ) => {
      const callbacks = this.listeners.get(message.type) ?? new Set();

      for (const callback of callbacks) {
        callback(message?.payload, sender, sendResponse);
      }

      return true;
    };

    this.browserApiProvider.runtime.onMessage.addListener(listener);

    return () => {
      this.browserApiProvider.runtime.onMessage.removeListener(listener);
    };
  }

  public onMessage<K extends MessageTypes>(
    type: K,
    callback: (
      payload: MessagePayloads[K],
      sender: chrome.runtime.MessageSender,
      sendResponse: (response: MessageResponses[K]) => void
    ) => void
  ): CleanUp {
    const currentListeners = this.listeners.get(type) ?? new Set();
    this.listeners.set(type, new Set([...currentListeners, callback]));

    return () => {
      this.listeners.set(
        type,
        new Set([...currentListeners].filter((cb) => cb !== callback))
      );
    };
  }

  public async sendMessage<K extends MessageTypes>(
    type: K,
    payload: MessagePayloads[K]
  ): Promise<MessageResponses[K]> {
    return await this.browserApiProvider.runtime.sendMessage({ type, payload });
  }
}
