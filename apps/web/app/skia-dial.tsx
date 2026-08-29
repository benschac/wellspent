"use client";

import { WithSkiaWeb } from "@shopify/react-native-skia/lib/module/web";
import type { TimerDialProps } from "@repo/timer/skia";

export function SkiaDial(props: TimerDialProps) {
  return (
    <WithSkiaWeb
      componentProps={props}
      fallback={<div aria-hidden="true" className="timer-dial__loading" />}
      getComponent={() => import("@repo/timer/skia")}
      opts={{
        locateFile: (file) =>
          file === "canvaskit.wasm" ? "/canvaskit.wasm" : file,
      }}
    />
  );
}
