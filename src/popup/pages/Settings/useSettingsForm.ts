import { zodResolver } from "@hookform/resolvers/zod";
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { chromeApiProvider } from "../../../api/chromeApiProvider";
import { extensionApiType } from "../../../api/extensionApi";
import { emptyConfiguration } from "../../../common/models/Configuration";
import { BackgroundCommunicationContext } from "../../contexts/BackgroundCommunication";
import { useAsyncResource } from "../../hooks/useAsyncResource";
import { type SaveStatus, SettingsAutosave } from "./SettingsAutosave";

const formSchema = z.object({
  diagnosticsEnabled: z.boolean(),
  keepAudibleTabs: z.boolean(),
  keepGroupedTabs: z.boolean(),
  keepPinnedTabs: z.boolean(),
  rememberRecentlyClosedTabs: z.boolean(),
  removeExactDuplicates: z.boolean(),
  tabCountThreshold: z.coerce.number().int().min(0),
  tabRemovalDelayMin: z.coerce.number().positive(),
});

type SettingsState = { diagnosticsEnabled: boolean; saveStatus: SaveStatus };
type SettingsAction =
  | { type: "loaded"; diagnosticsEnabled: boolean }
  | { type: "confirmed"; diagnosticsEnabled: boolean }
  | { type: "save-status"; status: SaveStatus };

function settingsReducer(
  state: SettingsState,
  action: SettingsAction,
): SettingsState {
  switch (action.type) {
    case "loaded":
      return {
        diagnosticsEnabled: action.diagnosticsEnabled,
        saveStatus: "idle",
      };
    case "confirmed":
      return { ...state, diagnosticsEnabled: action.diagnosticsEnabled };
    case "save-status":
      return { ...state, saveStatus: action.status };
  }
}

export function useSettingsForm() {
  const { sendMessage } = useContext(BackgroundCommunicationContext);
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: emptyConfiguration,
  });
  const [state, dispatch] = useReducer(settingsReducer, {
    diagnosticsEnabled: emptyConfiguration.diagnosticsEnabled,
    saveStatus: "idle",
  });
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    if (!sendMessage) throw new Error("Background is unavailable");
    return sendMessage("getConfig", undefined);
  }, [sendMessage]);
  const resource = useAsyncResource(sendMessage ? load : null);
  const loaded = resource.data !== null;

  useEffect(() => {
    if (!resource.data) return;
    form.reset(resource.data);
    dispatch({
      type: "loaded",
      diagnosticsEnabled: resource.data.diagnosticsEnabled,
    });
  }, [resource.data, form.reset]);

  const autosave = useMemo(
    () =>
      new SettingsAutosave<z.infer<typeof formSchema>>(
        async (values) => {
          if (!sendMessage) throw new Error("Background is unavailable");
          return sendMessage("setConfig", values);
        },
        (values) => {
          if (mounted.current)
            dispatch({
              type: "confirmed",
              diagnosticsEnabled: values.diagnosticsEnabled,
            });
        },
        (status) => {
          if (mounted.current) dispatch({ type: "save-status", status });
        },
      ),
    [sendMessage],
  );

  const onSubmit = useCallback(
    (values: z.infer<typeof formSchema>) => {
      if (loaded) void autosave.save(values);
    },
    [autosave, loaded],
  );

  useEffect(() => {
    const subscription = form.watch((_, meta) => {
      if (meta.type) void form.handleSubmit(onSubmit)();
    });
    return () => subscription.unsubscribe();
  }, [form.watch, form.handleSubmit, onSubmit]);

  const loadGroups = useCallback(async () => {
    const tabs = await chromeApiProvider.tab.query({ currentWindow: true });
    return (
      Array.isArray(tabs) && tabs.some((tab) => typeof tab.groupId === "number")
    );
  }, []);
  const groups = useAsyncResource(
    extensionApiType === "chrome" ? null : loadGroups,
  );

  function retry() {
    if (loaded) void form.handleSubmit(onSubmit)();
    else void resource.refresh().catch(() => undefined);
  }

  return {
    form,
    loaded,
    onSubmit,
    retry,
    diagnosticsEnabled: state.diagnosticsEnabled,
    saveStatus: resource.error ? ("error" as const) : state.saveStatus,
    supportsTabGrouping: extensionApiType === "chrome" || groups.data === true,
  };
}
