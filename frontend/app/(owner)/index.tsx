import { useCallback, useState } from "react";
import { View, ScrollView, RefreshControl, Pressable, StyleProp, ViewStyle } from "react-native";
import { useFocusEffect, router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen, AppHeader, T, Card, Row, LoadingView, EmptyState, Badge } from "@/src/components/ui";
import { HostelFormSheet } from "@/src/components/HostelFormSheet";
import { HostelSwitcher } from "@/src/components/HostelSwitcher";
import { AdvertisementSlot } from "@/src/components/AdvertisementSlot";
import { useOwnerHostel } from "@/src/context/OwnerHostelContext";
import { api } from "@/src/api/client";
import { useAuth } from "@/src/context/AuthContext";
import { colors, spacing, radius, type } from "@/src/theme";

const dashboardCardColors = {
  portfolio: "#1D4ED8",
  portfolioBorder: "#1E3A8A",
  hostelStatus: "#B45309",
  hostelStatusBorder: "#78350F",
  subscription: "#6D28D9",
  subscriptionBorder: "#4C1D95",
  occupancy: "#2563EB",
  occupancyBorder: "#1E3A8A",
  collection: "#047857",
  collectionBorder: "#064E3B",
  expenses: "#DC2626",
  expensesBorder: "#991B1B",
  profit: "#16A34A",
  profitBorder: "#166534",
  pendingPayments: "#9A3412",
  pendingPaymentsBorder: "#7C2D12",
  rooms: "#EA580C",
  roomsBorder: "#9A3412",
  tenants: "#7E22CE",
  tenantsBorder: "#581C87",
  vacantBeds: "#7C3AED",
  vacantBedsBorder: "#4C1D95",
  upcomingRent: "#0E7490",
  upcomingRentBorder: "#164E63",
} as const;

