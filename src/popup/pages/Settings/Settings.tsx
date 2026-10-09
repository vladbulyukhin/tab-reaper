import type React from "react";
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
import { Diagnostics } from "./Diagnostics";
import { ProtectedSites } from "./ProtectedSites";
import { useSettingsForm } from "./useSettingsForm";

const SettingsSection: React.FC<
  React.PropsWithChildren<{
    eyebrow: string;
    title: string;
    description: string;
  }>
> = ({ eyebrow, title, description, children }) => (
  <section className="rounded-2xl border bg-white px-4 py-4 shadow-sm">
    <div className="mb-3">
      <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
        {eyebrow}
      </p>
      <h3 className="mt-1 text-lg font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
    </div>
    <div className="flex flex-col divide-y rounded-2xl border bg-zinc-50/70 px-4">
      {children}
    </div>
  </section>
);

const SettingsRow: React.FC<React.PropsWithChildren> = ({ children }) => (
  <div className="py-4 first:pt-4 last:pb-4">{children}</div>
);

export const Settings: React.FC = () => {
  const {
    form,
    loaded,
    onSubmit,
    retry,
    diagnosticsEnabled,
    saveStatus,
    supportsTabGrouping,
  } = useSettingsForm();

  return (
    <div className="flex w-full flex-col gap-3 px-3 py-4">
      <div
        role="status"
        aria-live="polite"
        className="text-sm text-muted-foreground"
      >
        {saveStatus === "saving" ? (
          "Saving settings…"
        ) : saveStatus === "saved" ? (
          "Settings saved"
        ) : saveStatus === "error" ? (
          <>
            <span>
              Could not {loaded ? "save" : "load"} settings. Your changes are
              not confirmed.{" "}
            </span>
            <button type="button" className="underline" onClick={retry}>
              Retry
            </button>
          </>
        ) : null}
      </div>
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="flex flex-col gap-3"
        >
          <fieldset disabled={!loaded} className="contents">
            <SettingsSection
              eyebrow="Rules"
              title="Cleanup rules"
              description="Decide when Tab Reaper should step in and how aggressive it should be."
            >
              <FormField
                control={form.control}
                defaultValue={emptyConfiguration.tabCountThreshold}
                name="tabCountThreshold"
                render={({ field }) => (
                  <FormItem className="space-y-0">
                    <SettingsRow>
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <FormLabel>Safety threshold</FormLabel>
                          <FormDescription className="mt-1">
                            Only clean up a window when it has more than this
                            many tabs open. Use 0 to always allow cleanup.
                          </FormDescription>
                          <FormMessage />
                        </div>
                        <FormControl>
                          <Input
                            data-testid="tabCountThreshold"
                            type="number"
                            className="h-11 w-24 rounded-xl bg-white text-center text-lg font-semibold"
                            {...field}
                          />
                        </FormControl>
                      </div>
                    </SettingsRow>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                defaultValue={emptyConfiguration.tabRemovalDelayMin}
                name="tabRemovalDelayMin"
                render={({ field }) => (
                  <FormItem className="space-y-0">
                    <SettingsRow>
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <FormLabel>Inactivity period</FormLabel>
                          <FormDescription className="mt-1">
                            Close a tab after this many minutes since it was
                            last active.
                          </FormDescription>
                          <FormMessage />
                        </div>
                        <FormControl>
                          <Input
                            data-testid="tabRemovalDelayMin"
                            type="number"
                            className="h-11 w-24 rounded-xl bg-white text-center text-lg font-semibold"
                            {...field}
                          />
                        </FormControl>
                      </div>
                    </SettingsRow>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="removeExactDuplicates"
                render={({ field }) => (
                  <FormItem className="space-y-0">
                    <SettingsRow>
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <FormLabel>Remove duplicates</FormLabel>
                          <FormDescription className="mt-1">
                            Automatically close an older tab when a new tab
                            opens with the same URL.
                          </FormDescription>
                        </div>
                        <FormControl>
                          <Switch
                            data-testid="removeExactDuplicates"
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                      </div>
                    </SettingsRow>
                  </FormItem>
                )}
              />
            </SettingsSection>

            <SettingsSection
              eyebrow="History"
              title="Recently closed tabs"
              description="Choose whether your recently reaped list survives a browser restart."
            >
              <FormField
                control={form.control}
                name="rememberRecentlyClosedTabs"
                render={({ field }) => (
                  <FormItem className="space-y-0">
                    <SettingsRow>
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <FormLabel>Remember across restarts</FormLabel>
                          <FormDescription className="mt-1">
                            Keep recently reaped tabs on this device after the
                            browser closes.
                          </FormDescription>
                        </div>
                        <FormControl>
                          <Switch
                            data-testid="rememberRecentlyClosedTabs"
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                      </div>
                    </SettingsRow>
                  </FormItem>
                )}
              />
            </SettingsSection>

            <SettingsSection
              eyebrow="Privacy"
              title="Diagnostics"
              description="Choose whether Tab Reaper stores local cleanup activity for troubleshooting."
            >
              <FormField
                control={form.control}
                name="diagnosticsEnabled"
                render={({ field }) => (
                  <FormItem className="space-y-0">
                    <SettingsRow>
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <FormLabel>Enable diagnostics</FormLabel>
                          <FormDescription className="mt-1">
                            Keep a private local activity report that you can
                            review, clear, or copy for support.
                          </FormDescription>
                        </div>
                        <FormControl>
                          <Switch
                            data-testid="diagnosticsEnabled"
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                      </div>
                    </SettingsRow>
                  </FormItem>
                )}
              />
            </SettingsSection>

            <SettingsSection
              eyebrow="Exceptions"
              title="Tabs to always keep"
              description="These rules stop cleanup for tabs that are more likely to be intentional."
            >
              <FormField
                control={form.control}
                name="keepPinnedTabs"
                render={({ field }) => (
                  <FormItem className="space-y-0">
                    <SettingsRow>
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <FormLabel>Ignore pinned tabs</FormLabel>
                          <FormDescription className="mt-1">
                            Keep pinned tabs safe even when they are idle or
                            duplicated.
                          </FormDescription>
                        </div>
                        <FormControl>
                          <Switch
                            data-testid="keepPinnedTabs"
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                      </div>
                    </SettingsRow>
                  </FormItem>
                )}
              />

              {supportsTabGrouping ? (
                <FormField
                  control={form.control}
                  name="keepGroupedTabs"
                  render={({ field }) => (
                    <FormItem className="space-y-0">
                      <SettingsRow>
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <FormLabel>Ignore grouped tabs</FormLabel>
                            <FormDescription className="mt-1">
                              Keep grouped tabs out of cleanup while the browser
                              exposes group membership.
                            </FormDescription>
                          </div>
                          <FormControl>
                            <Switch
                              data-testid="keepGroupedTabs"
                              checked={field.value}
                              onCheckedChange={field.onChange}
                            />
                          </FormControl>
                        </div>
                      </SettingsRow>
                    </FormItem>
                  )}
                />
              ) : null}

              <FormField
                control={form.control}
                name="keepAudibleTabs"
                render={({ field }) => (
                  <FormItem className="space-y-0">
                    <SettingsRow>
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <FormLabel>Ignore audible tabs</FormLabel>
                          <FormDescription className="mt-1">
                            Prevent cleanup for tabs that are currently playing
                            audio.
                          </FormDescription>
                        </div>
                        <FormControl>
                          <Switch
                            data-testid="keepAudibleTabs"
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                      </div>
                    </SettingsRow>
                  </FormItem>
                )}
              />
            </SettingsSection>
          </fieldset>
        </form>
      </Form>

      <ProtectedSites />
      {diagnosticsEnabled ? <Diagnostics /> : null}
    </div>
  );
};

Settings.displayName = "Settings";
