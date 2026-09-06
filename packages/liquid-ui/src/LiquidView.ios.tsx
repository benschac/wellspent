import { Host } from "@expo/ui/swift-ui";
import { requireNativeView } from "expo";
import type { ComponentType } from "react";
import type { NativeSyntheticEvent } from "react-native";

import type {
  LiquidAttachmentChange,
  LiquidViewProps,
} from "./LiquidView.types";

type NativeProps = Omit<LiquidViewProps, "style" | "onAttachmentChange"> & {
  onAttachmentChange?: (
    event: NativeSyntheticEvent<LiquidAttachmentChange>,
  ) => void;
};

const NativeLiquidView: ComponentType<NativeProps> = requireNativeView(
  "ExpoLiquidUI",
  "ExpoLiquidView",
);

/** Hosts the shared Apple liquid surface, with drag and animation state in Swift. */
export function LiquidView({
  edge = "right",
  resetKey = 0,
  onAttachmentChange,
  style,
}: LiquidViewProps) {
  return (
    <Host style={style}>
      <NativeLiquidView
        edge={edge}
        resetKey={resetKey}
        onAttachmentChange={(event) => onAttachmentChange?.(event.nativeEvent)}
      />
    </Host>
  );
}
