import {
  focusManager,
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import * as Network from "expo-network";
import { Stack } from "expo-router/stack";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { AppState, Platform, type AppStateStatus } from "react-native";

if (Platform.OS !== "web") {
  onlineManager.setEventListener((setOnline) => {
    let initialized = false;
    const subscription = Network.addNetworkStateListener((state) => {
      initialized = true;
      setOnline(!!state.isConnected);
    });

    void Network.getNetworkStateAsync()
      .then((state) => {
        if (!initialized) {
          setOnline(!!state.isConnected);
        }
      })
      .catch(() => {
        // Keep TanStack Query's current online state if the native check fails.
      });

    return () => subscription.remove();
  });
}

function onAppStateChange(status: AppStateStatus) {
  if (Platform.OS !== "web") {
    focusManager.setFocused(status === "active");
  }
}

export default function RootLayout() {
  const [queryClient] = useState(() => new QueryClient());

  useEffect(() => {
    const subscription = AppState.addEventListener("change", onAppStateChange);

    return () => subscription.remove();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <Stack
        screenOptions={{
          headerLargeTitle: true,
          headerShadowVisible: false,
        }}
      >
        <Stack.Screen name="index" options={{ title: "Timer" }} />
      </Stack>
      <StatusBar style="auto" />
    </QueryClientProvider>
  );
}
