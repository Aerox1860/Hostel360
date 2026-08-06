import { useCallback, useState } from "react";
import { View, ScrollView, RefreshControl, Pressable, Linking } from "react-native";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen, AppHeader, T, Card, Row, Badge, LoadingView, EmptyState, Btn } from "@/src/components/ui";
import { api } from "@/src/api/client";
import { useAuth } from "@/src/context/AuthContext";
import { useToast } from "@/src/components/Toast";
import { colors, spacing, radius, type } from "@/src/theme";
import * as WebBrowser from "expo-web-browser";

export default function TenantHome() {
  const { user, logout } = useAuth();
  const toast = useToast();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [paying, setPaying] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api.get("/tenant/home");
      setData(d);
    } catch {
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const payRent = async () => {
    setPaying(true);
    try {
      const res = await api.post<{ url: string }>("/payments/rent/checkout", {});
      await WebBrowser.openBrowserAsync(res.url);
    } catch (e: any) {
      toast.show(e.message || "Online payment not available yet", "error");
    } finally {
      setPaying(false);
    }
  };

  if (loading) return <Screen><LoadingView /></Screen>;

  if (!data?.has_allocation) {
    return (
      <Screen edges={["top"]}>
        <AppHeader title="My Room" subtitle={user?.name} right={<LogoutBtn onPress={logout} />} />
        <EmptyState
          icon="bed-outline"
          title="No active room allocation"
          subtitle="Your hostel owner hasn't allocated a room to you yet. Please contact them."
        />
      </Screen>
    );
  }

  const t = data.tenant;
  const h = data.hostel;
  const due = t.payment_status === "due";

  return (
    <Screen edges={["top"]}>
      <AppHeader title={`Hi, ${t.name.split(" ")[0]}`} subtitle={h?.name} right={<LogoutBtn onPress={logout} />} />
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: due ? 120 : spacing["3xl"] }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brand} />}
      >
        {/* Rent status hero */}
        <Card style={{ backgroundColor: due ? colors.warning : colors.brand, borderColor: "transparent", gap: spacing.sm }}>
          <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
            <View>
              <T color="#fff" size={type.sm}>Monthly Rent</T>
              <T weight="extrabold" size={type["3xl"]} color="#fff">₹{t.monthly_rent}</T>
            </View>
            <View style={{ backgroundColor: "rgba(255,255,255,0.22)", paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill }}>
              <T weight="bold" color="#fff">{due ? "DUE" : "PAID"}</T>
            </View>
          </Row>
          {t.last_paid ? <T size={type.sm} color="rgba(255,255,255,0.85)">Last paid: {new Date(t.last_paid).toLocaleDateString()}</T> : null}
        </Card>

        {/* Room details */}
        <Card style={{ gap: spacing.md }}>
          <T weight="extrabold" size={type.lg}>Room Details</T>
          <Row style={{ flexWrap: "wrap", gap: spacing.md }}>
            <Detail icon="business" label="Tenant ID" value={t.tenant_code} />
            <Detail icon="bed" label="Room" value={t.room_number} />
            <Detail icon="grid" label="Bed" value={t.bed_number} />
            <Detail icon="calendar" label="Joined" value={new Date(t.joining_date).toLocaleDateString()} />
            <Detail icon="wallet" label="Deposit" value={`₹${t.security_deposit}`} />
            <Detail icon="cash" label="Advance" value={`₹${t.advance_amount}`} />
          </Row>
        </Card>

        {/* Hostel info */}
        {h ? (
          <Card style={{ gap: spacing.sm }}>
            <T weight="extrabold" size={type.lg}>{h.name}</T>
            <Row style={{ gap: 4 }}>
              <Ionicons name="location" size={14} color={colors.onSurfaceSecondary} />
              <T size={type.sm} color={colors.onSurfaceSecondary} style={{ flex: 1 }}>{h.address}, {h.city}</T>
            </Row>
            <Btn title="Call Owner" variant="secondary" icon="call" onPress={() => Linking.openURL(`tel:${h.mobile}`)} testID="call-owner" />
          </Card>
        ) : null}
      </ScrollView>

      {due ? (
        <View style={styles.sticky}>
          <Btn title="Pay Rent Now" icon="card" onPress={payRent} loading={paying} testID="pay-rent" />
        </View>
      ) : null}
    </Screen>
  );
}

function Detail({ icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <View style={{ width: "45%", gap: 2 }}>
      <Row style={{ gap: 4 }}>
        <Ionicons name={icon} size={13} color={colors.brand} />
        <T size={type.sm} color={colors.onSurfaceSecondary}>{label}</T>
      </Row>
      <T weight="bold">{value}</T>
    </View>
  );
}

function LogoutBtn({ onPress }: { onPress: () => void }) {
  return (
    <Pressable testID="tenant-logout" onPress={onPress} hitSlop={10} style={{ width: 36, height: 36, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" }}>
      <Ionicons name="log-out-outline" size={20} color={colors.onSurface} />
    </Pressable>
  );
}

const styles = {
  sticky: {
    position: "absolute" as const,
    left: 0, right: 0, bottom: 0,
    padding: spacing.lg, paddingBottom: spacing.xl,
    backgroundColor: colors.surface,
    borderTopColor: colors.divider, borderTopWidth: 1,
  },
};
