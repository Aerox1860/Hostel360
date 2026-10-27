import { useCallback, useState } from "react";
import { View, FlatList, Pressable, Linking } from "react-native";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import * as Clipboard from "expo-clipboard";
import { Screen, AppHeader, T, Card, Row, Badge, LoadingView, EmptyState, Btn, Field } from "@/src/components/ui";
import { api } from "@/src/api/client";
import { useToast } from "@/src/components/Toast";
import { downloadReceipt } from "@/src/utils/invoice";
import { colors, spacing, type, radius } from "@/src/theme";

function todayLocalDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function isValidPaymentDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return false;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return date.getUTCFullYear() === Number(year)
    && date.getUTCMonth() === Number(month) - 1
    && date.getUTCDate() === Number(day);
}

export default function TenantPayments() {
  const toast = useToast();
  const [payments, setPayments] = useState<any[]>([]);
  const [hostel, setHostel] = useState<any>(null);
  const [tenant, setTenant] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [amount, setAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(todayLocalDate);
  const [upiReference, setUpiReference] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"phonepe" | "google_pay" | "paytm" | "other_upi">("phonepe");
  const [screenshot, setScreenshot] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api.get<{ payments: any[]; hostel: any; tenant: any }>("/tenant/payments");
      setPayments(d.payments);
      setHostel(d.hostel);
      setTenant(d.tenant);
      if (d.tenant && !amount) {
        setAmount(String(d.tenant.rent_balance ?? (d.tenant.payment_status === "due" ? d.tenant.monthly_rent : "")));
      }
    } catch {
    } finally {
      setLoading(false);
    }
  }, [amount]);

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
        owner_signature: hostel?.signature,
      });
      if (res && res.ok === false) toast.show(res.error || "Could not open receipt", "error");
      else if (typeof window === "undefined") toast.show("Receipt ready to save/share", "success");
    } catch {
      toast.show("Could not generate receipt", "error");
    }
  };

  const copyUpiId = async () => {
    if (!hostel?.upi_id) return;
    await Clipboard.setStringAsync(hostel.upi_id);
    toast.show("UPI ID copied");
  };

  const openUpiApp = async () => {
    if (!hostel?.upi_id) {
      toast.show("Ask the hostel owner to configure a UPI ID to open an app directly", "error");
      return;
    }
    const params = new URLSearchParams({
      pa: hostel.upi_id,
      pn: hostel.name || hostel.pg_name || "Hostel",
      am: amount || String(tenant?.rent_balance ?? tenant?.monthly_rent ?? ""),
      cu: "INR",
      tn: "Hostel rent",
    }).toString();
    const appScheme = {
      phonepe: "phonepe://pay",
      google_pay: "tez://upi/pay",
      paytm: "paytmmp://pay",
      other_upi: "upi://pay",
    }[paymentMethod];
    try {
      await Linking.openURL(`${appScheme}?${params}`);
    } catch {
      try {
        await Linking.openURL(`upi://pay?${params}`);
      } catch (error) {
        toast.show(error instanceof Error ? error.message : "No compatible UPI app was found", "error");
      }
    }
  };

  const chooseScreenshot = async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        toast.show("Photo access is needed to attach a payment screenshot", "error");
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        base64: true,
        quality: 0.7,
      });
      if (result.canceled) return;
      const selected = result.assets[0];
      if (!selected.base64 || !["image/jpeg", "image/png", "image/webp"].includes(selected.mimeType || "")) {
        toast.show("Choose a JPG, PNG, or WebP screenshot", "error");
        return;
      }
      if (selected.base64.length > 4_194_304) {
        toast.show("Payment screenshots must be 3 MB or smaller", "error");
        return;
      }
      setScreenshot(selected);
    } catch (error) {
      toast.show(error instanceof Error ? error.message : "Could not select the screenshot", "error");
    }
  };

  const submitPayment = async () => {
    if (!canSubmitPayment) {
      toast.show("Enter the paid amount, date, and UPI reference ID", "error");
      return;
    }
    setSubmitting(true);
    try {
      await api.post("/tenant/rent-payment", {
        amount: Number(amount),
        payment_date: paymentDate.trim(),
        upi_reference: upiReference.trim(),
        method: paymentMethod,
        ...(screenshot?.base64 ? {
          screenshot_data: `data:${screenshot.mimeType};base64,${screenshot.base64}`,
          screenshot_name: screenshot.fileName || "upi-payment.png",
          screenshot_content_type: screenshot.mimeType,
        } : {}),
      });
      setUpiReference("");
      setScreenshot(null);
      toast.show("Payment submitted successfully. Waiting for owner approval.");
      await load();
    } catch (error: any) {
      toast.show(error.message || "Could not submit payment for approval", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const total = payments.filter((p) => p.status === "paid").reduce((s, p) => s + p.amount, 0);
  const due = tenant && tenant.payment_status === "due";
  const canSubmitPayment = Boolean(
    !submitting
    && Number.isFinite(Number(amount))
    && Number(amount) > 0
    && isValidPaymentDate(paymentDate)
    && upiReference.trim()
    && (hostel?.upi_id || hostel?.upi_qr_code),
  );
  const pendingPayment = payments.find((payment) =>
    ["pending_owner_approval", "approval_processing"].includes(payment.status),
  );
  const methods = [
    { id: "phonepe" as const, name: "PhonePe", color: "#5F259F", glyph: "पे" },
    { id: "google_pay" as const, name: "Google Pay", color: "#4285F4", glyph: "G" },
    { id: "paytm" as const, name: "Paytm", color: "#00B9F1", glyph: "paytm" },
    { id: "other_upi" as const, name: "Other UPI apps", color: "#64748B", glyph: "UPI" },
  ];

  if (loading) return <Screen><LoadingView /></Screen>;

  return (
    <Screen edges={["top"]}>
      <AppHeader title="Payments" subtitle="History & receipts" />
      <FlatList
        data={payments}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}
        ListHeaderComponent={
          <View style={{ gap: spacing.md, marginBottom: spacing.md }}>
            {payments.some((p) => p.status === "paid") ? (
              <Card style={{ backgroundColor: colors.brand, borderColor: colors.brand }}>
                <T color="#fff" size={type.sm}>Total paid</T>
                <T weight="extrabold" size={type["2xl"]} color="#fff">₹{total}</T>
              </Card>
            ) : null}
            {pendingPayment ? (
              <Card style={{ gap: spacing.sm, borderColor: colors.warning }}>
                <Row style={{ gap: spacing.sm, alignItems: "center" }}>
                  <Ionicons name="time-outline" size={22} color={colors.warning} />
                  <T weight="bold" size={type.lg}>Pending Owner Approval</T>
                </Row>
                <T color={colors.onSurfaceSecondary}>
                  ₹{pendingPayment.amount} reported on {new Date(pendingPayment.date).toLocaleDateString()} · Reference {pendingPayment.upi_reference}.
                  The owner must verify the transfer before your rent is marked paid.
                </T>
              </Card>
            ) : due ? (
              <Card style={{ gap: spacing.md }}>
                <T weight="extrabold" size={type.lg}>Pay Rent with UPI</T>
                <T size={type.sm} color={colors.onSurfaceSecondary}>
                  Pay the owner outside Hostel360. Your rent stays due until the owner checks their bank/UPI records and approves your report.
                </T>
                {hostel?.upi_qr_code ? (
                  <Image source={{ uri: hostel.upi_qr_code }} style={{ width: 190, height: 190, alignSelf: "center" }} contentFit="contain" />
                ) : null}
                <Row style={{ alignItems: "center", justifyContent: "space-between", gap: spacing.sm }}>
                  <View style={{ flex: 1 }}>
                    <T size={type.sm} color={colors.onSurfaceSecondary}>Owner UPI ID</T>
                    <T weight="bold">{hostel?.upi_id || "Not configured by the owner"}</T>
                  </View>
                  {hostel?.upi_id ? <Btn title="Copy" variant="secondary" icon="copy-outline" onPress={copyUpiId} testID="rent-copy-upi" /> : null}
                </Row>
                <View style={{ gap: spacing.sm }}>
                  <T size={type.sm} weight="semibold" color={colors.onSurfaceSecondary}>Choose a UPI app</T>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
                    {methods.map((method) => (
                      <Pressable
                        key={method.id}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: paymentMethod === method.id }}
                        testID={`rent-method-${method.id}`}
                        onPress={() => setPaymentMethod(method.id)}
                        style={[styles.methodCard, {
                          borderColor: paymentMethod === method.id ? method.color : colors.border,
                          backgroundColor: paymentMethod === method.id ? `${method.color}12` : colors.surface,
                        }]}
                      >
                        <View style={[styles.methodGlyph, { backgroundColor: method.color }]}>
                          {method.id === "google_pay" ? (
                            <T weight="extrabold" color="#fff" size={type.lg}>G</T>
                          ) : (
                            <T weight="extrabold" color="#fff" size={method.id === "paytm" ? 10 : type.sm}>
                              {method.glyph}
                            </T>
                          )}
                        </View>
                        <T size={12} weight="bold" color={method.color}>{method.name}</T>
                        {method.id === "google_pay" ? (
                          <View style={{ flexDirection: "row", gap: 3 }}>
                            {["#4285F4", "#EA4335", "#FBBC05", "#34A853"].map((c) => <View key={c} style={{ width: 8, height: 3, backgroundColor: c, borderRadius: 2 }} />)}
                          </View>
                        ) : null}
                      </Pressable>
                    ))}
                  </View>
                </View>
                <Field label="Amount paid (₹)" value={amount} onChangeText={setAmount} keyboardType="numeric" testID="rent-paid-amount" />
                <Btn title={`Open ${methods.find((m) => m.id === paymentMethod)?.name}`} variant="secondary" icon="open-outline" onPress={openUpiApp} testID="rent-open-upi" disabled={!hostel?.upi_id} />
                <Field label="Payment date (YYYY-MM-DD)" value={paymentDate} onChangeText={setPaymentDate} placeholder="2026-10-25" testID="rent-payment-date" />
                <Field label="UTR / UPI Transaction Reference Number" value={upiReference} onChangeText={setUpiReference} placeholder="Enter the reference from your UPI app" autoCapitalize="none" testID="rent-upi-reference" />
                <Btn title="Submit Payment" icon="send" onPress={submitPayment} loading={submitting} disabled={!canSubmitPayment} testID="rent-submit-approval" />
                <Btn title={screenshot ? `Screenshot: ${screenshot.fileName || "selected"}` : "Attach payment screenshot (optional)"} variant="secondary" icon="image-outline" onPress={chooseScreenshot} testID="rent-payment-screenshot" />
                {screenshot ? <Btn title="Remove screenshot" variant="ghost" onPress={() => setScreenshot(null)} /> : null}
                <T size={12} color={colors.warning}>Submitting payment details does not mark rent as paid. Keep your UPI confirmation until approval.</T>
              </Card>
            ) : null}
          </View>
        }
        ListEmptyComponent={<View style={{ flex: 1 }}><EmptyState icon="receipt-outline" title="No payments yet" subtitle="Your rent receipts will appear here." /></View>}
        renderItem={({ item }) => (
          <Card testID={`tpay-${item.id}`} style={{ gap: spacing.sm }}>
            <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
              <Row style={{ gap: spacing.sm }}>
                <View style={styles.icon}><Ionicons name={item.status === "paid" ? "checkmark-circle" : item.status === "rejected" ? "close-circle" : "time"} size={18} color={item.status === "paid" ? colors.success : item.status === "rejected" ? colors.error : colors.warning} /></View>
                <View>
                  <T weight="bold" style={{ textTransform: "capitalize" }}>{item.type} payment</T>
                  <T size={type.sm} color={colors.onSurfaceSecondary}>{new Date(item.date).toLocaleDateString()} · {item.method}</T>
                </View>
              </Row>
              <T weight="extrabold" color={colors.brand}>₹{item.amount}</T>
            </Row>
            <Row style={{ justifyContent: "space-between", alignItems: "center", backgroundColor: colors.surfaceSecondary, borderRadius: radius.sm, padding: spacing.sm }}>
              <T size={type.sm} color={colors.onSurfaceSecondary}>
                {item.status === "paid" ? `Receipt: ${item.receipt_no}` : item.status === "rejected" ? item.rejection_reason || "Rejected" : `UPI ref: ${item.upi_reference || "—"}`}
              </T>
              <Badge label={item.status === "paid" ? "Paid" : item.status === "rejected" ? "Rejected" : "Pending approval"} tone={item.status === "paid" ? "success" : item.status === "rejected" ? "error" : "warning"} />
            </Row>
            {item.status === "paid" ? <Btn title="View Receipt" variant="secondary" icon="receipt-outline" onPress={() => getReceipt(item)} testID={`receipt-${item.id}`} /> : null}
          </Card>
        )}
      />
    </Screen>
  );
}

const styles = {
  icon: { width: 36, height: 36, borderRadius: radius.md, backgroundColor: "#DCFCE7", alignItems: "center" as const, justifyContent: "center" as const },
  methodCard: { minWidth: 110, minHeight: 76, padding: spacing.sm, borderWidth: 1.5, borderRadius: radius.md, alignItems: "center" as const, justifyContent: "center" as const, gap: 4 },
  methodGlyph: { width: 28, height: 28, borderRadius: radius.pill, alignItems: "center" as const, justifyContent: "center" as const },
};