export default function OwnerDashboard() {
  const { user, logout } = useAuth();
  const { hostels, activeId, activeHostel, loading: hLoading, refresh } = useOwnerHostel();
  const [data, setData] = useState<any>(null);
  const [portfolio, setPortfolio] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

  const load = useCallback(async () => {
    if (!activeId) {
      setLoading(false);
      return;
    }
    try {
      const d = await api.get(`/owner/dashboard?hostel_id=${activeId}`);
      setData(d);
      const p = await api.get("/owner/portfolio");
      setPortfolio(p);
    } catch {
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [activeId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (hLoading) return <Screen><LoadingView /></Screen>;

  if (hostels.length === 0) {
    return (
      <Screen edges={["top"]}>
        <AppHeader title="Get started" subtitle={`Hi, ${user?.name || "Owner"}`} right={<LogoutBtn onPress={logout} />} />
        <ScrollView contentContainerStyle={{ flexGrow: 1, padding: spacing.lg, gap: spacing.md }}>
          <AdvertisementSlot />
          <EmptyState
            icon="business-outline"
            title="Add your first hostel"
            subtitle="Create your property to start managing rooms, tenants, rent and more. You can add multiple hostels."
            ctaLabel="Add Property"
            onCta={() => setFormOpen(true)}
          />
        </ScrollView>
        {formOpen ? <HostelFormSheet visible onClose={() => setFormOpen(false)} initial={null} onSaved={async () => { setFormOpen(false); await refresh(); }} /> : null}
      </Screen>
    );
  }

  if (!data) return <Screen><LoadingView /></Screen>;

  const QuickAction = ({ icon, label, to }: { icon: any; label: string; to: string }) => (
    <Pressable testID={`qa-${label}`} onPress={() => router.push(to as any)} style={styles.qa}>
      <View style={styles.qaIcon}><Ionicons name={icon} size={20} color={colors.brand} /></View>
      <T size={type.sm} weight="semibold" color={colors.onSurface}>{label}</T>
    </Pressable>
  );

  return (
    <Screen edges={["top"]}>
      <AppHeader
        title="Dashboard"
        subtitle={`Hi, ${user?.name || "Owner"}`}
        right={<LogoutBtn onPress={logout} />}
      />
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing["3xl"] }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brand} />}
      >
        <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
          <HostelSwitcher />
          {data ? <Badge label={data.hostel_status === "approved" ? "Live" : data.hostel_status} tone={data.hostel_status === "approved" ? "success" : "warning"} /> : null}
        </Row>

        <AdvertisementSlot />

        {portfolio && portfolio.total_hostels > 1 ? (
          <Card style={{
            backgroundColor: dashboardCardColors.portfolio,
            borderColor: dashboardCardColors.portfolioBorder,
            borderWidth: 2,
            borderRadius: radius.md,
            gap: spacing.md,
          }}>
            <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
              <Row style={{ gap: 6 }}>
                <Ionicons name="albums" size={18} color="#FFFFFF" />
                <T weight="extrabold" size={type.lg} color="#FFFFFF">All Properties</T>
              </Row>
              <T size={type.sm} color="#FFFFFF">{portfolio.total_hostels} hostels</T>
            </Row>
            <Row style={{ justifyContent: "space-between" }}>
              <PortStat label="Net Profit" value={`₹${portfolio.net_profit}`} />
              <PortStat label="Occupancy" value={`${portfolio.occupancy_pct}%`} />
              <PortStat label="Tenants" value={portfolio.total_tenants} />
              <PortStat label="Beds" value={portfolio.total_beds} />
            </Row>
            <View style={{ height: 1, backgroundColor: "rgba(255,255,255,0.35)" }} />
            <Row style={{ justifyContent: "space-between" }}>
              <T size={type.sm} color="#FFFFFF">
                Collected ₹{portfolio.total_collection} · Spent ₹{portfolio.total_expenses}
              </T>
              {portfolio.pending_hostels ? (
                <T size={type.sm} weight="bold" color="#FFFFFF">{portfolio.pending_hostels} pending approval</T>
              ) : null}
            </Row>
            <T size={type.sm} color="#FFFFFF">
              Personal expenses (separate) · ₹{portfolio.personal_expenses || 0}
            </T>
            <T size={type.sm} color="#FFFFFF">
              Unclassified legacy expenses · ₹{portfolio.unclassified_expenses || 0}
            </T>
          </Card>
        ) : null}

        {data && data.hostel_status !== "approved" ? (
          <Card style={{
            backgroundColor: dashboardCardColors.hostelStatus,
            borderColor: dashboardCardColors.hostelStatusBorder,
            borderWidth: 2,
            borderRadius: radius.md,
          }}>
            <Row style={{ gap: spacing.sm }}>
              <Ionicons name="time" size={20} color="#FFFFFF" />
              <T size={type.sm} color="#FFFFFF" style={{ flex: 1 }}>
                Your hostel is <T weight="bold" color="#FFFFFF">{data.hostel_status}</T>. It will appear in public search once approved by admin.
              </T>
            </Row>
          </Card>
        ) : null}

        {data?.subscription ? (
          <Card style={{
            backgroundColor: dashboardCardColors.subscription,
            borderColor: dashboardCardColors.subscriptionBorder,
            borderWidth: 2,
            borderRadius: radius.md,
          }}>
            <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
              <Row style={{ gap: spacing.sm, flex: 1 }}>
                <Ionicons name={data.subscription.status === "trial" ? "gift" : data.subscription.status === "active" ? "diamond" : "alert-circle"} size={18} color="#FFFFFF" />
                <T size={type.sm} color="#FFFFFF" style={{ flex: 1 }}>
                  {data.subscription.status === "trial" ? `Free trial · ${data.subscription.days_left} days left` :
                   data.subscription.status === "active" ? `${data.subscription.plan} · ${data.subscription.days_left} days left` :
                   "Subscription expired — renew to stay premium"}
                </T>
              </Row>
              <Pressable testID="dash-upgrade" onPress={() => router.push("/(owner)/more" as any)}>
                <T size={type.sm} weight="bold" color="#FFFFFF">{data.subscription.status === "active" ? "Manage" : "Upgrade"}</T>
              </Pressable>
            </Row>
          </Card>
        ) : null}

        {/* Occupancy hero */}
        <Card style={{
          backgroundColor: dashboardCardColors.occupancy,
          borderColor: dashboardCardColors.occupancyBorder,
          borderWidth: 2,
          borderRadius: radius.md,
          gap: spacing.sm,
        }}>
          <Row style={{ justifyContent: "space-between" }}>
            <T weight="bold" size={type.lg} color="#FFFFFF">Occupancy</T>
            <T weight="extrabold" size={type.xl} color="#FFFFFF">{data.occupancy_pct}%</T>
          </Row>
          <View style={[styles.progressTrack, { backgroundColor: "rgba(255,255,255,0.3)" }]}>
            <View style={[styles.progressFill, { width: `${data.occupancy_pct}%`, backgroundColor: "#0F766E" }]} />
          </View>
          <Row style={{ justifyContent: "space-between" }}>
            <T size={type.sm} weight="bold" color="#FFFFFF">{data.occupied_beds} filled beds</T>
            <T size={type.sm} weight="bold" color="#FFFFFF">{data.available_beds} available beds</T>
          </Row>
        </Card>

        <Row style={{ gap: spacing.md }}>
          <DashboardStatCard style={styles.statCard} color={dashboardCardColors.collection} borderColor={dashboardCardColors.collectionBorder} label="Monthly Collection" value={`₹${data.monthly_collection}`} icon="cash" testID="stat-collection" />
          <DashboardStatCard style={styles.statCard} color={dashboardCardColors.expenses} borderColor={dashboardCardColors.expensesBorder} label="Monthly Expenses" value={`₹${data.monthly_expenses}`} icon="trending-down" />
        </Row>
        <Row style={{ gap: spacing.md }}>
          <DashboardStatCard style={styles.statCard} color={dashboardCardColors.profit} borderColor={dashboardCardColors.profitBorder} label="Monthly Profit" value={`₹${data.monthly_profit}`} icon="stats-chart" />
          <DashboardStatCard style={styles.statCard} color={dashboardCardColors.pendingPayments} borderColor={dashboardCardColors.pendingPaymentsBorder} label="Pending Payments" value={data.pending_payments} icon="alert-circle" />
        </Row>
        <Row style={{ gap: spacing.md }}>
          <DashboardStatCard style={styles.statCard} color={dashboardCardColors.rooms} borderColor={dashboardCardColors.roomsBorder} label="Total Rooms" value={data.total_rooms} icon="home" />
          <DashboardStatCard style={styles.statCard} color={dashboardCardColors.tenants} borderColor={dashboardCardColors.tenantsBorder} label="Total Tenants" value={data.total_tenants} icon="people" />
        </Row>
        <Row style={{ gap: spacing.md }}>
          <DashboardStatCard style={styles.statCard} color={dashboardCardColors.vacantBeds} borderColor={dashboardCardColors.vacantBedsBorder} label="Vacant Beds" value={data.available_beds} icon="bed-outline" />
          <DashboardStatCard style={styles.statCard} color={dashboardCardColors.upcomingRent} borderColor={dashboardCardColors.upcomingRentBorder} label="Upcoming Rent Due" value={`₹${data.upcoming_rent_due}`} icon="calendar" />
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

function DashboardStatCard({
  label,
  value,
  icon,
  color,
  borderColor,
  style,
  testID,
}: {
  label: string;
  value: string | number;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  borderColor: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  return (
    <View
      testID={testID}
      style={[
        styles.statCard,
        style,
        { backgroundColor: color, borderColor },
      ]}
    >
      <View style={styles.statIcon}>
        <Ionicons name={icon} size={18} color="#FFFFFF" />
      </View>
      <T weight="extrabold" size={type["2xl"]} color="#FFFFFF" style={{ marginTop: spacing.sm }}>
        {value}
      </T>
      <T size={type.sm} weight="bold" color="#FFFFFF" numberOfLines={2}>
        {label}
      </T>
    </View>
  );
}

function PortStat({ label, value }: { label: string; value: string | number }) {
  return (
    <View style={{ alignItems: "flex-start" }}>
      <T weight="extrabold" size={type.lg} color="#FFFFFF">{value}</T>
      <T size={11} color="#FFFFFF">{label}</T>
    </View>
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
    backgroundColor: "#FFFFFF",
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  statCard: {
    flex: 1,
    borderWidth: 2,
    borderRadius: radius.md,
    padding: spacing.lg,
  },
  statIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center" as const,
    justifyContent: "center" as const,
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
