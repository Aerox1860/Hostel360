import { useMemo, useState } from "react";
import { Animated, PanResponder, Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Card, T } from "@/src/components/ui";
import { colors, radius, spacing, type } from "@/src/theme";

const DELETE_ACTION_WIDTH = 88;

export function SwipeNoticeCard({
  notice,
  onDelete,
}: {
  notice: { id: string; title: string; body: string };
  onDelete: () => void;
}) {
  const [translateX] = useState(() => new Animated.Value(0));
  const [revealed, setRevealed] = useState(false);
  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) =>
      Math.abs(gesture.dx) > 8
      && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.2
      && (gesture.dx < 0 || revealed),
    onPanResponderMove: (_, gesture) => {
      translateX.setValue(Math.max(-DELETE_ACTION_WIDTH, Math.min(0, gesture.dx)));
    },
    onPanResponderRelease: (_, gesture) => {
      const shouldReveal = gesture.dx < -DELETE_ACTION_WIDTH / 2;
      setRevealed(shouldReveal);
      Animated.spring(translateX, {
        toValue: shouldReveal ? -DELETE_ACTION_WIDTH : 0,
        useNativeDriver: true,
      }).start();
    },
    onPanResponderTerminate: () => {
      setRevealed(false);
      Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
    },
  }), [revealed, translateX]);

  return (
    <View style={{ overflow: "hidden", borderRadius: radius.lg }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Delete notice ${notice.title}`}
        onPress={onDelete}
        pointerEvents={revealed ? "auto" : "none"}
        style={{
          position: "absolute",
          right: 0,
          top: 0,
          bottom: 0,
          width: DELETE_ACTION_WIDTH,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: colors.error,
        }}
      >
        <Ionicons name="trash" size={19} color={colors.onError} />
        <T size={type.sm} weight="bold" color={colors.onError}>Delete</T>
      </Pressable>
      <Animated.View
        {...panResponder.panHandlers}
        style={{ transform: [{ translateX }], backgroundColor: colors.surface }}
      >
        <Card style={{ gap: spacing.xs }}>
          <T weight="bold">{notice.title}</T>
          <T size={type.sm} color={colors.onSurfaceSecondary}>{notice.body}</T>
        </Card>
      </Animated.View>
    </View>
  );
}
