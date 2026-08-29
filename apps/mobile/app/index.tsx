import { formatElapsedTime, useStopwatch } from "@repo/timer";
import TimerDial from "@repo/timer/skia";
import type { LiveActivity } from "expo-widgets";
import { useRef } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import {
  TimerLiveActivity,
  type TimerLiveActivityProps,
} from "@/lib/timer-live-activity";

export default function HomeScreen() {
  const { width } = useWindowDimensions();
  const { elapsedMs, isRunning, pause, reset, start } = useStopwatch();
  const liveActivityRef =
    useRef<LiveActivity<TimerLiveActivityProps> | null>(null);
  const formattedTime = formatElapsedTime(elapsedMs);
  const dialSize = Math.min(320, width - 48);

  const updateLiveActivity = (nextElapsedMs: number, nextIsRunning: boolean) => {
    if (Platform.OS !== "ios") {
      return;
    }

    const props: TimerLiveActivityProps = {
      elapsedMs: nextElapsedMs,
      isRunning: nextIsRunning,
      originEpochMs: Date.now() - nextElapsedMs,
    };

    try {
      const instance =
        liveActivityRef.current ?? TimerLiveActivity.getInstances()[0];

      if (instance) {
        liveActivityRef.current = instance;
        void instance.update(props).catch(() => {
          liveActivityRef.current = null;
        });
        return;
      }

      liveActivityRef.current = TimerLiveActivity.start(props, "timer://");
    } catch {
      liveActivityRef.current = null;
    }
  };

  const handleStart = () => {
    start();
    updateLiveActivity(elapsedMs, true);
  };

  const handlePause = () => {
    pause();
    updateLiveActivity(elapsedMs, false);
  };

  const handleReset = () => {
    reset();

    if (isRunning) {
      updateLiveActivity(0, true);
      return;
    }

    const instance =
      liveActivityRef.current ?? TimerLiveActivity.getInstances()[0];

    liveActivityRef.current = null;
    void instance?.end("immediate").catch(() => {});
  };

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{
        alignItems: "center",
        backgroundColor: "#050b12",
        flexGrow: 1,
        gap: 32,
        justifyContent: "center",
        padding: 24,
        paddingBottom: 48,
      }}
    >
      <View style={{ alignItems: "center", gap: 8 }}>
        <Text
          selectable
          style={{
            color: "#58f4c2",
            fontSize: 12,
            fontWeight: "800",
            letterSpacing: 2.4,
          }}
        >
          PRECISION TIMER
        </Text>
        <Text
          selectable
          style={{ color: "#8da2b5", fontSize: 15, lineHeight: 22 }}
        >
          Monotonic time, displayed to 1/100 second
        </Text>
      </View>

      <View
        accessibilityLabel={formattedTime.label}
        accessibilityRole="timer"
        style={{ height: dialSize, width: dialSize }}
      >
        <TimerDial elapsedMs={elapsedMs} size={dialSize} />
        <View
          pointerEvents="none"
          style={{
            alignItems: "center",
            bottom: 0,
            justifyContent: "center",
            left: 0,
            position: "absolute",
            right: 0,
            top: 0,
          }}
        >
          <Text
            style={{
              color: "#f5fbff",
              fontSize: dialSize * 0.16,
              fontVariant: ["tabular-nums"],
              fontWeight: "700",
              letterSpacing: -1.5,
            }}
          >
            {formattedTime.minutes}:{formattedTime.seconds}
            <Text
              style={{
                color: "#58f4c2",
                fontSize: dialSize * 0.09,
                fontVariant: ["tabular-nums"],
                fontWeight: "700",
              }}
            >
              .{formattedTime.hundredths}
            </Text>
          </Text>
        </View>
      </View>

      <View style={{ flexDirection: "row", gap: 12, width: "100%" }}>
        <Pressable
          accessibilityLabel={isRunning ? "Pause timer" : "Start timer"}
          accessibilityRole="button"
          onPress={isRunning ? handlePause : handleStart}
          style={({ pressed }) => ({
            alignItems: "center",
            backgroundColor: pressed ? "#39cda1" : "#58f4c2",
            borderCurve: "continuous",
            borderRadius: 18,
            flex: 1,
            justifyContent: "center",
            minHeight: 56,
          })}
        >
          <Text style={{ color: "#07131d", fontSize: 16, fontWeight: "800" }}>
            {isRunning ? "Pause" : elapsedMs > 0 ? "Resume" : "Start"}
          </Text>
        </Pressable>

        <Pressable
          accessibilityLabel="Reset timer"
          accessibilityRole="button"
          onPress={handleReset}
          style={({ pressed }) => ({
            alignItems: "center",
            backgroundColor: pressed ? "#1a2c3d" : "#101e2b",
            borderColor: "#263d51",
            borderCurve: "continuous",
            borderRadius: 18,
            borderWidth: 1,
            flex: 1,
            justifyContent: "center",
            minHeight: 56,
          })}
        >
          <Text style={{ color: "#d5e3ed", fontSize: 16, fontWeight: "700" }}>
            Reset
          </Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}
