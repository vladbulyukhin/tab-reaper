import { type RefObject, useContext, useEffect } from "react";
import { BackgroundCommunicationContext } from "../../../contexts/BackgroundCommunication";

// Acknowledge only the loaded snapshot, and only when history is actually visible.
// New closures after this token remain unread, even if acknowledgement arrives late.
export function useHistoryAcknowledgement(
  historyContent: RefObject<HTMLDivElement>,
  activityToken: number | undefined,
) {
  const { sendMessage } = useContext(BackgroundCommunicationContext);
  // Ref contents are read after mount; adding .current as a dependency does not
  // subscribe to DOM replacement. The snapshot token owns this observation.
  // biome-ignore lint/correctness/useExhaustiveDependencies: stable ref is read after commit
  useEffect(() => {
    if (!historyContent.current || activityToken === undefined || !sendMessage)
      return;
    let visible = false;
    let acknowledged = false;
    const acknowledge = () => {
      if (!visible || document.visibilityState !== "visible" || acknowledged)
        return;
      acknowledged = true;
      void sendMessage("acknowledgeRecentlyClosedTabs", { activityToken })
        .then((result) => {
          if (result.status !== "ok") acknowledged = false;
        })
        .catch(() => {
          acknowledged = false;
        });
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      acknowledge();
    });
    observer.observe(historyContent.current);
    document.addEventListener("visibilitychange", acknowledge);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", acknowledge);
    };
  }, [activityToken, sendMessage]);
}
