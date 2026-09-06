import { type LiquidEdge, LiquidView } from "@repo/liquid-ui";
import { useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const EDGES: LiquidEdge[] = ["left", "top", "right", "bottom"];

export default function LiquidScreen() {
  const [edge, setEdge] = useState<LiquidEdge>("right");
  const [attached, setAttached] = useState(true);
  const [resetKey, setResetKey] = useState(0);
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.screen, { paddingBottom: insets.bottom }]}>
      <View style={styles.introduction}>
        <Text style={styles.title}>A little liquid</Text>
        <Text style={styles.description}>
          Pull the handle away from the edge. Bring it back and let it settle.
        </Text>
        <View style={styles.controls}>
          {EDGES.map((value) => (
            <Pressable
              key={value}
              accessibilityRole="button"
              accessibilityLabel={`Attach to ${value} edge`}
              accessibilityState={{ selected: edge === value }}
              onPress={() => {
                setEdge(value);
                setAttached(true);
                setResetKey((key) => key + 1);
              }}
              style={[styles.edgeButton, edge === value && styles.selectedEdge]}
            >
              <Text style={styles.buttonText}>{value}</Text>
            </Pressable>
          ))}
        </View>
        {Platform.OS === "ios" && (
          <View style={styles.statusRow}>
            <Text style={styles.status}>
              {attached ? `Attached · ${edge}` : "Floating"}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setResetKey((key) => key + 1);
                setAttached(true);
              }}
              style={styles.resetButton}
            >
              <Text style={styles.buttonText}>Reattach</Text>
            </Pressable>
          </View>
        )}
      </View>
      <View style={styles.canvas}>
        <View pointerEvents="none" style={styles.backgroundCircle} />
        <View pointerEvents="none" style={styles.backgroundStripe} />
        <LiquidView
          edge={edge}
          resetKey={resetKey}
          onAttachmentChange={(event) => setAttached(event.attached)}
          style={styles.liquid}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#10212c" },
  introduction: { paddingHorizontal: 24, paddingTop: 20, gap: 12 },
  title: { color: "#f3f7fa", fontSize: 28, fontWeight: "600" },
  description: { color: "#bdcedb", fontSize: 16, lineHeight: 23 },
  controls: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  edgeButton: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 16,
    borderRadius: 22,
    backgroundColor: "#243b4a",
  },
  selectedEdge: { backgroundColor: "#3c637b" },
  buttonText: { color: "#f3f7fa", fontSize: 16, textTransform: "capitalize" },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
  },
  status: { color: "#bdcedb", fontSize: 15 },
  resetButton: {
    minHeight: 44,
    paddingHorizontal: 12,
    justifyContent: "center",
  },
  canvas: { flex: 1, minHeight: 180, overflow: "hidden", marginTop: 12 },
  liquid: { flex: 1 },
  backgroundCircle: {
    position: "absolute",
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: "#315766",
    left: -100,
    top: "30%",
  },
  backgroundStripe: {
    position: "absolute",
    width: 110,
    height: "130%",
    backgroundColor: "#314251",
    right: 28,
    top: -50,
    transform: [{ rotate: "24deg" }],
  },
});
