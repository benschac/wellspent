import { Button, HStack, Image, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import {
  buttonStyle,
  containerBackground,
  controlSize,
  font,
  foregroundStyle,
  monospacedDigit,
  padding,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import { createWidget, type WidgetEnvironment } from "expo-widgets";

export interface TimerWidgetProps {
  elapsedMs: number;
  isRunning: boolean;
  originEpochMs: number;
  realtimeUrl: string;
}

const TimerWidgetLayout = (
  props: TimerWidgetProps,
  environment: WidgetEnvironment,
) => {
  "widget";

  const accentColor = "#58f4c2";
  const elapsedMs =
    typeof props.elapsedMs === "number" && props.elapsedMs >= 0
      ? props.elapsedMs
      : 0;
  const isRunning = props.isRunning === true;
  const originEpochMs =
    typeof props.originEpochMs === "number"
      ? props.originEpochMs
      : Date.now() - elapsedMs;
  const totalHundredths = Math.floor(elapsedMs / 10);
  const hundredths = String(totalHundredths % 100).padStart(2, "0");
  const totalSeconds = Math.floor(totalHundredths / 100);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  const minutes = Math.floor(totalSeconds / 60);
  const pausedTime = `${minutes}:${seconds}.${hundredths}`;
  const timerFontSize = environment.widgetFamily === "systemSmall" ? 30 : 36;
  const timer = isRunning ? (
    <Text
      countsDown={false}
      modifiers={[
        font({ design: "monospaced", size: timerFontSize, weight: "bold" }),
        monospacedDigit(),
        foregroundStyle(accentColor),
      ]}
      timerInterval={{
        lower: new Date(originEpochMs),
        upper: new Date(originEpochMs + 3_155_760_000_000),
      }}
    />
  ) : (
    <Text
      modifiers={[
        font({ design: "monospaced", size: timerFontSize, weight: "bold" }),
        monospacedDigit(),
        foregroundStyle(accentColor),
      ]}
    >
      {pausedTime}
    </Text>
  );

  return (
    <VStack
      alignment="leading"
      modifiers={[
        containerBackground("#05111c", "widget"),
        padding({ all: 16 }),
      ]}
      spacing={8}
    >
      <HStack alignment="center" spacing={8}>
        <Image
          color={accentColor}
          size={22}
          systemName={isRunning ? "stopwatch.fill" : "pause.circle.fill"}
        />
        <VStack alignment="leading" spacing={0}>
          <Text
            modifiers={[
              font({ size: 13, weight: "bold" }),
              foregroundStyle("#f5fbff"),
            ]}
          >
            Timer
          </Text>
          <Text
            modifiers={[
              font({ size: 11, weight: "medium" }),
              foregroundStyle("#8da2b5"),
            ]}
          >
            {isRunning ? "Running" : "Paused"}
          </Text>
        </VStack>
      </HStack>

      <Spacer minLength={2} />
      {timer}
      <Spacer minLength={2} />

      <Button
        label={isRunning ? "Pause" : "Resume"}
        modifiers={[
          buttonStyle("bordered"),
          controlSize("small"),
          tint(accentColor),
        ]}
        systemImage={isRunning ? "pause.fill" : "play.fill"}
        target={isRunning ? "pause-timer" : "start-timer"}
      />
    </VStack>
  );
};

export const TimerWidget = createWidget<TimerWidgetProps>(
  "TimerWidget",
  TimerWidgetLayout,
);
