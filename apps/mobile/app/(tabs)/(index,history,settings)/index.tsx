import { formatElapsedTime, useStopwatch } from "@repo/timer";
import TimerDial from "@repo/timer/skia";
import { useCallback, useEffect, useEffectEvent, useState } from "react";
import {
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import Animated, {
  type SharedValue,
  useAnimatedProps,
  useDerivedValue,
  useFrameCallback,
  useSharedValue,
} from "react-native-reanimated";
import { getTimerRealtimeUrl } from "@/lib/api";
import { TimerWidget, type TimerWidgetProps } from "@/lib/timer-widget";
import {
  endTimerLiveActivity,
  onTimerLiveActivityPushToken,
  startOrUpdateTimerLiveActivity,
  type TimerLiveActivityState,
} from "@/modules/timer-live-activity/src";

const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

interface AnimatedTimerReadoutProps {
  elapsedMs: SharedValue<number>;
  size: number;
}

const formatTwoDigits = (value: number): string => {
  "worklet";

  return value < 10 ? `0${value}` : String(value);
};

function AnimatedTimerReadout({ elapsedMs, size }: AnimatedTimerReadoutProps) {
  const mainText = useDerivedValue(() => {
    const totalSeconds = Math.floor(Math.max(0, elapsedMs.value) / 1_000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    return `${formatTwoDigits(minutes)}:${formatTwoDigits(seconds)}`;
  });
  const hundredthsText = useDerivedValue(() => {
    const hundredths = Math.floor(Math.max(0, elapsedMs.value) / 10) % 100;

    return `.${formatTwoDigits(hundredths)}`;
  });
  const mainAnimatedProps = useAnimatedProps(() => ({
    defaultValue: mainText.value,
    text: mainText.value,
  }));
  const hundredthsAnimatedProps = useAnimatedProps(() => ({
    defaultValue: hundredthsText.value,
    text: hundredthsText.value,
  }));

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
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
      <View style={{ alignItems: "baseline", flexDirection: "row" }}>
        <AnimatedTextInput
          animatedProps={mainAnimatedProps}
          editable={false}
          style={{
            color: "#f5fbff",
            fontSize: size * 0.16,
            fontVariant: ["tabular-nums"],
            fontWeight: "700",
            letterSpacing: -1.5,
            padding: 0,
            textAlign: "right",
            width: size * 0.47,
          }}
          underlineColorAndroid="transparent"
        />
        <AnimatedTextInput
          animatedProps={hundredthsAnimatedProps}
          editable={false}
          style={{
            color: "#58f4c2",
            fontSize: size * 0.09,
            fontVariant: ["tabular-nums"],
            fontWeight: "700",
            padding: 0,
            width: size * 0.17,
          }}
          underlineColorAndroid="transparent"
        />
      </View>
    </View>
  );
}

export default function HomeScreen() {
  const { width } = useWindowDimensions();
  const [timerRealtimeUrl, setTimerRealtimeUrl] = useState(getTimerRealtimeUrl);
  const {
    elapsedMs,
    elapsedSnapshotAtMs,
    isRunning,
    pause,
    registerLiveActivity,
    realtimeRevision,
    reset,
    start,
  } = useStopwatch({
    realtimeUrl: timerRealtimeUrl,
    updateIntervalMs: 1_000,
  });
  const formattedTime = formatElapsedTime(elapsedMs);
  const dialSize = Math.min(320, width - 48);

  useEffect(() => {
    if (!timerRealtimeUrl.includes("://localhost:")) {
      return;
    }

    const interval = setInterval(() => {
      setTimerRealtimeUrl(getTimerRealtimeUrl());
    }, 250);

    return () => clearInterval(interval);
  }, [timerRealtimeUrl]);

  const updateTimerWidget = (nextElapsedMs: number, nextIsRunning: boolean) => {
    if (process.env.EXPO_OS !== "ios") {
      return;
    }

    const props: TimerWidgetProps = {
      elapsedMs: nextElapsedMs,
      isRunning: nextIsRunning,
      originEpochMs: Date.now() - nextElapsedMs,
      realtimeUrl: timerRealtimeUrl,
    };

    try {
      TimerWidget.updateSnapshot(props);
    } catch {
      // The widget target is unavailable until the native build includes it.
    }
  };
  const elapsedSnapshot = useSharedValue(elapsedMs);
  const snapshotAt = useSharedValue(elapsedSnapshotAtMs);
  const running = useSharedValue(isRunning);
  const animatedElapsedMs = useSharedValue(elapsedMs);

  const updateAnimatedElapsed = useCallback(
    ({ timestamp }: { timestamp: number }) => {
      "worklet";

      if (running.value) {
        animatedElapsedMs.set(
          elapsedSnapshot.value + Math.max(0, timestamp - snapshotAt.value),
        );
      }
    },
    [animatedElapsedMs, elapsedSnapshot, running, snapshotAt],
  );
  const frameCallback = useFrameCallback(updateAnimatedElapsed, false);
  const secondProgress = useDerivedValue(
    () => (Math.max(0, animatedElapsedMs.value) % 1_000) / 1_000,
  );

  useEffect(() => {
    elapsedSnapshot.set(elapsedMs);
    snapshotAt.set(elapsedSnapshotAtMs);
    running.set(isRunning);

    if (!isRunning) {
      animatedElapsedMs.set(elapsedMs);
    }
  }, [
    animatedElapsedMs,
    elapsedMs,
    elapsedSnapshot,
    elapsedSnapshotAtMs,
    isRunning,
    running,
    snapshotAt,
  ]);

  useEffect(() => {
    frameCallback.setActive(isRunning);

    return () => frameCallback.setActive(false);
  }, [frameCallback, isRunning]);

  const updateLiveActivity = (
    nextElapsedMs: number,
    nextIsRunning: boolean,
    startIfMissing = true,
  ) => {
    if (process.env.EXPO_OS !== "ios") {
      return;
    }

    const state: TimerLiveActivityState = {
      elapsedMs: nextElapsedMs,
      isRunning: nextIsRunning,
      originEpochMs: Date.now() - nextElapsedMs,
      realtimeUrl: timerRealtimeUrl,
    };

    void startOrUpdateTimerLiveActivity(state, startIfMissing).catch(() => {});
  };

  const handleStart = () => {
    start();
    updateLiveActivity(elapsedMs, true);
    updateTimerWidget(elapsedMs, true);
  };

  const handlePause = () => {
    pause();
    updateLiveActivity(elapsedMs, false);
    updateTimerWidget(elapsedMs, false);
  };

  const handleReset = () => {
    reset();
    updateTimerWidget(0, isRunning);

    if (isRunning) {
      updateLiveActivity(0, true);
      return;
    }

    void endTimerLiveActivity().catch(() => {});
  };

  const syncLiveActivityFromRealtime = useEffectEvent(() => {
    updateLiveActivity(elapsedMs, isRunning, false);
    updateTimerWidget(elapsedMs, isRunning);
  });
  const syncTimerWidgetEndpoint = useEffectEvent(() => {
    updateTimerWidget(elapsedMs, isRunning);
  });

  useEffect(() => {
    if (realtimeRevision === null) {
      return;
    }

    syncLiveActivityFromRealtime();
  }, [realtimeRevision]);

  const registerLiveActivityPushToken = useEffectEvent(
    ({ activityId, pushToken }: { activityId: string; pushToken: string }) => {
      registerLiveActivity({
        activityId,
        pushToken,
        realtimeUrl: timerRealtimeUrl,
      });
    },
  );

  useEffect(() => {
    if (process.env.EXPO_OS !== "ios") {
      return;
    }

    const subscription = onTimerLiveActivityPushToken((event) => {
      registerLiveActivityPushToken(event);
    });

    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (timerRealtimeUrl.includes("://localhost:")) {
      return;
    }

    syncTimerWidgetEndpoint();
  }, [timerRealtimeUrl]);

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
        <TimerDial
          elapsedMs={elapsedMs}
          secondProgress={secondProgress}
          size={dialSize}
        />
        <AnimatedTimerReadout elapsedMs={animatedElapsedMs} size={dialSize} />
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
