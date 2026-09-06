import type { StyleProp, ViewStyle } from "react-native";

export type LiquidEdge = "left" | "right" | "top" | "bottom";

export interface LiquidAttachmentChange {
  attached: boolean;
  edge: LiquidEdge;
}

export interface LiquidViewProps {
  /** The edge of this view's bounds that the liquid attaches to. Defaults to right. */
  edge?: LiquidEdge;
  /** Change this value to return the liquid to its attached position. */
  resetKey?: number;
  /** Fires when a completed native interaction changes the attachment state. */
  onAttachmentChange?: (event: LiquidAttachmentChange) => void;
  /** Supply a bounded size, or flex: 1 inside a sized parent. */
  style?: StyleProp<ViewStyle>;
}
