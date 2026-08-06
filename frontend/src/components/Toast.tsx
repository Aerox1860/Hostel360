import React, { createContext, useCallback, useContext, useRef, useState } from "react";
import { Animated, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, radius, font, type, shadow } from "@/src/theme";

type ToastType = "success" | "error" | "info";
interface ToastState {
  message: string;
  type: ToastType;
}

const ToastCtx = createContext<{ show: (message: string, type?: ToastType) => void }>({
  show: () => {},
});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback(
    (message: string, ttype: ToastType = "success") => {
      setToast({ message, type: ttype });
      Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        Animated.timing(opacity, { toValue: 0, duration: 250, useNativeDriver: true }).start(() =>
          setToast(null)
        );
      }, 2600);
    },
    [opacity]
  );

  const cfg = {
    success: { bg: colors.brand, icon: "checkmark-circle" as const },
    error: { bg: colors.error, icon: "alert-circle" as const },
    info: { bg: colors.info, icon: "information-circle" as const },
  };

  return (
    <ToastCtx.Provider value={{ show }}>
      {children}
      {toast ? (
        <SafeAreaView edges={["top"]} pointerEvents="none" style={styles.wrap}>
          <Animated.View style={[styles.toast, { backgroundColor: cfg[toast.type].bg, opacity }]}>
            <Ionicons name={cfg[toast.type].icon} size={20} color="#fff" />
            <View style={{ flex: 1 }}>
              <Animated.Text style={styles.text}>{toast.message}</Animated.Text>
            </View>
          </Animated.View>
        </SafeAreaView>
      ) : null}
    </ToastCtx.Provider>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 9999,
  },
  toast: {
    marginTop: spacing.sm,
    marginHorizontal: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    maxWidth: 460,
    ...shadow.float,
  },
  text: {
    color: "#fff",
    fontFamily: font.semibold,
    fontSize: type.base,
  },
});
