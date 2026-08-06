import React from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleProp,
  ViewStyle,
  TextStyle,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { colors, spacing, radius, font, type, shadow } from "@/src/theme";

// ---------- Text ----------
export function T({
  children,
  weight = "regular",
  size = type.base,
  color = colors.onSurface,
  style,
  numberOfLines,
}: {
  children: React.ReactNode;
  weight?: keyof typeof font;
  size?: number;
  color?: string;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
}) {
  return (
    <Text
      numberOfLines={numberOfLines}
      style={[{ fontFamily: font[weight], fontSize: size, color }, style]}
    >
      {children}
    </Text>
  );
}

// ---------- Screen ----------
export function Screen({
  children,
  style,
  edges = ["top"],
  bg = colors.surfaceSecondary,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  edges?: ("top" | "bottom" | "left" | "right")[];
  bg?: string;
}) {
  return (
    <SafeAreaView edges={edges} style={[{ flex: 1, backgroundColor: bg }, style]}>
      {children}
    </SafeAreaView>
  );
}

// ---------- Header ----------
export function AppHeader({
  title,
  subtitle,
  right,
  onBack,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  onBack?: () => void;
}) {
  return (
    <View style={styles.header}>
      <View style={{ flexDirection: "row", alignItems: "center", flex: 1, gap: spacing.sm }}>
        {onBack ? (
          <Pressable testID="header-back" onPress={onBack} hitSlop={10} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
          </Pressable>
        ) : null}
        <View style={{ flex: 1 }}>
          <T weight="extrabold" size={type.xl} numberOfLines={1}>
            {title}
          </T>
          {subtitle ? (
            <T size={type.sm} color={colors.onSurfaceSecondary} numberOfLines={1}>
              {subtitle}
            </T>
          ) : null}
        </View>
      </View>
      {right}
    </View>
  );
}

// ---------- Card ----------
export function Card({
  children,
  style,
  onPress,
  testID,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  testID?: string;
}) {
  const inner = <View style={[styles.card, style]}>{children}</View>;
  if (onPress)
    return (
      <Pressable testID={testID} onPress={onPress} style={({ pressed }) => (pressed ? { opacity: 0.85 } : null)}>
        {inner}
      </Pressable>
    );
  return inner;
}

// ---------- StatCard ----------
export function StatCard({
  label,
  value,
  icon,
  tone = "brand",
  style,
  testID,
}: {
  label: string;
  value: string | number;
  icon: keyof typeof Ionicons.glyphMap;
  tone?: "brand" | "success" | "warning" | "error" | "info" | "neutral";
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const toneMap: Record<string, { bg: string; fg: string }> = {
    brand: { bg: colors.brandSecondary, fg: colors.brand },
    success: { bg: "#DCFCE7", fg: colors.success },
    warning: { bg: "#FEF3C7", fg: colors.warning },
    error: { bg: "#FEE2E2", fg: colors.error },
    info: { bg: "#CCFBF1", fg: colors.info },
    neutral: { bg: colors.surfaceTertiary, fg: colors.onSurfaceSecondary },
  };
  const t = toneMap[tone];
  return (
    <View testID={testID} style={[styles.statCard, style]}>
      <View style={[styles.statIcon, { backgroundColor: t.bg }]}>
        <Ionicons name={icon} size={18} color={t.fg} />
      </View>
      <T weight="extrabold" size={type["2xl"]} style={{ marginTop: spacing.sm }}>
        {value}
      </T>
      <T size={type.sm} color={colors.onSurfaceSecondary} numberOfLines={2}>
        {label}
      </T>
    </View>
  );
}

// ---------- Chip ----------
export function Chip({
  label,
  active,
  onPress,
  testID,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={() => {
        Haptics.selectionAsync().catch(() => {});
        onPress?.();
      }}
      style={[styles.chip, active ? styles.chipActive : null]}
    >
      <T
        size={type.sm}
        weight={active ? "semibold" : "medium"}
        color={active ? colors.onBrandPrimary : colors.onSurfaceSecondary}
      >
        {label}
      </T>
    </Pressable>
  );
}

// ---------- Button ----------
export function Btn({
  title,
  onPress,
  variant = "primary",
  loading,
  disabled,
  icon,
  style,
  testID,
}: {
  title: string;
  onPress?: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  loading?: boolean;
  disabled?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const map = {
    primary: { bg: colors.brand, fg: colors.onBrandPrimary, border: colors.brand },
    secondary: { bg: colors.brandSecondary, fg: colors.onBrandSecondary, border: colors.brandSecondary },
    ghost: { bg: "transparent", fg: colors.onSurface, border: colors.borderStrong },
    danger: { bg: colors.error, fg: colors.onError, border: colors.error },
  }[variant];
  const dis = disabled || loading;
  return (
    <Pressable
      testID={testID}
      disabled={dis}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
        onPress?.();
      }}
      style={({ pressed }) => [
        styles.btn,
        { backgroundColor: map.bg, borderColor: map.border },
        variant === "ghost" ? { borderWidth: 1.5 } : null,
        dis ? { opacity: 0.5 } : pressed ? { opacity: 0.88 } : null,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={map.fg} />
      ) : (
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          {icon ? <Ionicons name={icon} size={18} color={map.fg} /> : null}
          <T weight="bold" size={type.lg} color={map.fg}>
            {title}
          </T>
        </View>
      )}
    </Pressable>
  );
}

