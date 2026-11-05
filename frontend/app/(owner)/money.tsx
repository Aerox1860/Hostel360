
import { useCallback, useState } from "react";
import { View, Pressable, FlatList, Alert, Platform } from "react-native";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen, AppHeader, T, Card, Row, Badge, LoadingView, EmptyState, Sheet, Btn, Field, Chip } from "@/src/components/ui";
import { useOwnerHostel } from "@/src/context/OwnerHostelContext";
import { api } from "@/src/api/client";
import { useToast } from "@/src/components/Toast";
import { colors, spacing, type, radius } from "@/src/theme";
import { openRentPaymentScreenshot } from "@/src/utils/tenantReportEvidence";

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
  const { tab: requestedTab, payment_id: requestedPaymentId } = useLocalSearchParams<{
    tab?: string;
    payment_id?: string;
  }>();
  const [tab, setTab] = useState<"rent" | "approvals" | "expenses">("rent");
  const [payments, setPayments] = useState<any[]>([]);
  const [pendingPayments, setPendingPayments] = useState<any[]>([]);
  const [tenants, setTenants] = useState<any[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [categoryData, setCategoryData] = useState<{ hostelId: string | null; categories: any[] }>({
    hostelId: null,
    categories: [],
  });
  const [loading, setLoading] = useState(true);

  const [rentOpen, setRentOpen] = useState(false);
  const [selTenant, setSelTenant] = useState<any>(null);
  const [amount, setAmount] = useState("");
  const [ptype, setPtype] = useState("rent");
  const [method, setMethod] = useState("cash");

  const [expOpen, setExpOpen] = useState(false);
  const [cat, setCat] = useState("electricity");
  const [expensePurpose, setExpensePurpose] = useState<"property" | "personal" | null>("property");
  const [expAmt, setExpAmt] = useState("");
  const [expNote, setExpNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [categoryName, setCategoryName] = useState("");
  const [categoryDescription, setCategoryDescription] = useState("");
  const [categoryPurpose, setCategoryPurpose] = useState<"property" | "personal" | null>(null);
  const [savingCategory, setSavingCategory] = useState(false);
  const [rejectingPayment, setRejectingPayment] = useState<any>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const customCategories = categoryData.hostelId === activeId ? categoryData.categories : [];

  const load = useCallback(async () => {
    if (!activeId) { setLoading(false); return; }
    try {
      const r = await api.get<{ payments: any[]; pending_payments?: any[]; tenants: any[] }>(`/owner/rent?hostel_id=${activeId}`);
      const e = await api.get<{ expenses: any[] }>(`/owner/expenses?hostel_id=${activeId}`);
      const c = await api.get<{ categories: any[] }>(`/owner/expense-categories?hostel_id=${activeId}`);
      setPayments(r.payments.filter((payment) => !["pending_owner_approval", "approval_processing"].includes(payment.status)));
      setPendingPayments(r.pending_payments || r.payments.filter((payment) => ["pending_owner_approval", "approval_processing"].includes(payment.status)));
      setTenants(r.tenants);
      setExpenses(e.expenses);
      setCategoryData({ hostelId: activeId, categories: c.categories });
      setCat("electricity");
    } catch {
    } finally {
      setLoading(false);
    }
  }, [activeId]);

  useFocusEffect(useCallback(() => {
    if (requestedTab === "approvals") setTab("approvals");
    load();
  }, [load, requestedTab]));

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

  const approvePayment = async (payment: any) => {
    const approve = async () => {
      setSaving(true);
      try {
        await api.post(`/owner/rent/${encodeURIComponent(payment.id)}/approve`, {});
        toast.show("Payment approved · Receipt generated");
        await load();
      } catch (e: any) {
        toast.show(e.message || "Could not approve payment", "error");
      } finally {
        setSaving(false);
      }
    };
    const message = "Confirm this UPI transaction against your bank or UPI records before approving. Rent balance will be updated and a receipt issued.";
    if (Platform.OS === "web") {
      if (typeof window !== "undefined" && window.confirm(message)) await approve();
    } else {
      Alert.alert("Verify payment", message, [
        { text: "Cancel", style: "cancel" },
        { text: "I verified it", onPress: () => void approve() },
      ]);
    }
  };

  const rejectPayment = async () => {
    const reason = rejectionReason.trim();
    if (!rejectingPayment || !reason) {
      toast.show("Enter a rejection reason", "error");
      return;
    }
    setSaving(true);
    try {
      await api.post(`/owner/rent/${encodeURIComponent(rejectingPayment.id)}/reject`, { reason });
      setRejectingPayment(null);
      setRejectionReason("");
      toast.show("Payment rejected · Tenant notified");
      await load();
    } catch (e: any) {
      toast.show(e.message || "Could not reject payment", "error");
    } finally {
      setSaving(false);
    }
  };

  const viewPaymentScreenshot = async (paymentId: string) => {
    try {
      await openRentPaymentScreenshot(paymentId);
    } catch (e: any) {
      toast.show(e.message || "Could not open payment screenshot", "error");
    }
  };

  const addExpense = async () => {
    if (!expAmt) { toast.show("Enter amount", "error"); return; }
    if (!expensePurpose) { toast.show("Select what type of expense this is", "error"); return; }
    setSaving(true);
    try {
      await api.post("/owner/expenses", {
        hostel_id: activeId,
        category: cat,
        purpose: expensePurpose,
        amount: parseInt(expAmt) || 0,
        note: expNote,
        date: new Date().toISOString(),
      });
      toast.show("Expense added");
      setExpOpen(false);
      setExpAmt(""); setExpNote(""); setCat("electricity"); setExpensePurpose("property");
      load();
    } catch (e: any) { toast.show(e.message, "error"); }
    finally { setSaving(false); }
  };

  const addCustomCategory = async () => {
    if (savingCategory) return;
    const trimmedName = categoryName.trim();
    if (!trimmedName) {
      toast.show("Enter a category name", "error");
      return;
    }
    if (!categoryPurpose) {
      toast.show("Select what type of expense this category is for", "error");
      return;
    }
    setSavingCategory(true);
    try {
      const { category } = await api.post<{ category: any }>("/owner/expense-categories", {
        hostel_id: activeId,
        name: trimmedName,
        description: categoryDescription.trim() || null,
        purpose: categoryPurpose,
      });
      const currentCategoryData = {
        hostelId: activeId,
        categories: [
          ...(categoryData.hostelId === activeId ? categoryData.categories : []),
          category,
        ],
      };
      setCategoryData(currentCategoryData);
      setCat(category.name);
      setExpensePurpose(category.purpose);
      setCategoryName("");
      setCategoryDescription("");
      setCategoryPurpose(null);
      setCategoryOpen(false);
      try {
        const refreshed = await api.get<{ categories: any[] }>(
          `/owner/expense-categories?hostel_id=${activeId}`,
        );
        setCategoryData({ hostelId: activeId, categories: refreshed.categories });
        toast.show("Expense category added");
      } catch (e: any) {
        toast.show(e.message || "Category saved, but the list could not be refreshed", "error");
      }
    } catch (e: any) {
      toast.show(e.message || "Could not save category", "error");
    } finally {
      setSavingCategory(false);
    }
  };

  const totalCollected = payments.filter((p) => p.status === "paid").reduce((s, p) => s + p.amount, 0);
  const totalExpense = expenses.filter((e) => e.purpose === "property").reduce((s, e) => s + e.amount, 0);
  const totalPersonalExpense = expenses.filter((e) => e.purpose === "personal").reduce((s, e) => s + e.amount, 0);
  const totalUnclassifiedExpense = expenses
    .filter((e) => e.purpose !== "property" && e.purpose !== "personal")
    .reduce((s, e) => s + e.amount, 0);
  const dueTenants = tenants.filter((t) => t.payment_status === "due");

  if (loading) return <Screen><LoadingView /></Screen>;

  return (
    <Screen edges={["top"]}>
      <AppHeader title="Money" subtitle={activeHostel?.name || "Rent & expenses"} />
      {/* Segmented */}
      <View style={styles.segment}>
        {(["rent", "approvals", "expenses"] as const).map((t) => (
          <Pressable key={t} testID={`seg-${t}`} onPress={() => setTab(t)} style={[styles.segBtn, tab === t ? styles.segActive : null]}>
            <T weight="bold" color={tab === t ? colors.onBrandPrimary : colors.onSurfaceSecondary} style={{ textTransform: "capitalize" }}>
              {t === "approvals" ? `Approvals${pendingPayments.length ? ` (${pendingPayments.length})` : ""}` : t}
            </T>
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
                <T size={type.sm} color={colors.onSurfaceSecondary}>
                  {item.receipt_no ? `Receipt ${item.receipt_no}` : `UPI ref ${item.upi_reference || "—"}`} · {item.method}
                </T>
                <Badge label={item.status === "rejected" ? "Rejected" : item.type} tone={item.status === "rejected" ? "error" : "brand"} />
              </Row>
              {item.rejection_reason ? <T size={type.sm} color={colors.error}>Rejection reason: {item.rejection_reason}</T> : null}
              <T size={12} color={colors.onSurfaceTertiary}>{new Date(item.date).toLocaleDateString()}</T>
            </Card>
          )}
        />
      ) : tab === "approvals" ? (
        <FlatList
          data={requestedPaymentId
            ? [...pendingPayments].sort((a, b) => Number(b.id === requestedPaymentId) - Number(a.id === requestedPaymentId))
            : pendingPayments}
          keyExtractor={(payment) => payment.id}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}
          ListHeaderComponent={<T weight="extrabold" size={type.lg}>Verify UPI transfers against bank records</T>}
          ListEmptyComponent={<EmptyState icon="checkmark-done-outline" title="No payments awaiting approval" subtitle="Tenant UPI submissions will appear here." />}
          renderItem={({ item }) => (
            <Card testID={`rent-approval-${item.id}`} style={{ gap: spacing.sm }}>
              <Row style={{ justifyContent: "space-between" }}>
                <T weight="bold">{item.tenant_name}</T>
                <T weight="extrabold" color={colors.brand}>₹{item.amount}</T>
              </Row>
              <T size={type.sm} color={colors.onSurfaceSecondary}>Paid {new Date(item.date).toLocaleDateString()} · {item.method?.replaceAll("_", " ")}</T>
              {item.room_number ? <T size={type.sm} color={colors.onSurfaceSecondary}>Room {item.room_number}</T> : null}
              <T size={type.sm} weight="semibold">UPI reference: {item.upi_reference}</T>
              {item.evidence_id ? (
                <Btn
                  title="View payment screenshot"
                  variant="secondary"
                  icon="image-outline"
                  onPress={() => viewPaymentScreenshot(item.id)}
                  testID={`rent-evidence-${item.id}`}
                />
              ) : null}
              <T size={12} color={colors.warning}>This is a tenant-reported payment and has not been verified.</T>
              <Row style={{ gap: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <Btn title="Approve" icon="checkmark" onPress={() => approvePayment(item)} loading={saving} testID={`rent-approve-${item.id}`} />
                </View>
                <View style={{ flex: 1 }}>
                  <Btn title="Reject" variant="secondary" icon="close" onPress={() => { setRejectingPayment(item); setRejectionReason(""); }} testID={`rent-reject-${item.id}`} />
                </View>
              </Row>
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
              <T color="#fff" size={type.sm}>PG / Property expenses</T>
              <T weight="extrabold" size={type["2xl"]} color="#fff">₹{totalExpense}</T>
              <T color="#fff" size={type.sm}>Personal expenses · ₹{totalPersonalExpense}</T>
              <T color="#fff" size={type.sm}>Unclassified legacy expenses · ₹{totalUnclassifiedExpense}</T>
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
                      <T size={12} color={item.purpose === "personal" ? colors.info : item.purpose === "property" ? colors.onSurfaceTertiary : colors.warning}>
                        {item.purpose === "personal"
                          ? "Personal Expense"
                          : item.purpose === "property"
                            ? "PG / Property Expense"
                            : "Unclassified legacy expense"}
                      </T>
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

      <Sheet visible={Boolean(rejectingPayment)} onClose={() => setRejectingPayment(null)} title="Reject UPI payment">
        <T size={type.sm} color={colors.onSurfaceSecondary}>A rejection reason is required and will be shown to the tenant.</T>
        <Field label="Rejection reason *" value={rejectionReason} onChangeText={setRejectionReason} placeholder="Explain what could not be verified" multiline maxLength={1000} testID="rent-rejection-reason" />
        <Btn title="Reject and notify tenant" onPress={rejectPayment} loading={saving} disabled={!rejectionReason.trim()} testID="rent-rejection-submit" />
      </Sheet>

      {/* Add expense sheet */}
      <Sheet
        visible={expOpen}
        onClose={() => {
          if (categoryOpen) {
            setCategoryOpen(false);
            setCategoryPurpose(null);
          } else {
            setExpOpen(false);
          }
        }}
        title={categoryOpen ? "Add Custom Category" : "Add Expense"}
        centered
      >
        {categoryOpen ? (
          <>
            <Field
              label="Category Name *"
              value={categoryName}
              onChangeText={setCategoryName}
              placeholder="e.g. Insurance"
              autoCapitalize="words"
              testID="custom-category-name"
            />
            <Field
              label="Description (optional)"
              value={categoryDescription}
              onChangeText={setCategoryDescription}
              placeholder="What this expense category covers"
              autoCapitalize="sentences"
              testID="custom-category-description"
            />
            <T size={type.sm} weight="semibold" color={colors.onSurfaceSecondary}>What type of expense is this? *</T>
            <View style={{ gap: spacing.sm }}>
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ selected: categoryPurpose === "property" }}
                testID="custom-category-purpose-property"
                onPress={() => setCategoryPurpose("property")}
                style={[styles.purposeOption, categoryPurpose === "property" ? styles.purposeOptionActive : null]}
              >
                <T weight="bold">PG / Property Expense</T>
                <T size={type.sm} color={colors.onSurfaceSecondary}>A cost of running this property; included in its expenses and profit calculation.</T>
              </Pressable>
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ selected: categoryPurpose === "personal" }}
                testID="custom-category-purpose-personal"
                onPress={() => setCategoryPurpose("personal")}
                style={[styles.purposeOption, categoryPurpose === "personal" ? styles.purposeOptionActive : null]}
              >
                <T weight="bold">Personal Expense</T>
                <T size={type.sm} color={colors.onSurfaceSecondary}>Your personal spending; kept separate from property operating costs and profit.</T>
              </Pressable>
            </View>
            <Row style={{ gap: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Btn
                  title="Cancel"
                  variant="secondary"
                  disabled={savingCategory}
                  onPress={() => {
                    setCategoryOpen(false);
                    setCategoryPurpose(null);
                  }}
                  testID="custom-category-cancel"
                />
              </View>
              <View style={{ flex: 1 }}>
                <Btn
                  title="Save"
                  loading={savingCategory}
                  onPress={addCustomCategory}
                  testID="custom-category-save"
                />
              </View>
            </Row>
          </>
        ) : (
          <>
        <T size={type.sm} weight="semibold" color={colors.onSurfaceSecondary}>Category</T>
        <Row style={{ gap: spacing.sm, flexWrap: "wrap" }}>
          {EXP_CATS.map((c) => <Chip key={c.k} label={c.label} active={cat === c.k} onPress={() => { setCat(c.k); setExpensePurpose("property"); }} testID={`cat-${c.k}`} />)}
          {customCategories.map((c) => (
            <Chip
              key={c.id}
              label={c.name}
              active={cat === c.name}
              onPress={() => { setCat(c.name); setExpensePurpose(c.purpose || null); }}
              testID={`cat-custom-${c.id}`}
            />
          ))}
          <Chip
            label="+ Add Custom Category"
            onPress={() => setCategoryOpen(true)}
            testID="add-custom-expense-category"
          />
        </Row>
        <T size={type.sm} weight="semibold" color={colors.onSurfaceSecondary}>What type of expense is this?</T>
        <Row style={{ gap: spacing.sm }}>
          <Chip
            label="PG / Property Expense"
            active={expensePurpose === "property"}
            onPress={() => setExpensePurpose("property")}
            testID="expense-purpose-property"
          />
          <Chip
            label="Personal Expense"
            active={expensePurpose === "personal"}
            onPress={() => setExpensePurpose("personal")}
            testID="expense-purpose-personal"
          />
        </Row>
        <T size={12} color={colors.onSurfaceTertiary}>
          {expensePurpose === "property"
            ? "Included in this property's operating costs and profit."
            : expensePurpose === "personal"
              ? "Recorded separately and excluded from this property's operating costs and profit."
              : "Choose a purpose to classify this expense."}
        </T>
        <Field label="Amount (₹)" value={expAmt} onChangeText={setExpAmt} placeholder="3200" keyboardType="numeric" testID="exp-amount" />
        <Field label="Note" value={expNote} onChangeText={setExpNote} placeholder="Optional note" autoCapitalize="sentences" testID="exp-note" />
        <Btn title="Add Expense" onPress={addExpense} loading={saving} testID="exp-save" />
          </>
        )}
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
  purposeOption: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  purposeOptionActive: {
    borderColor: colors.brand,
    backgroundColor: colors.brandTertiary,
  },
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
