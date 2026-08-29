import { HStack, Image, Text, VStack } from "@expo/ui/swift-ui";
import {
  font,
  foregroundStyle,
  monospacedDigit,
  padding,
} from "@expo/ui/swift-ui/modifiers";
import { createLiveActivity } from "expo-widgets";

export interface TimerLiveActivityProps {
  elapsedMs: number;
  isRunning: boolean;
  originEpochMs: number;
}

const TimerLiveActivityLayout = (props: TimerLiveActivityProps) => {
  "widget";

  const accentColor = "#58f4c2";
  const timer = (
    <Text
      countsDown={false}
      modifiers={[
        font({ design: "monospaced", size: 18, weight: "bold" }),
        monospacedDigit(),
        foregroundStyle(accentColor),
      ]}
      pauseTime={
        props.isRunning
          ? undefined
          : new Date(props.originEpochMs + props.elapsedMs)
      }
      timerInterval={{
        lower: new Date(props.originEpochMs),
        upper: new Date(props.originEpochMs + 3_155_760_000_000),
      }}
    />
  );

  return {
    banner: (
      <HStack alignment="center" modifiers={[padding({ all: 16 })]} spacing={12}>
        <Image
          color={accentColor}
          size={28}
          systemName={props.isRunning ? "stopwatch.fill" : "pause.circle.fill"}
        />
        <VStack alignment="leading" spacing={2}>
          <Text modifiers={[font({ size: 12, weight: "semibold" })]}>
            {props.isRunning ? "Timer running" : "Timer paused"}
          </Text>
          {timer}
        </VStack>
      </HStack>
    ),
    compactLeading: (
      <Image
        color={accentColor}
        size={16}
        systemName={props.isRunning ? "stopwatch.fill" : "pause.fill"}
      />
    ),
    compactTrailing: timer,
    expandedLeading: (
      <Image
        color={accentColor}
        size={24}
        systemName={props.isRunning ? "stopwatch.fill" : "pause.circle.fill"}
      />
    ),
    expandedTrailing: timer,
    expandedBottom: (
      <Text
        modifiers={[
          font({ size: 12, weight: "semibold" }),
          foregroundStyle(accentColor),
          padding({ bottom: 8 }),
        ]}
      >
        {props.isRunning ? "Counting up" : "Paused"}
      </Text>
    ),
    minimal: <Image color={accentColor} size={16} systemName="stopwatch.fill" />,
  };
};

export const TimerLiveActivity = createLiveActivity<TimerLiveActivityProps>(
  "TimerLiveActivity",
  TimerLiveActivityLayout,
);
