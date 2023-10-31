import {
  Card,
  Center,
  Container,
  MantineProvider,
  ScrollArea,
  SegmentedControl,
  Stack,
  Tabs,
} from "@mantine/core";
import "@mantine/core/styles.css";
import { IconHome, IconSettings } from "@tabler/icons-react";
import React from "react";
import { useState } from "react";

const DATA = {
  recentlyClosed: [
    "Item 1",
    "Item 2",
    "Item 3",
    "Item 4",
    "Item 5",
    "Item 6",
    "Item 7",
    "Item 1",
    "Item 2",
    "Item 3",
    "Item 4",
    "Item 5",
    "Item 6",
    "Item 7",
  ],
  soonToClose: ["Item A", "Item B", "Item C"],
};

export const App: React.FC = () => {
  const [selected, setSelected] = useState("recentlyClosed");
  const [activeTab, setActiveTab] = useState("home");

  return (
    <MantineProvider>
      <Container w={300} p={0} m={0}>
        <Center py={8}>
          <SegmentedControl
            data={[
              { value: "recentlyClosed", label: "Recently Closed" },
              { value: "soonToClose", label: "Soon To Close" },
            ]}
            value={selected}
            onChange={setSelected}
          />
        </Center>
        <ScrollArea>
          <div
            style={{ padding: "0 8px", minHeight: "400px", maxHeight: "400px" }}
          >
            {DATA[selected].map((item, index) => (
              <Card m="5px 0" bg="blue" key={index}>
                {item}
              </Card>
            ))}
          </div>
        </ScrollArea>
        <Tabs
          value={activeTab}
          color="pink"
          onChange={(val) => setActiveTab(val || "home")}
          inverted
        >
          <Tabs.List grow>
            <Tabs.Tab value="home">
              <Stack align="center" justify="center" gap={2}>
                <IconHome />
                Home
              </Stack>
            </Tabs.Tab>
            <Tabs.Tab value="settings">
              <Stack align="center" justify="center" gap={2}>
                <IconSettings />
                Settings
              </Stack>
            </Tabs.Tab>
          </Tabs.List>
        </Tabs>
      </Container>
    </MantineProvider>
  );
};

App.displayName = "App";
