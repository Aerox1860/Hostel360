import { useCallback, useState } from "react";
import { View, ScrollView, RefreshControl, Pressable } from "react-native";
import { useFocusEffect, router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen, AppHeader, T, StatCard, Card, Row, LoadingView, Btn, EmptyState } from "@/src/components/ui";
import { HostelFormSheet } from "@/src/components/HostelFormSheet";
import { api } from "@/src/api/client";
import { useAuth } from "@/src/context/AuthContext";
import { colors, spacing, radius, type } from "@/src/theme";

export default function OwnerDashboard() {
  const { user, logout } = useAuth();
  const [data, setData] = useState<any>(null);
  const [hostel, setHostel] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api.get("/owner/dashboard");
      setData(d);
      const { hostel } = await api.get<{ hostel: any }>("/owner/hostel");
      setHostel(hostel);
    } catch {
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading) return <Screen><LoadingView /></Screen>;

  if (!data?.has_hostel) {
    return (
      <Screen edges={["top"]}>
        <AppHeader title="Get started" subtitle={`Hi, ${user?.name || "Owner"}`} right={<LogoutBtn onPress={logout} />} />
        <EmptyState
          icon="business-outline"
          title="Add your first hostel"
          subtitle="Create your property to start managing rooms, tenants, rent and more."
          ctaLabel="Add Property"
          onCta={() => setFormOpen(true)}
        />
        <HostelFormSheet visible={formOpen} onClose={() => setFormOpen(false)} initial={null} onSaved={() => { setFormOpen(false); load(); }} />
      </Screen>
    );
  }

  const QuickAction = ({ icon, label, to }: { icon: any; label: string; to: string }) => (
    <Pressable testID={`qa-${label}`} onPress={() => router.push(to as any)} style={styles.qa}>
      <View style={styles.qaIcon}><Ionicons name={icon} size={20} color={colors.brand} /></View>
      <T size={type.sm} weight="semibold">{label}</T>
    </Pressable>
  );

  return (
    <Screen edges={["top"]}>
      <AppHeader
        title={hostel?.name || "My Hostel"}
        subtitle={data.hostel_status === "approved" ? "Approved & Live" : `Status: ${data.hostel_status}`}
        right={<LogoutBtn onPress={logout} />}
      />
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing["3xl"] }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brand} />}
      >
        {data.hostel_status !== "approved" ? (
          <Card style={{ backgroundColor: colors.brandTertiary, borderColor: colors.brandSecondary }}>
            <Row style={{ gap: spacing.sm }}>
              <Ionicons name="time" size={20} color={colors.warning} />
              <T size={type.sm} color={colors.onBrandSecondary} style={{ flex: 1 }}>
                Your hostel is <T weight="bold">{data.hostel_status}</T>. It will appear in public search once approved by admin.
              </T>
            </Row>
          </Card>
        ) : null}

        {/* Occupancy hero */}
        <Card style={{ gap: spacing.sm }}>
          <Row style={{ justifyContent: "space-between" }}>
            <T weight="bold" size={type.lg}>Occupancy</T>
            <T weight="extrabold" size={type.xl} color={colors.brand}>{data.occupancy_pct}%</T>
          </Row>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${data.occupancy_pct}%` }]} />
          </View>
          <Row style={{ justifyContent: "space-between" }}>
            <T size={type.sm} color={colors.onSurfaceSecondary}>{data.occupied_beds} occupied</T>
            <T size={type.sm} color={colors.onSurfaceSecondary}>{data.available_beds} available</T>
          </Row>
        </Card>

        <Row style={{ gap: spacing.md }}>
          <StatCard style={{ flex: 1 }} label="Monthly Collection" value={`₹${data.monthly_collection}`} icon="cash" tone="success" testID="stat-collection" />
          <StatCard style={{ flex: 1 }} label="Monthly Expenses" value={`₹${data.monthly_expenses}`} icon="trending-down" tone="warning" />
        </Row>
        <Row style={{ gap: spacing.md }}>
          <StatCard style={{ flex: 1 }} label="Monthly Profit" value={`₹${data.monthly_profit}`} icon="stats-chart" tone={data.monthly_profit >= 0 ? "brand" : "error"} />
          <StatCard style={{ flex: 1 }} label="Pending Payments" value={data.pending_payments} icon="alert-circle" tone="error" />
        </Row>
        <Row style={{ gap: spacing.md }}>
          <StatCard style={{ flex: 1 }} label="Total Rooms" value={data.total_rooms} icon="home" tone="info" />
          <StatCard style={{ flex: 1 }} label="Total Tenants" value={data.total_tenants} icon="people" tone="brand" />
        </Row>
        <Row style={{ gap: spacing.md }}>
          <StatCard style={{ flex: 1 }} label="Vacant Rooms" value={data.vacant_rooms} icon="bed-outline" tone="neutral" />
          <StatCard style={{ flex: 1 }} label="Upcoming Rent Due" value={`₹${data.upcoming_rent_due}`} icon="calendar" tone="warning" />
        </Row>

        <T weight="extrabold" size={type.lg} style={{ marginTop: spacing.sm }}>Quick Actions</T>
        <Row style={{ gap: spacing.md }}>
          <QuickAction icon="person-add" label="Add Tenant" to="/(owner)/tenants" />
          <QuickAction icon="add-circle" label="Add Room" to="/(owner)/rooms" />
          <QuickAction icon="cash" label="Collect Rent" to="/(owner)/money" />
          <QuickAction icon="megaphone" label="Post Notice" to="/(owner)/more" />
        </Row>
      </ScrollView>
    </Screen>
  );
}

function LogoutBtn({ onPress }: { onPress: () => void }) {
  return (
    <Pressable testID="owner-logout" onPress={onPress} hitSlop={10} style={{ width: 36, height: 36, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" }}>
      <Ionicons name="log-out-outline" size={20} color={colors.onSurface} />
    </Pressable>
  );
}

const styles = {
  qa: {
    flex: 1,
    alignItems: "center" as const,
    gap: 6,
    backgroundColor: colors.surface,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  qaIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.brandSecondary,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  progressTrack: {
    height: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceTertiary,
    overflow: "hidden" as const,
  },
  progressFill: {
    height: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.brand,
  },
};
