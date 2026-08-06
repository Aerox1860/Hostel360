import { useCallback, useState } from "react";
import { View, ScrollView, Pressable, FlatList } from "react-native";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen, AppHeader, T, Card, Row, Badge, LoadingView, EmptyState, Sheet, Btn, Field, Chip } from "@/src/components/ui";
import { useOwnerHostel } from "@/src/context/OwnerHostelContext";
import { api } from "@/src/api/client";
import { useToast } from "@/src/components/Toast";
import { colors, spacing, type, radius } from "@/src/theme";

const EXP_CATS = [
  { k: "electricity", label: "Electricity", icon: "flash" },
  { k: "water", label: "Water", icon: "water" },
  { k: "internet", label: "Internet", icon: "wifi" },
  { k: "gas", label: "Gas", icon: "flame" },
  { k: "staff_salary", label: "Staff Salary", icon: "people" },
  { k: "food", label: "Food", icon: "restaurant" },
  { k: "maintenance", label: "Maintenance", icon: "construct" },
  { k: "repairs", label: "Repairs", icon: "hammer" },
  { k: "other", label: "Other", icon: "ellipsis-horizontal" },
];

export default function Money() {
  const toast = useToast();
  const { activeId, activeHostel } = useOwnerHostel();
  const [tab, setTab] = useState<"rent" | "expenses">("rent");
  const [payments, setPayments] = useState<any[]>([]);
  const [tenants, setTenants] = useState<any[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [rentOpen, setRentOpen] = useState(false);
  const [selTenant, setSelTenant] = useState<any>(null);
  const [amount, setAmount] = useState("");
  const [ptype, setPtype] = useState("rent");
  const [method, setMethod] = useState("cash");

  const [expOpen, setExpOpen] = useState(false);
  const [cat, setCat] = useState("electricity");
  const [expAmt, setExpAmt] = useState("");
  const [expNote, setExpNote] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!activeId) { setLoading(false); return; }
    try {
      const r = await api.get<{ payments: any[]; tenants: any[] }>(`/owner/rent?hostel_id=${activeId}`);
      const e = await api.get<{ expenses: any[] }>(`/owner/expenses?hostel_id=${activeId}`);
      setPayments(r.payments);
      setTenants(r.tenants);
      setExpenses(e.expenses);
    } catch {
    } finally {
      setLoading(false);
    }
  }, [activeId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openCollect = (t: any) => {
    setSelTenant(t);
    setAmount(String(t.monthly_rent));
    setPtype("rent");
    setMethod("cash");
    setRentOpen(true);
  };

  const collectRent = async () => {
    if (!selTenant || !amount) return;
    setSaving(true);
    try {
      await api.post("/owner/rent", { tenant_id: selTenant.id, amount: parseInt(amount) || 0, type: ptype, method });
      toast.show("Payment recorded · Receipt generated");
      setRentOpen(false);
      load();
    } catch (e: any) { toast.show(e.message, "error"); }
    finally { setSaving(false); }
  };

  const addExpense = async () => {
    if (!expAmt) { toast.show("Enter amount", "error"); return; }
    setSaving(true);
    try {
      await api.post("/owner/expenses", { hostel_id: activeId, category: cat, amount: parseInt(expAmt) || 0, note: expNote, date: new Date().toISOString() });
      toast.show("Expense added");
      setExpOpen(false);
      setExpAmt(""); setExpNote(""); setCat("electricity");
      load();
    } catch (e: any) { toast.show(e.message, "error"); }
    finally { setSaving(false); }
  };

  const totalCollected = payments.filter((p) => p.status === "paid").reduce((s, p) => s + p.amount, 0);
  const totalExpense = expenses.reduce((s, e) => s + e.amount, 0);
  const dueTenants = tenants.filter((t) => t.payment_status === "due");

  if (loading) return <Screen><LoadingView /></Screen>;

  return (
    <Screen edges={["top"]}>
      <AppHeader title="Money" subtitle={activeHostel?.name || "Rent & expenses"} />
      {/* Segmented */}
      <View style={styles.segment}>
        {(["rent", "expenses"] as const).map((t) => (
          <Pressable key={t} testID={`seg-${t}`} onPress={() => setTab(t)} style={[styles.segBtn, tab === t ? styles.segActive : null]}>
            <T weight="bold" color={tab === t ? colors.onBrandPrimary : colors.onSurfaceSecondary} style={{ textTransform: "capitalize" }}>{t}</T>
          </Pressable>
        ))}
      </View>

      {tab === "rent" ? (
        <FlatList
          data={payments}
          keyExtractor={(p) => p.id}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}
          ListHeaderComponent={
            <View style={{ gap: spacing.md, marginBottom: spacing.xs }}>
              <Card style={{ backgroundColor: colors.brand, borderColor: colors.brand }}>
                <T color={colors.onBrandPrimary} size={type.sm}>Total collected</T>
                <T weight="extrabold" size={type["2xl"]} color={colors.onBrandPrimary}>₹{totalCollected}</T>
              </Card>
              {dueTenants.length > 0 ? (
                <Card style={{ gap: spacing.sm }}>
                  <Row style={{ gap: 6 }}>
                    <Ionicons name="alert-circle" size={16} color={colors.warning} />
                    <T weight="bold">Pending Dues ({dueTenants.length})</T>
                  </Row>
                  {dueTenants.map((t) => (
                    <Row key={t.id} style={{ justifyContent: "space-between", alignItems: "center" }}>
                      <View>
                        <T weight="semibold">{t.name}</T>
                        <T size={type.sm} color={colors.onSurfaceSecondary}>Room {t.room_number} · ₹{t.monthly_rent}</T>
                      </View>
                      <Pressable testID={`collect-${t.id}`} onPress={() => openCollect(t)} style={styles.collectBtn}>
                        <T size={type.sm} weight="bold" color="#fff">Collect</T>
                      </Pressable>
                    </Row>
                  ))}
                </Card>
              ) : null}
              <T weight="extrabold" size={type.lg}>Payment History</T>
            </View>
          }
          ListEmptyComponent={<EmptyState icon="receipt-outline" title="No payments yet" subtitle="Collected rent & receipts appear here." />}
          renderItem={({ item }) => (
            <Card testID={`payment-${item.id}`} style={{ gap: 4 }}>
              <Row style={{ justifyContent: "space-between" }}>
                <T weight="bold">{item.tenant_name}</T>
                <T weight="extrabold" color={colors.brand}>₹{item.amount}</T>
              </Row>
              <Row style={{ justifyContent: "space-between" }}>
                <T size={type.sm} color={colors.onSurfaceSecondary}>{item.receipt_no} · {item.method}</T>
                <Badge label={item.type} tone="brand" />
              </Row>
              <T size={12} color={colors.onSurfaceTertiary}>{new Date(item.date).toLocaleDateString()}</T>
            </Card>
          )}
        />
      ) : (
        <FlatList
          data={expenses}
          keyExtractor={(e) => e.id}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}
          ListHeaderComponent={
            <Card style={{ backgroundColor: colors.warning, borderColor: colors.warning, marginBottom: spacing.xs }}>
              <T color="#fff" size={type.sm}>Total expenses</T>
              <T weight="extrabold" size={type["2xl"]} color="#fff">₹{totalExpense}</T>
            </Card>
          }
          ListEmptyComponent={<EmptyState icon="wallet-outline" title="No expenses yet" subtitle="Track utilities, salaries and more." ctaLabel="Add Expense" onCta={() => setExpOpen(true)} />}
          renderItem={({ item }) => {
            const c = EXP_CATS.find((x) => x.k === item.category);
            return (
              <Card testID={`expense-${item.id}`} style={{ gap: 2 }}>
                <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
                  <Row style={{ gap: spacing.sm }}>
                    <View style={styles.expIcon}><Ionicons name={(c?.icon as any) || "cash"} size={16} color={colors.warning} /></View>
                    <View>
                      <T weight="bold">{c?.label || item.category}</T>
                      {item.note ? <T size={type.sm} color={colors.onSurfaceSecondary}>{item.note}</T> : null}
                    </View>
                  </Row>
                  <T weight="extrabold" color={colors.error}>₹{item.amount}</T>
                </Row>
              </Card>
            );
          }}
        />
      )}

      {/* Floating add for expenses */}
      {tab === "expenses" ? (
        <Pressable testID="add-expense" onPress={() => setExpOpen(true)} style={styles.fab}>
          <Ionicons name="add" size={26} color="#fff" />
        </Pressable>
      ) : null}

      {/* Collect rent sheet */}
      <Sheet visible={rentOpen} onClose={() => setRentOpen(false)} title={`Collect from ${selTenant?.name || ""}`}>
        <Field label="Amount (₹)" value={amount} onChangeText={setAmount} placeholder="7000" keyboardType="numeric" testID="rent-amount" />
        <T size={type.sm} weight="semibold" color={colors.onSurfaceSecondary}>Type</T>
        <Row style={{ gap: spacing.sm }}>
          {["rent", "advance", "deposit"].map((t) => <Chip key={t} label={t} active={ptype === t} onPress={() => setPtype(t)} testID={`ptype-${t}`} />)}
        </Row>
        <T size={type.sm} weight="semibold" color={colors.onSurfaceSecondary}>Method</T>
        <Row style={{ gap: spacing.sm }}>
          {["cash", "upi", "bank"].map((m) => <Chip key={m} label={m} active={method === m} onPress={() => setMethod(m)} testID={`method-${m}`} />)}
        </Row>
        <Btn title="Record Payment" onPress={collectRent} loading={saving} testID="rent-record" />
      </Sheet>

      {/* Add expense sheet */}
      <Sheet visible={expOpen} onClose={() => setExpOpen(false)} title="Add Expense">
        <T size={type.sm} weight="semibold" color={colors.onSurfaceSecondary}>Category</T>
        <Row style={{ gap: spacing.sm, flexWrap: "wrap" }}>
          {EXP_CATS.map((c) => <Chip key={c.k} label={c.label} active={cat === c.k} onPress={() => setCat(c.k)} testID={`cat-${c.k}`} />)}
        </Row>
        <Field label="Amount (₹)" value={expAmt} onChangeText={setExpAmt} placeholder="3200" keyboardType="numeric" testID="exp-amount" />
        <Field label="Note" value={expNote} onChangeText={setExpNote} placeholder="Optional note" autoCapitalize="sentences" testID="exp-note" />
        <Btn title="Add Expense" onPress={addExpense} loading={saving} testID="exp-save" />
      </Sheet>
    </Screen>
  );
}

const styles = {
  segment: {
    flexDirection: "row" as const,
    margin: spacing.lg,
    marginBottom: 0,
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.md,
    padding: 4,
    gap: 4,
  },
  segBtn: { flex: 1, alignItems: "center" as const, paddingVertical: spacing.sm, borderRadius: radius.sm },
  segActive: { backgroundColor: colors.brand },
  collectBtn: { backgroundColor: colors.brand, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.sm },
  expIcon: { width: 36, height: 36, borderRadius: radius.md, backgroundColor: "#FEF3C7", alignItems: "center" as const, justifyContent: "center" as const },
  fab: {
    position: "absolute" as const,
    right: spacing.lg,
    bottom: spacing.xl,
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    backgroundColor: colors.brand,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
};
