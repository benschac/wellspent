import { DrawerToggleButton } from "expo-router/drawer";
import { Stack } from "expo-router/stack";

export const unstable_settings = {
  history: { anchor: "history" },
  index: { anchor: "index" },
  settings: { anchor: "settings" },
};

const titles = {
  history: "History",
  index: "Timer",
  settings: "Settings",
} as const;

export default function TabStackLayout({ segment }: { segment: string }) {
  const screen = segment.match(/\((.*)\)/)?.[1] as keyof typeof titles;

  return (
    <Stack
      screenOptions={{
        headerBackButtonDisplayMode: "minimal",
        headerLargeTitle: true,
        headerShadowVisible: false,
        headerLeft: ({ tintColor }) => (
          <DrawerToggleButton tintColor={tintColor} />
        ),
      }}
    >
      <Stack.Screen name={screen} options={{ title: titles[screen] }} />
    </Stack>
  );
}
