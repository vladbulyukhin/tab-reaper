import type React from "react";
import { useContext, useEffect, useState } from "react";
import { Label } from "../../../components/Label";
import { Switch } from "../../../components/Switch";
import { BackgroundCommunicationContext } from "../../../contexts/BackgroundCommunication";

export const CurrentTabStatus: React.FC = () => {
  const { sendMessage } = useContext(BackgroundCommunicationContext);
  const [excluded, setExcluded] = useState<boolean>(false);

  useEffect(() => {
    sendMessage?.("isCurrentTabExcluded", undefined).then((excluded) => {
      setExcluded(excluded);
    });
  }, [sendMessage]);

  const toggleExcluded = (value: boolean) => {
    sendMessage?.("setCurrentTabExcluded", { excluded: !value }).then(
      ({ status }) => {
        if (status === "ok") {
          setExcluded(!value);
        }
      },
    );
  };

  return (
    <div className="px-3 py-4 border-b">
      <div className="flex flex-row items-center justify-between gap-20">
        <div className="flex flex-col gap-1">
          <Label>Enabled for current tab</Label>
          <p className="text-sm text-muted-foreground">
            Temporarily disable the extension for current tab.
          </p>
        </div>
        <Switch checked={!excluded} onCheckedChange={toggleExcluded} />
      </div>
    </div>
  );
};

CurrentTabStatus.displayName = "CurrentTabStatus";
