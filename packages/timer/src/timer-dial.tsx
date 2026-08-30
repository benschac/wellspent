import {
  Canvas,
  Circle,
  Fill,
  Line,
  Path,
  Skia,
  vec,
} from "@shopify/react-native-skia";
import type { ComponentProps } from "react";

export interface TimerDialProps {
  elapsedMs: number;
  secondProgress?: ComponentProps<typeof Path>["end"];
  size?: number;
}

interface TickMark {
  end: ReturnType<typeof vec>;
  start: ReturnType<typeof vec>;
}

export default function TimerDial({
  elapsedMs,
  secondProgress: animatedSecondProgress,
  size = 300,
}: TimerDialProps) {
  const center = size / 2;
  const radius = size * 0.405;
  const strokeWidth = size * 0.025;
  const secondProgress =
    animatedSecondProgress ?? (Math.max(0, elapsedMs) % 1000) / 1000;

  const pathBuilder = Skia.PathBuilder.Make();
  const inset = center - radius;

  pathBuilder.addArc(
    {
      height: radius * 2,
      width: radius * 2,
      x: inset,
      y: inset,
    },
    -90,
    359.999,
  );

  const progressPath = pathBuilder.detach();

  const tickMarks: TickMark[] = Array.from({ length: 60 }, (_, index) => {
    const angle = (index / 60) * Math.PI * 2 - Math.PI / 2;
    const isMajor = index % 5 === 0;
    const outerRadius = radius - strokeWidth * 1.8;
    const innerRadius = outerRadius - (isMajor ? size * 0.04 : size * 0.018);

    return {
      end: vec(
        center + Math.cos(angle) * outerRadius,
        center + Math.sin(angle) * outerRadius,
      ),
      start: vec(
        center + Math.cos(angle) * innerRadius,
        center + Math.sin(angle) * innerRadius,
      ),
    };
  });

  return (
    <Canvas style={{ height: size, width: size }}>
      <Fill color="#08121f" />
      <Circle
        color="#183047"
        cx={center}
        cy={center}
        r={radius}
        strokeWidth={strokeWidth}
        style="stroke"
      />
      {tickMarks.map((tick, index) => (
        <Line
          color={index % 5 === 0 ? "#4e718f" : "#29455d"}
          key={index}
          p1={tick.start}
          p2={tick.end}
          strokeCap="round"
          strokeWidth={index % 5 === 0 ? size * 0.007 : size * 0.004}
        />
      ))}
      <Path
        color="#58f4c2"
        end={secondProgress}
        path={progressPath}
        start={0}
        strokeCap="round"
        strokeWidth={strokeWidth}
        style="stroke"
      />
      <Circle color="#58f4c2" cx={center} cy={center} r={size * 0.012} />
    </Canvas>
  );
}
