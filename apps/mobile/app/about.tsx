import { ScrollView, Text } from "react-native";

export default function AboutScreen() {
  return (
    <ScrollView
      contentContainerStyle={{ gap: 12, padding: 24 }}
      contentInsetAdjustmentBehavior="automatic"
    >
      <Text selectable style={{ fontSize: 17, lineHeight: 24 }}>
        Timer keeps a shared focus session in sync across your devices.
      </Text>
    </ScrollView>
  );
}
