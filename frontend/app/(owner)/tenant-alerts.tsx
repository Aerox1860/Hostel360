import { useCallback, useState } from "react";
import { ScrollView, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen, AppHeader, T, Card, LoadingView, Badge, Btn } from "@/src/components/ui";
import { api } from "@/src/api/client";
import { openTenantReportEvidence } from "@/src/utils/tenantReportEvidence";
import { useOwnerHostel } from "@/src/context/OwnerHostelContext";
import { colors, spacing, type } from "@/src/theme";
import { reportDate, reportStatusLabel, reportStatusTone } from "@/src/utils/globalHistory";

function paymentDateTime(value?: string) {
  if (!value) return "Date unavailable";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date unavailable" : date.toLocaleString();
}

type TenantHistoryNotification = {
  id: string;
  event: string;
  report_id?: string;
  payment_id?: string;
  grant_id?: string | null;
  status?: string | null;
  message?: string;
  amount?: number;
  tenant_name?: string;
  room_number?: string | number | null;
  method?: string;
  upi_reference?: string;
  payment_submitted_at?: string;
  rejection_reason?: string;
  created_at?: string;
  read_at?: string | null;
};

export default function TenantAlerts() {
  const { activeId } = useOwnerHostel();
  const [notifications, setNotifications] = useState<TenantHistoryNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedReport, setSelectedReport] = useState<any>(null);
  const [selectedGrantId, setSelectedGrantId] = useState<string | null>(null);
  const [openingReportId, setOpeningReportId] = useState("");
  const [openingEvidenceId, setOpeningEvidenceId] = useState("");

  const load = useCallback(async () => {
    if (!activeId) {
      setNotifications([]);
      setError("");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    setNotifications([]);
    try {
      const response = await api.get<{ notifications: TenantHistoryNotification[] }>(
        `/owner/tenant-history/notifications?hostel_id=${encodeURIComponent(activeId)}`,
      );
      setNotifications(Array.isArray(response.notifications) ? response.notifications : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load report notifications.");
    } finally {
      setLoading(false);
    }
  }, [activeId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const markRead = async (id: string) => {
    try {
      await api.put(`/tenant-history/notifications/${encodeURIComponent(id)}/read`, {});
      setNotifications((current) => current.map((item) =>
        item.id === id ? { ...item, read_at: new Date().toISOString() } : item,
      ));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not mark the notification as read.");
    }
  };

  const openReport = async (notification: TenantHistoryNotification) => {
    if (!notification.report_id) return;
    setOpeningReportId(notification.id);
    setError("");
    try {
      const response = await api.get<{ report: any }>(
        `/owner/tenant-history/reports/${encodeURIComponent(notification.report_id)}${notification.grant_id ? `?grant_id=${encodeURIComponent(notification.grant_id)}` : ""}`,
      );
      setSelectedReport(response.report);
      setSelectedGrantId(notification.grant_id || null);
      if (!notification.read_at) await markRead(notification.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open the report details.");
    } finally {
      setOpeningReportId("");
    }
  };

  const openEvidence = async (evidence: { id: string; filename: string; content_type: string }) => {
    if (!selectedReport || openingEvidenceId) return;
    setOpeningEvidenceId(evidence.id);
    setError("");
    try {
      await openTenantReportEvidence(selectedReport.id, evidence, selectedGrantId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open the private evidence document.");
    } finally {
      setOpeningEvidenceId("");
    }
  };

  const openPayment = async (notification: TenantHistoryNotification) => {
    if (!notification.payment_id) return;
    if (!notification.read_at) await markRead(notification.id);
    router.push({
      pathname: "/(owner)/money",
      params: { tab: "approvals", payment_id: notification.payment_id },
    } as any);
  };

  const paymentStatus = (status?: string | null) => {
    if (status === "pending_owner_approval" || status === "approval_processing") return "Pending Owner Approval";
    if (status === "paid") return "Approved";
    if (status === "rejected") return "Rejected";
    return status?.replaceAll("_", " ") || "Status unavailable";
  };

  if (loading) return <Screen><LoadingView label="Loading report notifications..." /></Screen>;

  return (
    <Screen edges={["top"]}>
      <AppHeader title="Alerts & Notifications" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
        <Card style={{ gap: spacing.sm }}>
          <T weight="bold" size={type.lg}>Payment and tenant-history updates</T>
          <T size={type.sm} color={colors.onSurfaceSecondary}>
            Payment alerts are visible only to the relevant hostel owner. Tenant-history reports are shared only with authorized owners. A reported allegation is not a verified debt.
          </T>
        </Card>
        {selectedReport ? (
          <Card style={{ gap: spacing.xs }} testID="tenant-alert-report-details">
            <T weight="bold" size={type.lg}>{selectedReport.previous_hostel || "Previous hostel report"}</T>
            <T weight="semibold">{selectedReport.title || selectedReport.category || "Tenant report"}</T>
            <Badge label={reportStatusLabel(selectedReport.status)} tone={reportStatusTone(selectedReport.status)} />
            <T size={type.sm} color={colors.onSurfaceSecondary}>Reported {reportDate(selectedReport.created_at)}</T>
            <T size={type.sm}>Claimed: ₹{selectedReport.amount_claimed ?? 0} · Outstanding: ₹{selectedReport.outstanding_balance ?? selectedReport.amount_claimed ?? 0}</T>
            {selectedReport.description ? <T size={type.sm} color={colors.onSurfaceSecondary}>{selectedReport.description}</T> : null}
            {selectedReport.tenant_response?.text ? <T size={type.sm} color={colors.warning}>Tenant response: {selectedReport.tenant_response.text}</T> : null}
            {selectedReport.evidence_documents?.map((evidence: any) => (
              <Btn
                key={evidence.id}
                title={`View private evidence: ${evidence.filename}`}
                variant="secondary"
                icon="document-attach-outline"
                onPress={() => openEvidence(evidence)}
                loading={openingEvidenceId === evidence.id}
                disabled={Boolean(openingEvidenceId)}
              />
            ))}
          </Card>
        ) : null}
        {error ? <Card style={{ borderColor: colors.error }}><T color={colors.error}>{error}</T></Card> : null}
        {!notifications.length ? (
          <Card style={{ alignItems: "center", gap: spacing.sm, padding: spacing.xl }}>
            <Ionicons name="notifications-off-outline" size={28} color={colors.onSurfaceTertiary} />
            <T color={colors.onSurfaceSecondary}>No alerts or notifications.</T>
          </Card>
        ) : notifications.map((item) => (
          <View key={item.id} style={{ gap: spacing.xs }}>
            <Card style={{
              gap: spacing.xs,
              borderColor: item.read_at ? colors.border : colors.brand,
              backgroundColor: item.read_at ? colors.surface : colors.brandSecondary,
            }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", gap: spacing.sm }}>
                <T weight={item.read_at ? "regular" : "bold"} style={{ flex: 1 }}>
                  {item.event.replaceAll("_", " ")}
                </T>
                {item.status && !item.payment_id ? <Badge label={reportStatusLabel(item.status)} tone={reportStatusTone(item.status)} /> : null}
              </View>
              <T size={type.sm} color={colors.onSurfaceSecondary}>{reportDate(item.created_at)}</T>
              {item.payment_id ? (
                <>
                  <T size={type.sm} weight="semibold">{item.tenant_name || "Tenant"} · Room {item.room_number || "—"}</T>
                  <T size={type.sm}>Amount: ₹{item.amount ?? 0} · Method: {item.method?.replaceAll("_", " ") || "—"}</T>
                  <T size={type.sm}>UTR / Transaction reference: {item.upi_reference || "—"}</T>
                  <T size={type.sm}>Submitted: {paymentDateTime(item.payment_submitted_at || item.created_at)}</T>
                  <Badge label={paymentStatus(item.status)} tone={item.status === "pending_owner_approval" || item.status === "approval_processing" ? "warning" : item.status === "paid" ? "success" : item.status === "rejected" ? "error" : "neutral"} />
                  {item.rejection_reason ? <T size={type.sm} color={colors.error}>Rejection reason: {item.rejection_reason}</T> : null}
                  {item.message ? <T size={type.sm} color={colors.onSurfaceSecondary}>{item.message}</T> : null}
                </>
              ) : null}
            </Card>
            {item.payment_id ? (
              <Btn
                title="View Payment"
                variant="secondary"
                icon="open-outline"
                onPress={() => openPayment(item)}
                testID={`tenant-alert-payment-${item.id}`}
              />
            ) : item.report_id ? (
              <Btn
                title="View report details"
                variant="secondary"
                onPress={() => openReport(item)}
                loading={openingReportId === item.id}
                disabled={Boolean(openingReportId)}
                testID={`tenant-alert-view-${item.id}`}
              />
            ) : null}
          </View>
        ))}
      </ScrollView>
    </Screen>
  );
}
