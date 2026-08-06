import { useCallback, useState } from "react";
import { View, ScrollView, RefreshControl, Pressable } from "react-native";
import { useFocusEffect, router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen, AppHeader, T, StatCard, Card, Row, LoadingView, Btn } from "@/src/components/ui";
import { api } from "@/src/api/client";
import { useAuth } from "@/src/context/AuthContext";
import { useToast } from "@/src/components/Toast";
import { colors, spacing, radius, type } from "@/src/theme";

export default function AdminDashboard() {
  const { user, logout } = useAuth();
  const toast = useToast();
  const [stats, setStats] = useState<any>(null);
  const [pending, setPending] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const s = await api.get("/admin/dashboard");
      const h = await api.get<{ hostels: any[] }>("/admin/hostels?status_filter=pending");
      setStats(s);
      setPending(h.hostels);
    } catch {
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const act = async (id: string, action: "approve" | "reject") => {
    try {
      await api.post(`/admin/hostels/${id}/verify`, { action, site_visit_status: action === "approve" ? "verified" : undefined });
      toast.show(`Hostel ${action}d`);
      load();
    } catch (e: any) {
      toast.show(e.message, "error");
    }
  };

  if (loading) return <Screen><LoadingView /></Screen>;

  return (
    <Screen edges={["top"]}>
      <AppHeader
        title="Platform Overview"
        subtitle={`Hi, ${user?.name || "Admin"}`}
        right={
          <Pressable testID="admin-logout" onPress={logout} hitSlop={10} style={iconBtn}>
            <Ionicons name="log-out-outline" size={20} color={colors.onSurface} />
          </Pressable>
        }
      />
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing["3xl"] }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brand} />}
      >
        <Row style={{ gap: spacing.md }}>
          <StatCard style={{ flex: 1 }} label="Total Hostels" value={stats.total_hostels} icon="business" tone="brand" testID="stat-hostels" />
          <StatCard style={{ flex: 1 }} label="Total Owners" value={stats.total_owners} icon="people" tone="info" />
        </Row>
        <Row style={{ gap: spacing.md }}>
          <StatCard style={{ flex: 1 }} label="Active Owners" value={stats.active_owners} icon="checkmark-circle" tone="success" />
          <StatCard style={{ flex: 1 }} label="Inactive Owners" value={stats.inactive_owners} icon="close-circle" tone="neutral" />
        </Row>
        <Row style={{ gap: spacing.md }}>
          <StatCard style={{ flex: 1 }} label="Premium Plans" value={stats.premium_plans} icon="diamond" tone="brand" />
          <StatCard style={{ flex: 1 }} label="Total Revenue" value={`$${stats.total_revenue}`} icon="cash" tone="success" />
        </Row>
        <Row style={{ gap: spacing.md }}>
          <StatCard style={{ flex: 1 }} label="Expired Plans" value={stats.expired_plans} icon="time" tone="warning" />
          <StatCard style={{ flex: 1 }} label="New Registrations" value={stats.new_registrations} icon="add-circle" tone="info" />
        </Row>

        <View style={{ marginTop: spacing.sm, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <T weight="extrabold" size={type.lg}>Pending Verification</T>
          <View style={{ backgroundColor: colors.warning, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 }}>
            <T size={12} weight="bold" color="#fff">{pending.length}</T>
          </View>
        </View>

        {pending.length === 0 ? (
          <Card><T color={colors.onSurfaceSecondary}>No hostels pending verification. All caught up! 🎉</T></Card>
        ) : (
          pending.map((h) => (
            <Card key={h.id} testID={`pending-${h.id}`} style={{ gap: spacing.sm }}>
              <T weight="bold" size={type.lg}>{h.name}</T>
              <Row style={{ gap: 4 }}>
                <Ionicons name="person" size={13} color={colors.onSurfaceSecondary} />
                <T size={type.sm} color={colors.onSurfaceSecondary}>{h.owner_name} · {h.mobile}</T>
              </Row>
              <Row style={{ gap: 4 }}>
                <Ionicons name="location" size={13} color={colors.onSurfaceSecondary} />
                <T size={type.sm} color={colors.onSurfaceSecondary}>{h.address}, {h.city}</T>
              </Row>
              <Row style={{ gap: spacing.sm, marginTop: spacing.xs }}>
                <View style={{ flex: 1 }}>
                  <Btn title="Approve" icon="checkmark" onPress={() => act(h.id, "approve")} testID={`approve-${h.id}`} />
                </View>
                <View style={{ flex: 1 }}>
                  <Btn title="Reject" variant="danger" icon="close" onPress={() => act(h.id, "reject")} testID={`reject-${h.id}`} />
                </View>
              </Row>
              <Pressable onPress={() => router.push(`/hostel/${h.id}` as any)} testID={`view-${h.id}`}>
                <T size={type.sm} weight="semibold" color={colors.brand} style={{ textAlign: "center", marginTop: 2 }}>
                  View full details
                </T>
              </Pressable>
            </Card>
          ))
        )}
      </ScrollView>
    </Screen>
  );
}

const iconBtn = {
  width: 36,
  height: 36,
  borderRadius: radius.pill,
  alignItems: "center" as const,
  justifyContent: "center" as const,
  backgroundColor: colors.surfaceSecondary,
};
