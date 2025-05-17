import React, { useEffect, useMemo, useState } from "react";
import { chromeApiProvider } from "../../../api/chromeApiProvider";
import {
  type IMessageService,
  MessageService,
} from "../../../common/services/MessageService";

interface IBackgroundCommunicationValue {
  readonly sendMessage: IMessageService["sendMessage"] | null;
}

const defaultValue: IBackgroundCommunicationValue = {
  sendMessage: null,
};

export const BackgroundCommunicationContext =
  React.createContext<IBackgroundCommunicationValue>(defaultValue);

export const BackgroundCommunicationProvider: React.FC<
  React.PropsWithChildren
> = ({ children }) => {
  const [messageService] = useState(new MessageService(chromeApiProvider));

  useEffect(() => {
    const cleanUp = messageService.listen();
    return () => cleanUp();
  }, [messageService]);

  const value = useMemo(
    () => ({ sendMessage: messageService.sendMessage }),
    [messageService],
  );

  return (
    <BackgroundCommunicationContext.Provider value={value}>
      {children}
    </BackgroundCommunicationContext.Provider>
  );
};

BackgroundCommunicationProvider.displayName = "BackgroundCommunicationProvider";
