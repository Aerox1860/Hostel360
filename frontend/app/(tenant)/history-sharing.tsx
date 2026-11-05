import { useCallback, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen, AppHeader, T, Card, Row, Btn, Field, LoadingView } from "@/src/components/ui";
import { api } from "@/src/api/client";
import { colors, font, radius, spacing, type } from "@/src/theme";
import { reportDate, reportStatusLabel } from "@/src/utils/globalHistory";

export default function GlobalHistorySharing() {
  const [consented, setConsented] = useState<boolean | null>(null);
  const [autoLookupConsented, setAutoLookupConsented] = useState(false);
  const [identityVerified, setIdentityVerified] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingConsent, setSavingConsent] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [shareCode, setShareCode] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [reports, setReports] = useState<{
    id: string;
    previous_hostel?: string | null;
    category?: string | null;
    amount?: number;
    outstanding_balance?: number;
    reported_at?: string | null;
    status?: string | null;
    details?: string | null;
    tenant_response?: { text?: string; created_at?: string } | null;
    settlements?: { entry_type: string; amount: number; created_at?: string }[];
  }[]>([]);
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [respondingTo, setRespondingTo] = useState("");
  const [notifications, setNotifications] = useState<{
    id: string;
    event: string;
    message?: string;
    payment_id?: string;
    amount?: number;
    status?: string | null;
    created_at?: string;
    read_at?: string | null;
  }[]>([]);

  const loadConsent = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const response = await api.get<{
        consented: boolean;
        auto_lookup_consented?: boolean;
        identity_verified?: boolean;
      }>("/tenant/global-history/consent");
      setConsented(response.consented === true);
      setAutoLookupConsented(response.auto_lookup_consented === true);
      setIdentityVerified(response.identity_verified === true);
      const history = await api.get<{ reports: typeof reports }>("/tenant/global-history/reports");
      setReports(Array.isArray(history.reports) ? history.reports : []);
      const alertResponse = await api.get<{ notifications: typeof notifications }>("/tenant/global-history/notifications");
      setNotifications(Array.isArray(alertResponse.notifications) ? alertResponse.notifications : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your sharing preference.");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { loadConsent(); }, [loadConsent]));

  const updateConsent = async () => {
    if (consented === null || savingConsent || generating) return;
    const nextValue = !consented;
    setShareCode("");
    setExpiresAt("");
    setSavingConsent(true);
    setError("");
    try {
      const response = await api.put<{ consented?: boolean; auto_lookup_consented?: boolean } | null>(
        "/tenant/global-history/consent",
        { consented: nextValue, ...(!nextValue ? { auto_lookup_consented: false } : {}) },
      );
      setConsented(response?.consented ?? nextValue);
      if (!nextValue) setAutoLookupConsented(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update your sharing preference.");
    } finally {
      setSavingConsent(false);
    }
  };

  const updateAutoLookupConsent = async () => {
    if (consented !== true || !identityVerified || savingConsent) return;
    const nextValue = !autoLookupConsented;
    setSavingConsent(true);
    setError("");
    try {
      const response = await api.put<{ auto_lookup_consented?: boolean }>(
        "/tenant/global-history/consent",
        { consented: true, auto_lookup_consented: nextValue },
      );
      setAutoLookupConsented(response.auto_lookup_consented === true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update automatic history sharing.");
    } finally {
      setSavingConsent(false);
    }
  };

  const markNotificationRead = async (notificationId: string) => {
    try {
      await api.put(`/tenant-history/notifications/${encodeURIComponent(notificationId)}/read`, {});
      setNotifications((current) => current.map((item) =>
        item.id === notificationId ? { ...item, read_at: new Date().toISOString() } : item,
      ));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not mark the notification as read.");
    }
  };

  const generateCode = async () => {
    setGenerating(true);
    setError("");
    setShareCode("");
    setExpiresAt("");
    try {
      const response = await api.post<{ code: string; expires_at: string }>("/tenant/global-history/share-code", {});
      setShareCode(response.code);
      setExpiresAt(response.expires_at);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not generate a share code.");
    } finally {
      setGenerating(false);
    }
  };

  const submitResponse = async (reportId: string) => {
    const response = responses[reportId]?.trim();
    if (!response || respondingTo) return;
    setRespondingTo(reportId);
    setError("");
    try {
      await api.post(`/tenant/global-history/reports/${encodeURIComponent(reportId)}/response`, { response });
      setResponses((current) => ({ ...current, [reportId]: "" }));
      const history = await api.get<{ reports: typeof reports }>("/tenant/global-history/reports");
      setReports(Array.isArray(history.reports) ? history.reports : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not submit your response.");
    } finally {
      setRespondingTo("");
    }
  };

  if (loading) return <Screen><LoadingView label="Loading sharing preferences..." /></Screen>;

  return (
    <Screen edges={["top"]}>
      <AppHeader title="Global history sharing" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
        <Card style={{ gap: spacing.md }}>
          <Row style={{ gap: spacing.sm }}>
            <Ionicons name="shield-checkmark-outline" size={22} color={colors.brand} />
            <T weight="bold" size={type.lg} style={{ flex: 1 }}>Your choice, your control</T>
          </Row>
          <T color={colors.onSurfaceSecondary}>
            One-time codes let you share history with one owner. Separately, you can opt in to automatic checks when an owner enters your email: reports are returned only if your account has a Google identity verified by Hostel360, and only because you explicitly enable this setting. Email matches alone never reveal reports. Reports are allegations unless their status says otherwise.
          </T>
          {consented !== null ? <Pressable
            testID="global-history-consent"
            accessibilityRole="switch"
            accessibilityState={{ checked: consented === true, disabled: savingConsent || generating || consented === null }}
            disabled={savingConsent || generating || consented === null}
            onPress={updateConsent}
            style={{ minHeight: 52, borderRadius: radius.md, borderWidth: 1, borderColor: consented ? colors.brand : colors.borderStrong, paddingHorizontal: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.sm }}
          >
            <Ionicons name={consented ? "checkbox" : "square-outline"} size={22} color={colors.brand} />
            <T weight="semibold" style={{ flex: 1 }}>Enable one-time code sharing</T>
            {savingConsent ? <Ionicons name="sync" size={18} color={colors.brand} /> : null}
          </Pressable> : null}
          {consented ? (
            <View style={{ gap: spacing.sm }}>
              <Pressable
                testID="global-history-auto-consent"
                accessibilityRole="switch"
                accessibilityState={{ checked: autoLookupConsented, disabled: savingConsent || !identityVerified }}
                disabled={savingConsent || !identityVerified}
                onPress={updateAutoLookupConsent}
                style={{ minHeight: 52, borderRadius: radius.md, borderWidth: 1, borderColor: autoLookupConsented ? colors.brand : colors.borderStrong, paddingHorizontal: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.sm }}
              >
                <Ionicons name={autoLookupConsented ? "checkbox" : "square-outline"} size={22} color={colors.brand} />
                <T weight="semibold" style={{ flex: 1 }}>Allow automatic verified history checks</T>
                {savingConsent ? <Ionicons name="sync" size={18} color={colors.brand} /> : null}
              </Pressable>
              {!identityVerified ? (
                <T size={type.sm} color={colors.warning}>Link and verify your Google identity before enabling automatic checks. One-time codes remain available.</T>
              ) : null}
              {autoLookupConsented ? (
                <T size={type.sm} color={colors.onSurfaceSecondary}>A prospective owner can see relevant reports only after a verified identity match. This does not approve or reject admission.</T>
              ) : null}
              <Btn title="Generate one-time share code" icon="key-outline" onPress={generateCode} loading={generating} disabled={generating} testID="global-history-generate-code" />
              {shareCode ? (
                <View testID="global-history-share-code" style={{ padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.brandSecondary, gap: spacing.xs }}>
                  <T size={type.sm} weight="semibold" color={colors.brand}>Share this code with the owner</T>
                  <Text selectable style={{ fontFamily: font.extrabold, fontSize: type["2xl"], color: colors.brand, letterSpacing: 2, textAlign: "center" }}>{shareCode}</Text>
                  <T size={type.sm} color={colors.onSurfaceSecondary}>
                    Expires {expiresAt ? new Date(expiresAt).toLocaleString() : "soon"}. This code can only be used once.
                  </T>
                </View>
              ) : (
                <T size={type.sm} color={colors.onSurfaceSecondary}>A code is not shown until you request one, and it will expire shortly.</T>
              )}
            </View>
          ) : consented === false ? (
            <T size={type.sm} color={colors.onSurfaceSecondary}>Sharing is off. No history can be shared until you opt in.</T>
          ) : null}
        </Card>
        {notifications.length ? (
          <Card style={{ gap: spacing.sm }}>
            <T weight="bold" size={type.lg}>Hostel360 notifications</T>
            {notifications.slice(0, 10).map((notification) => (
              <Pressable
                key={notification.id}
                accessibilityRole="button"
                onPress={() => notification.read_at ? undefined : markNotificationRead(notification.id)}
                style={{ gap: spacing.xs, padding: spacing.sm, borderRadius: radius.md, backgroundColor: notification.read_at ? colors.surfaceSecondary : colors.brandSecondary }}
              >
                <T weight={notification.read_at ? "regular" : "semibold"}>
                  {notification.message || notification.event.replaceAll("_", " ")}{notification.status ? ` · ${reportStatusLabel(notification.status)}` : ""}
                </T>
                <T size={type.sm} color={colors.onSurfaceSecondary}>{reportDate(notification.created_at)}</T>
              </Pressable>
            ))}
          </Card>
        ) : null}
        <Card style={{ gap: spacing.md }}>
          <T weight="bold" size={type.lg}>Previous hostel reports</T>
          <T size={type.sm} color={colors.onSurfaceSecondary}>
            These are reports linked to your signed-in account. A report is an owner’s allegation unless its status says otherwise; you can respond or dispute it here.
          </T>
          {reports.length === 0 ? (
            <T size={type.sm} color={colors.onSurfaceSecondary}>No reports are linked to your account.</T>
          ) : reports.map((report) => (
            <Card key={report.id} style={{ gap: spacing.xs, backgroundColor: colors.surfaceSecondary }}>
              <T weight="bold">{report.previous_hostel || "Previous hostel"} · {report.category || "Report"}</T>
              <T size={type.sm} color={colors.onSurfaceSecondary}>
                {reportDate(report.reported_at)} · {reportStatusLabel(report.status)}
              </T>
              {report.amount !== undefined ? <T size={type.sm}>Reported amount: ₹{report.amount} · Outstanding: ₹{report.outstanding_balance ?? report.amount}</T> : null}
              {report.details ? <T size={type.sm} color={colors.onSurfaceSecondary}>{report.details}</T> : null}
              {report.settlements?.map((entry, index) => (
                <T key={`${report.id}-settlement-${index}`} size={type.sm} color={colors.onSurfaceSecondary}>
                  {entry.entry_type === "write_off" ? "Written off" : "Settlement"}: ₹{entry.amount} · {reportDate(entry.created_at)}
                </T>
              ))}
              {report.tenant_response?.text ? (
                <T size={type.sm} color={colors.brand}>Your response: {report.tenant_response.text}</T>
              ) : (
                <>
                  <Field
                    label="Your response or dispute"
                    value={responses[report.id] || ""}
                    onChangeText={(value) => setResponses((current) => ({ ...current, [report.id]: value }))}
                    placeholder="Add your response"
                    multiline
                    maxLength={4000}
                    testID={`tenant-report-response-${report.id}`}
                  />
                  <Btn
                    title="Submit response"
                    variant="secondary"
                    onPress={() => submitResponse(report.id)}
                    loading={respondingTo === report.id}
                    disabled={!responses[report.id]?.trim() || Boolean(respondingTo)}
                    testID={`tenant-report-response-submit-${report.id}`}
                  />
                </>
              )}
            </Card>
          ))}
        </Card>
        {error ? (
          <Card style={{ gap: spacing.sm, borderColor: colors.error }}>
            <T color={colors.error}>{error}</T>
            <Btn title="Try again" variant="secondary" onPress={loadConsent} />
          </Card>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
