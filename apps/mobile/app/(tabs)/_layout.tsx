import { NativeTabs } from "expo-router/unstable-native-tabs";
import { type ColorValue, DynamicColorIOS } from "react-native";

const tintColor: ColorValue =
  process.env.EXPO_OS === "ios"
    ? DynamicColorIOS({ dark: "#63E6BE", light: "#087F5B" })
    : "#087F5B";

export default function TabLayout() {
  return (
    <NativeTabs minimizeBehavior="onScrollDown" tintColor={tintColor}>
      <NativeTabs.Trigger name="(index)">
        <NativeTabs.Trigger.Icon
          sf={{ default: "timer", selected: "timer.circle.fill" }}
          md="timer"
        />
        <NativeTabs.Trigger.Label>Timer</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(history)">
        <NativeTabs.Trigger.Icon
          sf={{ default: "clock.arrow.circlepath", selected: "clock.fill" }}
          md="history"
        />
        <NativeTabs.Trigger.Label>History</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(settings)">
        <NativeTabs.Trigger.Icon
          sf={{ default: "gearshape", selected: "gearshape.fill" }}
          md="settings"
        />
        <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
