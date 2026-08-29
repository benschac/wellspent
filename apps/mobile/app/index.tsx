import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { api, apiOrigin } from "@/lib/api";

type RequestState = "idle" | "loading" | "online" | "error";

export default function HomeScreen() {
  const [requestState, setRequestState] = useState<RequestState>("idle");
  const [message, setMessage] = useState("Ready to contact the NestJS API.");

  async function checkApi(): Promise<void> {
    setRequestState("loading");

    try {
      const health = await api.health();
      setMessage(`Connected at ${new Date(health.timestamp).toLocaleTimeString()}`);
      setRequestState("online");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The request failed.");
      setRequestState("error");
    }
  }

  const isLoading = requestState === "loading";
  const isOnline = requestState === "online";

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ gap: 28, padding: 24, paddingBottom: 48 }}
    >
      <View style={{ gap: 10 }}>
        <Text
          selectable
          style={{ color: "#2563eb", fontSize: 13, fontWeight: "700" }}
        >
          EXPO + ORPC
        </Text>
        <Text
          selectable
          style={{ color: "#111827", fontSize: 34, fontWeight: "800" }}
        >
          One typed API, everywhere.
        </Text>
        <Text selectable style={{ color: "#64748b", fontSize: 17, lineHeight: 25 }}>
          This screen calls the same contract used by the Next.js server component.
        </Text>
      </View>

      <View
        style={{
          backgroundColor: "#f8fafc",
          borderColor: "#e2e8f0",
          borderCurve: "continuous",
          borderRadius: 24,
          borderWidth: 1,
          gap: 12,
          padding: 20,
        }}
      >
        <View style={{ alignItems: "center", flexDirection: "row", gap: 10 }}>
          <View
            style={{
              backgroundColor: isOnline ? "#22c55e" : "#94a3b8",
              borderRadius: 999,
              height: 10,
              width: 10,
            }}
          />
          <Text selectable style={{ color: "#0f172a", fontWeight: "700" }}>
            {isOnline ? "API connected" : "API status"}
          </Text>
        </View>
        <Text selectable style={{ color: "#475569", lineHeight: 21 }}>
          {message}
        </Text>
        <Text selectable style={{ color: "#94a3b8", fontSize: 12 }}>
          {apiOrigin}
        </Text>
      </View>

      <Pressable
        accessibilityRole="button"
        disabled={isLoading}
        onPress={checkApi}
        style={({ pressed }) => ({
          alignItems: "center",
          backgroundColor: pressed ? "#1d4ed8" : "#2563eb",
          borderCurve: "continuous",
          borderRadius: 18,
          minHeight: 54,
          justifyContent: "center",
          opacity: isLoading ? 0.7 : 1,
        })}
      >
        {isLoading ? (
          <ActivityIndicator color="#ffffff" />
        ) : (
          <Text style={{ color: "#ffffff", fontSize: 16, fontWeight: "700" }}>
            Check connection
          </Text>
        )}
      </Pressable>
    </ScrollView>
  );
}

