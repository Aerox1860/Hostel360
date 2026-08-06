import { useCallback, useState } from "react";
import { View, FlatList } from "react-native";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen, AppHeader, T, Card, Row, Badge, LoadingView, EmptyState, Btn } from "@/src/components/ui";
import { api } from "@/src/api/client";
import { useToast } from "@/src/components/Toast";
import { downloadReceipt } from "@/src/utils/invoice";
import { colors, spacing, type, radius } from "@/src/theme";

export default function TenantPayments() {
  const toast = useToast();
  const [payments, setPayments] = useState<any[]>([]);
  const [hostel, setHostel] = useState<any>(null);
  const [tenant, setTenant] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const d = await api.get<{ payments: any[]; hostel: any; tenant: any }>("/tenant/payments");
      setPayments(d.payments);
      setHostel(d.hostel);
      setTenant(d.tenant);
    } catch {
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const getReceipt = async (p: any) => {
    try {
      const res = await downloadReceipt({
        receipt_no: p.receipt_no,
        date: p.date,
        amount: p.amount,
        type: p.type,
        method: p.method,
        advance_amount: p.type === "rent" ? tenant?.advance_amount : undefined,
        tenant_name: tenant?.name,
        room_number: tenant?.room_number,
        bed_number: tenant?.bed_number,
        pg_name: hostel?.pg_name || hostel?.name,
        address: hostel?.address ? `${hostel.address}, ${hostel.city || ""}` : hostel?.city,
        contact: hostel?.mobile,
        owner_name: hostel?.owner_name,
      });
      if (res && res.ok === false) toast.show(res.error || "Could not open receipt", "error");
      else if (typeof window === "undefined") toast.show("Receipt ready to save/share", "success");
    } catch {
      toast.show("Could not generate receipt", "error");
    }
  };

  const total = payments.filter((p) => p.status === "paid").reduce((s, p) => s + p.amount, 0);

  if (loading) return <Screen><LoadingView /></Screen>;

  return (
    <Screen edges={["top"]}>
      <AppHeader title="Payments" subtitle="History & receipts" />
      <FlatList
        data={payments}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}
        ListHeaderComponent={
          payments.length ? (
            <Card style={{ backgroundColor: colors.brand, borderColor: colors.brand, marginBottom: spacing.xs }}>
              <T color="#fff" size={type.sm}>Total paid</T>
              <T weight="extrabold" size={type["2xl"]} color="#fff">₹{total}</T>
            </Card>
          ) : null
        }
        ListEmptyComponent={<View style={{ flex: 1 }}><EmptyState icon="receipt-outline" title="No payments yet" subtitle="Your rent receipts will appear here." /></View>}
        renderItem={({ item }) => (
          <Card testID={`tpay-${item.id}`} style={{ gap: spacing.sm }}>
            <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
              <Row style={{ gap: spacing.sm }}>
                <View style={styles.icon}><Ionicons name="checkmark-circle" size={18} color={colors.success} /></View>
                <View>
                  <T weight="bold" style={{ textTransform: "capitalize" }}>{item.type} payment</T>
                  <T size={type.sm} color={colors.onSurfaceSecondary}>{new Date(item.date).toLocaleDateString()} · {item.method}</T>
                </View>
              </Row>
              <T weight="extrabold" color={colors.brand}>₹{item.amount}</T>
            </Row>
            <Row style={{ justifyContent: "space-between", alignItems: "center", backgroundColor: colors.surfaceSecondary, borderRadius: radius.sm, padding: spacing.sm }}>
              <T size={type.sm} color={colors.onSurfaceSecondary}>Receipt: {item.receipt_no}</T>
              <Badge label="Paid" tone="success" />
            </Row>
            <Btn title="Download Receipt" variant="secondary" icon="download" onPress={() => getReceipt(item)} testID={`receipt-${item.id}`} />
          </Card>
        )}
      />
    </Screen>
  );
}

const styles = {
  icon: { width: 36, height: 36, borderRadius: radius.md, backgroundColor: "#DCFCE7", alignItems: "center" as const, justifyContent: "center" as const },
};
