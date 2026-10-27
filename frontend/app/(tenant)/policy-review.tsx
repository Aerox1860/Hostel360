import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useFocusEffect, router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen, AppHeader, T, Card, Btn } from "@/src/components/ui";
import { useAuth } from "@/src/context/AuthContext";
import { api } from "@/src/api/client";
import { colors, radius, spacing, type } from "@/src/theme";

type PendingPolicy = {
  id: string;
  version: number;
  text: string;
  published_at: string;
};

function AcknowledgementCelebration({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [scale] = useState(() => new Animated.Value(0.85));
  const [opacity] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (!visible) return;
    scale.setValue(0.85);
    opacity.setValue(0);
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, friction: 6, tension: 55, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
  }, [opacity, scale, visible]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.successBackdrop}>
        <Animated.View style={[styles.successCard, { opacity, transform: [{ scale }] }]}>
          <View style={styles.flowers}>
            <T size={30}>🌸</T>
            <T size={24}>✨</T>
            <T size={34}>🌼</T>
            <T size={24}>🎉</T>
            <T size={30}>🌷</T>
          </View>
          <View style={styles.successCheck}>
            <Ionicons name="checkmark" size={36} color={colors.onBrandPrimary} />
          </View>
          <T weight="extrabold" size={type.xl} style={{ textAlign: "center" }}>
            Thank you for reading and acknowledging the hostel rules!
          </T>
          <Btn title="Continue" onPress={onClose} testID="policy-acknowledgement-continue" />
        </Animated.View>
      </View>
    </Modal>
  );
}

export default function TenantPolicyReview() {
  const { completePolicyReview, refreshPolicyStatus } = useAuth();
  const [policy, setPolicy] = useState<PendingPolicy | null>(null);
  const [loading, setLoading] = useState(true);
  const [checked, setChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  const loadPolicy = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await api.get<{ required: boolean; policy: PendingPolicy | null }>("/tenant/rules/pending");
      if (!result.required || !result.policy) {
        completePolicyReview();
        router.replace("/(tenant)" as any);
        return;
      }
      setPolicy(result.policy);
      setChecked(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the current hostel rules.");
    } finally {
      setLoading(false);
    }
  }, [completePolicyReview]);

  useFocusEffect(useCallback(() => {
    void loadPolicy();
  }, [loadPolicy]));

  const submitAcknowledgement = async () => {
    if (!policy || !checked || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const result = await api.post<{ ok: boolean }>("/tenant/rules/acknowledge", {
        policy_id: policy.id,
      });
      if (result.ok !== true) throw new Error("The server did not confirm your acknowledgement. Please retry.");
      completePolicyReview();
      setSuccess(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not submit your acknowledgement. Please retry.");
    } finally {
      setSubmitting(false);
    }
  };

  const closeSuccess = () => {
    setSuccess(false);
    router.replace("/(tenant)" as any);
    void refreshPolicyStatus();
  };

  if (loading) {
    return (
      <Screen edges={["top", "bottom"]}>
        <AppHeader title="Rules & Regulations" />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.brand} />
          <T color={colors.onSurfaceSecondary}>Loading the current hostel rules...</T>
        </View>
      </Screen>
    );
  }

  if (!policy) {
    return (
      <Screen edges={["top", "bottom"]}>
        <AppHeader title="Rules & Regulations" />
        <View style={styles.centered}>
          <Ionicons name="cloud-offline-outline" size={36} color={colors.error} />
          <T weight="bold" size={type.lg}>Could not load the rules</T>
          <T color={colors.onSurfaceSecondary} style={{ textAlign: "center" }}>{error || "Try again when you have a connection."}</T>
          <Btn title="Retry" icon="refresh" onPress={() => void loadPolicy()} testID="policy-review-retry" />
        </View>
      </Screen>
    );
  }

  return (
    <Screen edges={["top", "bottom"]}>
      <AppHeader title="Rules & Regulations" subtitle={`Required policy version ${policy.version}`} />
      <ScrollView contentContainerStyle={styles.content}>
        <Card style={{ gap: spacing.sm }}>
          <T weight="extrabold" size={type.lg}>Please review the current hostel rules</T>
          <T size={type.sm} color={colors.onSurfaceSecondary}>
            Read the complete policy below. You must confirm that you have read and understood it to continue.
          </T>
          <T size={11} color={colors.onSurfaceTertiary}>
            Published {new Date(policy.published_at).toLocaleString()}
          </T>
        </Card>

        <Card style={styles.policyCard}>
          <T weight="extrabold" size={type.xl}>Rules & Regulations</T>
          <T style={styles.policyText}>{policy.text}</T>
        </Card>

        <Pressable
          testID="policy-acknowledgement-checkbox"
          accessibilityRole="checkbox"
          accessibilityState={{ checked }}
          onPress={() => setChecked((value) => !value)}
          style={styles.checkboxRow}
        >
          <View style={[styles.checkbox, checked ? styles.checkboxChecked : null]}>
            {checked ? <Ionicons name="checkmark" size={18} color={colors.onBrandPrimary} /> : null}
          </View>
          <T weight="semibold" style={{ flex: 1 }}>
            I confirm that I have read and understood these Rules & Regulations.
          </T>
        </Pressable>

        {error ? (
          <Card style={styles.errorCard}>
            <T color={colors.error}>{error}</T>
            <Btn title="Retry" variant="ghost" icon="refresh" onPress={() => void loadPolicy()} testID="policy-acknowledgement-retry" />
          </Card>
        ) : null}

        <Btn
          title="Submit acknowledgement"
          icon="checkmark-circle"
          onPress={() => void submitAcknowledgement()}
          loading={submitting}
          disabled={!checked || submitting}
          testID="policy-acknowledgement-submit"
        />
        {submitting ? <T size={type.sm} color={colors.onSurfaceSecondary} style={{ textAlign: "center" }}>Saving your acknowledgement securely...</T> : null}
      </ScrollView>
      <AcknowledgementCelebration visible={success} onClose={closeSuccess} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, paddingBottom: spacing["3xl"], gap: spacing.md },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.xl },
  policyCard: { gap: spacing.md, padding: spacing.lg },
  policyText: { lineHeight: 25, fontSize: type.base },
  checkboxRow: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.brandTertiary },
  checkbox: { width: 26, height: 26, borderWidth: 2, borderColor: colors.brand, borderRadius: 6, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  checkboxChecked: { backgroundColor: colors.brand },
  errorCard: { gap: spacing.sm, borderColor: colors.error, backgroundColor: "#FFF7F7" },
  successBackdrop: { flex: 1, backgroundColor: "rgba(26,29,26,0.55)", alignItems: "center", justifyContent: "center", padding: spacing.xl },
  successCard: { width: "100%", maxWidth: 380, gap: spacing.lg, padding: spacing.xl, borderRadius: radius.lg, backgroundColor: colors.surface, alignItems: "center" },
  flowers: { minHeight: 46, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm },
  successCheck: { width: 64, height: 64, borderRadius: radius.pill, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" },
});
