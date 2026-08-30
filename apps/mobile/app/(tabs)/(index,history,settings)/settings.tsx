import { ScrollView, Text, View } from "react-native";

export default function SettingsScreen() {
  return (
    <ScrollView
      contentContainerStyle={{ gap: 12, padding: 24 }}
      contentInsetAdjustmentBehavior="automatic"
    >
      <View
        style={{
          backgroundColor: "#14201d",
          borderCurve: "continuous",
          borderRadius: 20,
          gap: 8,
          padding: 20,
        }}
      >
        <Text selectable style={{ color: "#f5fbff", fontSize: 18, fontWeight: "600" }}>
          Timer preferences
        </Text>
        <Text selectable style={{ color: "#9fb4ad", fontSize: 15, lineHeight: 21 }}>
          Sound, haptics, and focus defaults will live here.
        </Text>
      </View>
    </ScrollView>
  );
}
