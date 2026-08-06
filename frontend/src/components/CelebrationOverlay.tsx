import { useEffect, useRef } from "react";
import { View, Modal, Animated, Easing, Dimensions, Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { T, Btn } from "@/src/components/ui";
import { Logo } from "@/src/components/Logo";
import { colors, spacing, radius, type } from "@/src/theme";

const { width: W, height: H } = Dimensions.get("window");
const FLOWERS = ["🌸", "🌺", "🌼", "🌷", "💐", "🌻", "✨", "🎉"];

function Petal({ index }: { index: number }) {
  const fall = useRef(new Animated.Value(0)).current;
  const startX = Math.random() * W;
  const drift = (Math.random() - 0.5) * 120;
  const emoji = FLOWERS[index % FLOWERS.length];
  const size = 20 + Math.random() * 20;
  const delay = Math.random() * 1200;
  const duration = 3200 + Math.random() * 2200;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.timing(fall, {
        toValue: 1,
        duration,
        delay,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    anim.start();
    return () => anim.stop();
  }, []);

  const translateY = fall.interpolate({ inputRange: [0, 1], outputRange: [-60, H + 60] });
  const translateX = fall.interpolate({ inputRange: [0, 1], outputRange: [startX, startX + drift] });
  const rotate = fall.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });

  return (
    <Animated.Text
      style={{
        position: "absolute",
        fontSize: size,
        transform: [{ translateX }, { translateY }, { rotate }],
      }}
    >
      {emoji}
    </Animated.Text>
  );
}

export function CelebrationOverlay({
  visible,
  name,
  planLabel,
  onClose,
}: {
  visible: boolean;
  name?: string;
  planLabel?: string;
  onClose: () => void;
}) {
  const pop = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      pop.setValue(0);
      Animated.spring(pop, { toValue: 1, friction: 6, tension: 60, useNativeDriver: true }).start();
    }
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        {visible ? Array.from({ length: 26 }).map((_, i) => <Petal key={i} index={i} />) : null}
        <Animated.View style={[styles.card, { transform: [{ scale: pop }] }]}>
          <View style={styles.check}>
            <Ionicons name="checkmark" size={40} color={colors.onBrandPrimary} />
          </View>
          <View style={{ marginTop: spacing.md }}>
            <Logo size={40} />
          </View>
          <T weight="extrabold" size={type["2xl"]} style={{ marginTop: spacing.lg, textAlign: "center" }}>
            Thanks for joining{"\n"}Hostel 360! 🎉
          </T>
          {name ? (
            <T size={type.lg} weight="semibold" color={colors.brand} style={{ marginTop: 4 }}>
              Welcome, {name}
            </T>
          ) : null}
          {planLabel ? (
            <View style={styles.planPill}>
              <Ionicons name="diamond" size={14} color={colors.brand} />
              <T size={type.sm} weight="bold" color={colors.brand}>
                {planLabel} activated
              </T>
            </View>
          ) : null}
          <T color={colors.onSurfaceSecondary} style={{ marginTop: spacing.sm, textAlign: "center" }}>
            Your hostel is now premium. Enjoy the verified badge and featured placement.
          </T>
          <View style={{ width: "100%", marginTop: spacing.lg }}>
            <Btn title="Awesome, continue" icon="sparkles" onPress={onClose} testID="celebrate-done" />
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(26,29,26,0.55)",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: "center",
    width: "100%",
    maxWidth: 380,
  },
  check: {
    width: 72,
    height: 72,
    borderRadius: radius.pill,
    backgroundColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
  },
  planPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.brandSecondary,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    marginTop: spacing.md,
  },
});
