import { Text, View } from "react-native";

import type { LiquidViewProps } from "./LiquidView.types";

/** Apple rendering is provided by LiquidView.ios.tsx; no native lookup here. */
export function LiquidView({ style }: LiquidViewProps) {
  return (
    <View
      style={[
        { alignItems: "center", justifyContent: "center", padding: 24 },
        style,
      ]}
    >
      <Text style={{ color: "#d9e6ef", textAlign: "center", fontSize: 17 }}>
        Open this screen in the iOS development build to try the shared Swift
        liquid animation.
      </Text>
    </View>
  );
}
