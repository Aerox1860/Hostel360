import { useCallback, useState } from "react";
import { View, FlatList } from "react-native";
import { useFocusEffect } from "expo-router";
import { Screen, AppHeader, T, Card, Row, Badge, LoadingView, EmptyState, Sheet, Btn, Field } from "@/src/components/ui";
import { api } from "@/src/api/client";
import { useToast } from "@/src/components/Toast";
import { colors, spacing, type, radius } from "@/src/theme";

export default function AdminOwners() {
  const toast = useToast();
  const [owners, setOwners] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState<any>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetMode, setResetMode] = useState(false);

  const load = useCallback(async () => {
    try {
      const { owners } = await api.get<{ owners: any[] }>("/admin/owners");
      setOwners(owners);
    } catch {
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const act = async (action: string, newPassword?: string) => {
    if (!sel) return;
    try {
      await api.post<{ ok: boolean }>(`/admin/owners/${sel.id}/action`, {
        action,
        ...(newPassword ? { new_password: newPassword } : {}),
      });
      toast.show(action === "reset_password" ? "Owner password updated" : "Owner updated");
      setSel(null);
      setResetPassword("");
      setResetMode(false);
      load();
    } catch (e: any) {
      toast.show(e.message, "error");
    }
  };

  if (loading) return <Screen><LoadingView /></Screen>;

  return (
    <Screen edges={["top"]}>
      <AppHeader title="Owner Management" subtitle={`${owners.length} building owners`} />
      <FlatList
        data={owners}
        keyExtractor={(o) => o.id}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}
        ListEmptyComponent={<View style={{ flex: 1 }}><EmptyState icon="people-outline" title="No owners yet" /></View>}
        renderItem={({ item }) => (
          <Card testID={`owner-${item.id}`} style={{ gap: spacing.sm }}>
            <Row style={{ gap: spacing.md }}>
              <View style={styles.avatar}>
                <T weight="extrabold" color="#fff">{(item.name || "?")[0].toUpperCase()}</T>
              </View>
              <View style={{ flex: 1 }}>
                <T weight="bold" size={type.lg}>{item.name}</T>
                <T size={type.sm} color={colors.onSurfaceSecondary}>{item.email}</T>
                <T size={type.sm} color={colors.onSurfaceSecondary}>{item.mobile || "No mobile"} · {item.hostels} hostel(s)</T>
              </View>
            </Row>
            <Row style={{ gap: spacing.sm }}>
              <Badge label={item.active ? "Active" : "Inactive"} tone={item.active ? "success" : "neutral"} />
              {item.blocked ? <Badge label="Blocked" tone="error" /> : null}
            </Row>
            <Btn title="Manage Account" variant="secondary" icon="settings" onPress={() => setSel(item)} testID={`manage-owner-${item.id}`} />
          </Card>
        )}
      />

      <Sheet visible={!!sel} onClose={() => { setSel(null); setResetPassword(""); setResetMode(false); }} title={sel?.name}>
        <T color={colors.onSurfaceSecondary}>{sel?.email}</T>
        <View style={{ gap: spacing.sm }}>
          {sel?.active ? (
            <Btn title="Deactivate Account" variant="secondary" icon="pause" onPress={() => act("deactivate")} testID="owner-deactivate" />
          ) : (
            <Btn title="Activate Account" icon="play" onPress={() => act("activate")} testID="owner-activate" />
          )}
          {sel?.blocked ? (
            <Btn title="Unblock Owner" variant="secondary" icon="lock-open" onPress={() => act("unblock")} testID="owner-unblock" />
          ) : (
            <Btn title="Block Owner" variant="danger" icon="lock-closed" onPress={() => act("block")} testID="owner-block" />
          )}
          {!resetMode ? (
            <Btn title="Reset Password" variant="ghost" icon="key" onPress={() => setResetMode(true)} testID="owner-reset" />
          ) : (
            <>
              <Field
                label="New password"
                value={resetPassword}
                onChangeText={setResetPassword}
                placeholder="At least 8 characters"
                secureTextEntry
                testID="owner-reset-password"
              />
              <Btn
                title="Save new password"
                onPress={() => act("reset_password", resetPassword)}
                disabled={resetPassword.length < 8 || resetPassword.length > 72}
                testID="owner-reset-confirm"
              />
            </>
          )}
        </View>
      </Sheet>
    </Screen>
  );
}

const styles = {
  avatar: {
    width: 48,
    height: 48,
    borderRadius: radius.pill,
    backgroundColor: colors.info,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
};
