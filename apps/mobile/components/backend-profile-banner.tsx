import { Text, View } from "react-native";
import { apiOrigin } from "@/lib/api";

export function BackendProfileBanner() {
  const profile = process.env.EXPO_PUBLIC_APP_ENV;
  if (!__DEV__ || !profile) return null;
  const production = profile === "prod-api";
  return (
    <View
      style={{
        backgroundColor: production ? "#713f12" : "#164e63",
        borderRadius: 12,
        gap: 4,
        padding: 12,
        width: "100%",
      }}
    >
      <Text selectable style={{ color: "#fff", fontWeight: "700" }}>
        {production ? "PRODUCTION API — actions affect real data" : "LOCAL API"}
      </Text>
      <Text selectable style={{ color: "#fff" }}>
        {apiOrigin}
      </Text>
    </View>
  );
}