// ---------- Badge ----------
export function Badge({ label, tone = "neutral" }: { label: string; tone?: "brand" | "success" | "warning" | "error" | "info" | "neutral" }) {
  const toneMap: Record<string, { bg: string; fg: string }> = {
    brand: { bg: colors.brandSecondary, fg: colors.brand },
    success: { bg: "#DCFCE7", fg: colors.success },
    warning: { bg: "#FEF3C7", fg: colors.warning },
    error: { bg: "#FEE2E2", fg: colors.error },
    info: { bg: "#CCFBF1", fg: colors.info },
    neutral: { bg: colors.surfaceTertiary, fg: colors.onSurfaceSecondary },
  };
  const t = toneMap[tone];
  return (
    <View style={[styles.badge, { backgroundColor: t.bg }]}>
      <T size={type.sm} weight="semibold" color={t.fg}>
        {label}
      </T>
    </View>
  );
}

// ---------- Field ----------
export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  secureTextEntry,
  multiline,
  testID,
  autoCapitalize = "none",
}: {
  label?: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: "default" | "email-address" | "numeric" | "phone-pad";
  secureTextEntry?: boolean;
  multiline?: boolean;
  testID?: string;
  autoCapitalize?: "none" | "sentences" | "words";
}) {
  return (
    <View style={{ gap: spacing.xs }}>
      {label ? (
        <T size={type.sm} weight="semibold" color={colors.onSurfaceSecondary}>
          {label}
        </T>
      ) : null}
      <TextInput
        testID={testID}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.onSurfaceTertiary}
        keyboardType={keyboardType}
        secureTextEntry={secureTextEntry}
        multiline={multiline}
        autoCapitalize={autoCapitalize}
        style={[styles.input, multiline ? { height: 96, textAlignVertical: "top" } : null]}
      />
    </View>
  );
}

// ---------- States ----------
export function LoadingView({ label }: { label?: string }) {
  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color={colors.brand} />
      {label ? (
        <T color={colors.onSurfaceSecondary} style={{ marginTop: spacing.md }}>
          {label}
        </T>
      ) : null}
    </View>
  );
}

export function EmptyState({
  icon = "file-tray-outline",
  title,
  subtitle,
  ctaLabel,
  onCta,
  testID,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  ctaLabel?: string;
  onCta?: () => void;
  testID?: string;
}) {
  return (
    <View style={styles.center} testID={testID}>
      <View style={styles.emptyIcon}>
        <Ionicons name={icon} size={34} color={colors.brand} />
      </View>
      <T weight="bold" size={type.lg} style={{ marginTop: spacing.lg, textAlign: "center" }}>
        {title}
      </T>
      {subtitle ? (
        <T color={colors.onSurfaceSecondary} style={{ marginTop: spacing.xs, textAlign: "center", maxWidth: 280 }}>
          {subtitle}
        </T>
      ) : null}
      {ctaLabel && onCta ? (
        <View style={{ marginTop: spacing.lg, minWidth: 180 }}>
          <Btn title={ctaLabel} onPress={onCta} testID="empty-cta" />
        </View>
      ) : null}
    </View>
  );
}

// ---------- Bottom Sheet (Modal based) ----------
export function Sheet({
  visible,
  onClose,
  title,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.sheetHandle} />
        {title ? (
          <View style={styles.sheetHeader}>
            <T weight="extrabold" size={type.xl}>
              {title}
            </T>
            <Pressable testID="sheet-close" onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={24} color={colors.onSurfaceSecondary} />
            </Pressable>
          </View>
        ) : null}
        <KeyboardAwareScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          bottomOffset={20}
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["2xl"], gap: spacing.md }}
        >
          {children}
        </KeyboardAwareScrollView>
      </View>
    </Modal>
  );
}

// ---------- Row ----------
export function Row({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ flexDirection: "row", alignItems: "center" }, style]}>{children}</View>;
}

export const ui = { colors, spacing, radius, font, type, shadow };

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    gap: spacing.sm,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceSecondary,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
  statCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
  statIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  chip: {
    height: 36,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    flexShrink: 0,
  },
  chipActive: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
  },
  btn: {
    height: 52,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  badge: {
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radius.pill,
    alignSelf: "flex-start",
  },
  input: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: Platform.OS === "ios" ? 14 : 10,
    fontFamily: font.medium,
    fontSize: type.lg,
    color: colors.onSurface,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
  },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: radius.pill,
    backgroundColor: colors.brandSecondary,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: "rgba(26,29,26,0.45)",
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    maxHeight: "88%",
    paddingTop: spacing.sm,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.borderStrong,
    alignSelf: "center",
    marginBottom: spacing.sm,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
});
