import { zodResolver } from "@hookform/resolvers/zod";
import type React from "react";
import { useCallback, useContext, useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { emptyConfiguration } from "../../../common/models/Configuration";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "../../components/Form";
import { Input } from "../../components/Input";
import { Switch } from "../../components/Switch";
import { BackgroundCommunicationContext } from "../../contexts/BackgroundCommunication";

const formSchema = z.object({
  keepAudibleTabs: z.boolean(),
  keepGroupedTabs: z.boolean(),
  keepPinnedTabs: z.boolean(),
  tabRemovalDelayMin: z.coerce.number().positive(),
});

export const Settings: React.FC = () => {
  const { sendMessage } = useContext(BackgroundCommunicationContext);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: async () => {
      const result = await sendMessage?.("getConfig", undefined);
      return result ?? emptyConfiguration;
    },
  });

  const onSubmit = useCallback(
    (values: z.infer<typeof formSchema>) => {
      sendMessage?.("setConfig", values);
    },
    [sendMessage],
  );

  useEffect(() => {
    const subscription = form.watch(() => form.handleSubmit(onSubmit)());
    return () => subscription.unsubscribe();
  }, [form.watch, form.handleSubmit, onSubmit]);

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="flex flex-col px-3 py-4 gap-4"
      >
        <FormField
          control={form.control}
          defaultValue={15}
          name="tabRemovalDelayMin"
          render={({ field }) => (
            <FormItem className="flex flex-row items-center justify-between gap-16">
              <div className="flex flex-col gap-1">
                <FormLabel>Inactivity period</FormLabel>
                <FormDescription>
                  The number of minutes since the tab was last active after
                  which the tab will be closed.
                </FormDescription>
                <FormMessage />
              </div>

              <FormControl>
                <Input
                  data-testid="tabRemovalDelayMin"
                  type="number"
                  className="w-20"
                  {...field}
                />
              </FormControl>
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="keepPinnedTabs"
          render={({ field }) => (
            <FormItem className="flex flex-row items-center justify-between gap-20">
              <div className="flex flex-col gap-1">
                <FormLabel>Ignore pinned tabs</FormLabel>
                <FormDescription>
                  Pinned tabs will not be closed even if they become idle.
                </FormDescription>
              </div>
              <FormControl>
                <Switch
                  data-testid="keepPinnedTabs"
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              </FormControl>
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="keepGroupedTabs"
          render={({ field }) => (
            <FormItem className="flex flex-row items-center justify-between gap-20">
              <div className="flex flex-col gap-1">
                <FormLabel>Ignore grouped tabs</FormLabel>
                <FormDescription>
                  Grouped tabs will not be closed even if they become idle.
                </FormDescription>
              </div>
              <FormControl>
                <Switch
                  data-testid="keepGroupedTabs"
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              </FormControl>
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="keepAudibleTabs"
          render={({ field }) => (
            <FormItem className="flex flex-row items-center justify-between gap-20">
              <div className="flex flex-col gap-1">
                <FormLabel>Ignore audible tabs</FormLabel>
                <FormDescription>
                  Tabs with audio will not be closed even if they become idle.
                </FormDescription>
              </div>
              <FormControl>
                <Switch
                  data-testid="keepAudibleTabs"
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              </FormControl>
            </FormItem>
          )}
        />
      </form>
    </Form>
  );
};

Settings.displayName = "Settings";
