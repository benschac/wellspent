import { useOnce } from "@repo/lib/hooks/use-once";
import {
  focusManager,
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import * as Network from "expo-network";
import { DarkTheme, DefaultTheme, ThemeProvider } from "expo-router";
import { Drawer } from "expo-router/drawer";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import {
  AppState,
  type AppStateStatus,
  Platform,
  useColorScheme,
} from "react-native";

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
  const queryClient = useOnce(() => new QueryClient());
  const colorScheme = useColorScheme();

  useEffect(() => {
    const subscription = AppState.addEventListener("change", onAppStateChange);

    return () => subscription.remove();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
        <Drawer
          screenOptions={{
            headerShadowVisible: false,
          }}
        >
          <Drawer.Screen
            name="(tabs)"
            options={{
              drawerLabel: "Timer",
              headerShown: false,
              title: "Timer",
            }}
          />
          <Drawer.Screen
            name="liquid"
            options={{
              drawerLabel: "Liquid animation",
              title: "Liquid animation",
              swipeEnabled: false,
            }}
          />
          <Drawer.Screen
            name="about"
            options={{
              drawerLabel: "About",
              title: "About Timer",
            }}
          />
        </Drawer>
        <StatusBar style="auto" />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
