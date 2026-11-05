import { useEffect, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Platform,
  StyleSheet,
  View,
} from "react-native";
import { Redirect } from "expo-router";
import { Logo } from "@/src/components/Logo";
import { T } from "@/src/components/ui";
import { useAuth, routeForUser } from "@/src/context/AuthContext";
import { colors, spacing, type } from "@/src/theme";

export default function Index() {
  const { user, loading } = useAuth();
  const [animationComplete, setAnimationComplete] = useState(false);
  const [logoOpacity] = useState(() => new Animated.Value(0));
  const [logoScale] = useState(() => new Animated.Value(0.88));
  const [ringRotation] = useState(() => new Animated.Value(0));
  const [nameOpacity] = useState(() => new Animated.Value(0));
  const [nameOffset] = useState(() => new Animated.Value(14));
  const [taglineOpacity] = useState(() => new Animated.Value(0));

  useEffect(() => {
    let mounted = true;
    let animation: Animated.CompositeAnimation | undefined;

    const startAnimation = (reducedMotion: boolean) => {
      if (!mounted) return;
      if (reducedMotion) {
        logoOpacity.setValue(1);
        logoScale.setValue(1);
        ringRotation.setValue(1);
        nameOpacity.setValue(1);
        nameOffset.setValue(0);
        taglineOpacity.setValue(1);
        setAnimationComplete(true);
        return;
      }

      animation = Animated.parallel([
        Animated.timing(logoOpacity, {
          toValue: 1,
          duration: 850,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: Platform.OS !== "web",
        }),
        Animated.spring(logoScale, {
          toValue: 1,
          friction: 7,
          tension: 48,
          useNativeDriver: Platform.OS !== "web",
        }),
        Animated.timing(ringRotation, {
          toValue: 1,
          duration: 2850,
          easing: Easing.linear,
          useNativeDriver: Platform.OS !== "web",
        }),
        Animated.sequence([
          Animated.delay(650),
          Animated.parallel([
            Animated.timing(nameOpacity, {
              toValue: 1,
              duration: 850,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: Platform.OS !== "web",
            }),
            Animated.timing(nameOffset, {
              toValue: 0,
              duration: 850,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: Platform.OS !== "web",
            }),
          ]),
          Animated.timing(taglineOpacity, {
            toValue: 1,
            duration: 550,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: Platform.OS !== "web",
          }),
        ]),
      ]);
      animation.start(({ finished }) => {
        if (finished && mounted) setAnimationComplete(true);
      });
    };

    AccessibilityInfo.isReduceMotionEnabled()
      .then(startAnimation)
      .catch(() => startAnimation(false));

    return () => {
      mounted = false;
      animation?.stop();
    };
  }, [logoOpacity, logoScale, nameOffset, nameOpacity, ringRotation, taglineOpacity]);

  if (animationComplete && !loading) {
    return <Redirect href={(user ? routeForUser(user) : "/(public)") as any} />;
  }

  const rotation = ringRotation.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  return (
    <View style={styles.screen} accessibilityRole="progressbar" accessibilityLabel="Loading Hostel360">
      <View style={styles.content}>
        <View style={styles.mark}>
          <Animated.View
            style={[
              styles.ring,
              { transform: [{ rotate: rotation }] },
            ]}
          />
          <Animated.View
            style={[
              styles.logo,
              {
                opacity: logoOpacity,
                transform: [{ scale: logoScale }],
              },
            ]}
          >
            <Logo size={94} showText={false} />
          </Animated.View>
        </View>
        <Animated.View
          style={{
            alignItems: "center",
            opacity: nameOpacity,
            transform: [{ translateY: nameOffset }],
          }}
        >
          <T weight="extrabold" size={type["3xl"]} color={colors.onSurface}>
            Hostel<T weight="extrabold" size={type["3xl"]} color={colors.warning}>360</T>
          </T>
        </Animated.View>
        <Animated.View style={{ opacity: taglineOpacity, alignItems: "center" }}>
          <T size={type.base} color={colors.onSurfaceSecondary}>
            A better way to manage and find your stay
          </T>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brandTertiary,
    padding: spacing.xl,
  },
  content: {
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.lg,
  },
  mark: {
    width: 156,
    height: 156,
    alignItems: "center",
    justifyContent: "center",
  },
  ring: {
    position: "absolute",
    width: 150,
    height: 150,
    borderRadius: 75,
    borderWidth: 2,
    borderColor: colors.brandSecondary,
    borderTopColor: colors.warning,
    borderRightColor: colors.brand,
  },
  logo: {
    alignItems: "center",
    justifyContent: "center",
  },
});
