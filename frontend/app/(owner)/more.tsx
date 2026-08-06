import { useCallback, useState } from "react";
import { View, ScrollView, Pressable, Platform } from "react-native";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen, AppHeader, T, Card, Row, Badge, LoadingView, EmptyState, Sheet, Btn, Field } from "@/src/components/ui";
import { HostelFormSheet } from "@/src/components/HostelFormSheet";
import { CelebrationOverlay } from "@/src/components/CelebrationOverlay";
import { useOwnerHostel } from "@/src/context/OwnerHostelContext";
import { api, BACKEND_URL } from "@/src/api/client";
import { useAuth } from "@/src/context/AuthContext";
import { useToast } from "@/src/components/Toast";
import { downloadInvoice } from "@/src/utils/invoice";
import { colors, spacing, type, radius } from "@/src/theme";
import * as WebBrowser from "expo-web-browser";

export default function More() {
  const { user, logout } = useAuth();
  const toast = useToast();
  const { activeId, activeHostel, refresh: refreshHostels } = useOwnerHostel();
  const [reports, setReports] = useState<any>(null);
  const [hostel, setHostel] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const [noticesOpen, setNoticesOpen] = useState(false);
  const [notices, setNotices] = useState<any[]>([]);
  const [nTitle, setNTitle] = useState("");
  const [nBody, setNBody] = useState("");

  const [complaintsOpen, setComplaintsOpen] = useState(false);
  const [complaints, setComplaints] = useState<any[]>([]);
  const [requests, setRequests] = useState<any[]>([]);

  const [enquiriesOpen, setEnquiriesOpen] = useState(false);
  const [enquiries, setEnquiries] = useState<any[]>([]);

  const [editOpen, setEditOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [sub, setSub] = useState<any>(null);
  const [buying, setBuying] = useState<number | null>(null);
  const [celebrate, setCelebrate] = useState(false);

  const load = useCallback(async () => {
    if (!activeId) { setLoading(false); return; }
    try {
      const r = await api.get(`/owner/reports?hostel_id=${activeId}`);
      const { hostel } = await api.get<{ hostel: any }>(`/owner/hostel?hostel_id=${activeId}`);
      setReports(r);
      setHostel(hostel);
    } catch {
    } finally {
      setLoading(false);
    }
  }, [activeId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openNotices = async () => {
    const { notices } = await api.get<{ notices: any[] }>(`/owner/notices?hostel_id=${activeId}`);
    setNotices(notices);
    setNoticesOpen(true);
  };
  const postNotice = async () => {
    if (!nTitle || !nBody) { toast.show("Enter title and message", "error"); return; }
    try {
      await api.post("/owner/notices", { hostel_id: activeId, title: nTitle, body: nBody });
      toast.show("Notice posted");
      setNTitle(""); setNBody("");
      const { notices } = await api.get<{ notices: any[] }>(`/owner/notices?hostel_id=${activeId}`);
      setNotices(notices);
    } catch (e: any) { toast.show(e.message, "error"); }
  };
  const openComplaints = async () => {
    const d = await api.get<{ complaints: any[]; requests: any[] }>(`/owner/complaints?hostel_id=${activeId}`);
    setComplaints(d.complaints); setRequests(d.requests);
    setComplaintsOpen(true);
  };
  const resolveComplaint = async (id: string) => {
    await api.post(`/owner/complaints/${id}/resolve`);
    const d = await api.get<{ complaints: any[]; requests: any[] }>(`/owner/complaints?hostel_id=${activeId}`);
    setComplaints(d.complaints); setRequests(d.requests);
    toast.show("Marked resolved");
  };
  const resolveRequest = async (id: string) => {
    await api.post(`/owner/requests/${id}/resolve`);
    const d = await api.get<{ complaints: any[]; requests: any[] }>(`/owner/complaints?hostel_id=${activeId}`);
    setComplaints(d.complaints); setRequests(d.requests);
    toast.show("Request handled");
  };
  const openEnquiries = async () => {
    const { enquiries } = await api.get<{ enquiries: any[] }>("/owner/enquiries");
    setEnquiries(enquiries);
    setEnquiriesOpen(true);
  };
  const openSub = async () => {
    try {
      const s = await api.get(`/owner/subscription?hostel_id=${activeId}`);
      setSub(s);
      setPlanOpen(true);
    } catch (e: any) {
      toast.show(e.message || "Could not load subscription", "error");
    }
  };
  const buyDuration = async (months: number) => {
    setBuying(months);
    try {
      const res = await api.post<{ checkout_url: string; payment_link_id: string }>(
        "/payments/subscription/link", { hostel_id: activeId, months }
      );
      await WebBrowser.openBrowserAsync(res.checkout_url);
      // poll for activation
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const st = await api.get<{ activated: boolean }>(`/payments/subscription/status/${res.payment_link_id}`);
        if (st.activated) {
          setPlanOpen(false);
          setCelebrate(true);
          await refreshHostels();
          load();
          setBuying(null);
          return;
        }
      }
      toast.show("Payment is still being verified. Pull to refresh shortly.", "info");
    } catch (e: any) {
      toast.show(e.message || "Online payments not configured yet", "error");
    } finally {
      setBuying(null);
    }
  };
  const getInvoice = async (item: any) => {
    try {
      const res = await downloadInvoice(item, user?.name || "", sub?.hostel_name || activeHostel?.name || "");
      if (res && res.ok === false) toast.show(res.error || "Could not open invoice", "error");
      else if (Platform.OS !== "web") toast.show("Invoice ready to save/share", "success");
    } catch {
      toast.show("Could not generate invoice", "error");
    }
  };

  if (loading) return <Screen><LoadingView /></Screen>;

  const MenuItem = ({ icon, title, subtitle, onPress, tint, testID }: any) => (
    <Pressable testID={testID} onPress={onPress} style={({ pressed }) => [{ opacity: pressed ? 0.85 : 1 }]}>
      <Card style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
        <View style={[styles.mIcon, { backgroundColor: tint || colors.brandSecondary }]}>
          <Ionicons name={icon} size={20} color={colors.brand} />
        </View>
        <View style={{ flex: 1 }}>
          <T weight="bold">{title}</T>
          {subtitle ? <T size={type.sm} color={colors.onSurfaceSecondary}>{subtitle}</T> : null}
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceTertiary} />
      </Card>
    </Pressable>
  );

  return (
    <Screen edges={["top"]}>
      <AppHeader title="More" subtitle={activeHostel?.name || "Reports, notices & settings"} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing["3xl"] }}>
        {/* Reports */}
        {reports?.has_hostel ? (
          <Card style={{ gap: spacing.md }}>
            <T weight="extrabold" size={type.lg}>Reports</T>
            <Row style={{ gap: spacing.md }}>
              <MiniStat label="Collection" value={`₹${reports.total_collection}`} tone={colors.success} />
              <MiniStat label="Expenses" value={`₹${reports.total_expenses}`} tone={colors.warning} />
            </Row>
            <Row style={{ gap: spacing.md }}>
              <MiniStat label="Net Profit" value={`₹${reports.net_profit}`} tone={reports.net_profit >= 0 ? colors.brand : colors.error} />
              <MiniStat label="Occupancy" value={`${reports.occupancy_pct}%`} tone={colors.info} />
            </Row>
            {reports.monthly?.length ? (
              <View style={{ gap: 6 }}>
                <T size={type.sm} weight="semibold" color={colors.onSurfaceSecondary}>Last months</T>
                {reports.monthly.map((m: any) => (
                  <Row key={m.month} style={{ justifyContent: "space-between" }}>
                    <T size={type.sm}>{m.month}</T>
                    <Row style={{ gap: spacing.md }}>
                      <T size={type.sm} color={colors.success}>+₹{m.collection}</T>
                      <T size={type.sm} color={colors.error}>-₹{m.expense}</T>
                    </Row>
                  </Row>
                ))}
              </View>
            ) : null}
          </Card>
        ) : null}

        {hostel?.premium_plan ? (
          <Card style={{ backgroundColor: colors.brand, borderColor: colors.brand }}>
            <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
              <View>
                <T color={colors.onBrandPrimary} weight="bold">{hostel.premium_plan}</T>
                <T size={type.sm} color={colors.brandSecondary}>Active premium plan</T>
              </View>
              <Ionicons name="diamond" size={24} color={colors.onBrandPrimary} />
            </Row>
          </Card>
        ) : null}

        <MenuItem icon="megaphone" title="Notices" subtitle="Post notices for tenants" onPress={openNotices} testID="menu-notices" />
        <MenuItem icon="chatbubbles" title="Complaints & Requests" subtitle="View & resolve tenant issues" onPress={openComplaints} testID="menu-complaints" />
        <MenuItem icon="mail" title="Enquiries" subtitle="Leads from public listing" onPress={openEnquiries} testID="menu-enquiries" />
        <MenuItem icon="diamond" title="Subscription & Plans" subtitle="Free trial, upgrade & pricing" tint="#FEF3C7" onPress={openSub} testID="menu-upgrade" />
        <MenuItem icon="create" title="Edit Hostel Details" onPress={() => setEditOpen(true)} testID="menu-edit" />
        <MenuItem icon="log-out" title="Log out" tint="#FEE2E2" onPress={logout} testID="menu-logout" />
      </ScrollView>

      {/* Notices sheet */}
      <Sheet visible={noticesOpen} onClose={() => setNoticesOpen(false)} title="Notices">
        <Field label="Title" value={nTitle} onChangeText={setNTitle} placeholder="e.g. Water supply off" autoCapitalize="sentences" testID="notice-title" />
        <Field label="Message" value={nBody} onChangeText={setNBody} placeholder="Details..." multiline autoCapitalize="sentences" testID="notice-body" />
        <Btn title="Post Notice" icon="megaphone" onPress={postNotice} testID="notice-post" />
        {notices.map((n) => (
          <Card key={n.id} style={{ gap: 2 }}>
            <T weight="bold">{n.title}</T>
            <T size={type.sm} color={colors.onSurfaceSecondary}>{n.body}</T>
          </Card>
        ))}
      </Sheet>

      {/* Complaints sheet */}
      <Sheet visible={complaintsOpen} onClose={() => setComplaintsOpen(false)} title="Complaints & Requests">
        {complaints.length === 0 && requests.length === 0 ? (
          <T color={colors.onSurfaceSecondary}>No complaints or requests yet.</T>
        ) : null}
        {complaints.map((c) => (
          <Card key={c.id} style={{ gap: spacing.sm }}>
            <Row style={{ justifyContent: "space-between" }}>
              <T weight="bold">{c.title}</T>
              <Badge label={c.status} tone={c.status === "resolved" ? "success" : "warning"} />
            </Row>
            <T size={type.sm} color={colors.onSurfaceSecondary}>{c.tenant_name}: {c.body}</T>
            {c.status !== "resolved" ? <Btn title="Mark Resolved" variant="secondary" onPress={() => resolveComplaint(c.id)} testID={`resolve-${c.id}`} /> : null}
          </Card>
        ))}
        {requests.map((r) => (
          <Card key={r.id} style={{ gap: spacing.sm }}>
            <Row style={{ justifyContent: "space-between" }}>
              <T weight="bold" style={{ textTransform: "capitalize" }}>{r.type.replace("_", " ")}</T>
              <Badge label={r.status} tone={r.status === "resolved" ? "success" : "info"} />
            </Row>
            <T size={type.sm} color={colors.onSurfaceSecondary}>{r.tenant_name}: {r.note || "—"}</T>
            {r.status !== "resolved" ? <Btn title="Handle Request" variant="secondary" onPress={() => resolveRequest(r.id)} testID={`req-${r.id}`} /> : null}
          </Card>
        ))}
      </Sheet>

      {/* Enquiries sheet */}
      <Sheet visible={enquiriesOpen} onClose={() => setEnquiriesOpen(false)} title="Enquiries">
        {enquiries.length === 0 ? <T color={colors.onSurfaceSecondary}>No enquiries yet.</T> : null}
        {enquiries.map((e) => (
          <Card key={e.id} style={{ gap: 2 }}>
            <Row style={{ justifyContent: "space-between" }}>
              <T weight="bold">{e.name}</T>
              <Badge label={e.type.replace("_", " ")} tone="brand" />
            </Row>
            <T size={type.sm} color={colors.onSurfaceSecondary}>{e.mobile} · {e.hostel_name}</T>
            {e.message ? <T size={type.sm}>{e.message}</T> : null}
            {e.visit_date ? <T size={type.sm} color={colors.brand}>Visit: {e.visit_date}</T> : null}
          </Card>
        ))}
      </Sheet>

      {/* Subscription sheet */}
      <Sheet visible={planOpen} onClose={() => setPlanOpen(false)} title="Subscription & Plans">
        {sub ? (
          <>
            <Card style={{ backgroundColor: sub.subscription.is_premium ? colors.brand : colors.warning, borderColor: "transparent", gap: 4 }}>
              <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
                <T weight="bold" color="#fff" size={type.lg}>
                  {sub.subscription.status === "trial" ? "Free Trial Active" : sub.subscription.status === "active" ? "Premium Active" : "Subscription Expired"}
                </T>
                <Ionicons name={sub.subscription.is_premium ? "diamond" : "alert-circle"} size={22} color="#fff" />
              </Row>
              {sub.subscription.is_premium ? (
                <T size={type.sm} color="rgba(255,255,255,0.9)">
                  {sub.subscription.days_left} days left{sub.subscription.plan ? ` · ${sub.subscription.plan}` : ""}
                </T>
              ) : (
                <T size={type.sm} color="rgba(255,255,255,0.9)">Renew now to keep your verified badge & featured listing.</T>
              )}
            </Card>

            <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
              <T weight="bold">{sub.slab_label}</T>
              <Badge label={`${sub.bed_count} beds`} tone="brand" />
            </Row>
            <T size={type.sm} color={colors.onSurfaceSecondary}>Pricing is based on your hostel's total beds. Choose a duration:</T>

            {!sub.payments_enabled ? (
              <Card style={{ backgroundColor: colors.brandTertiary, borderColor: colors.brandSecondary }}>
                <Row style={{ gap: 6 }}>
                  <Ionicons name="information-circle" size={16} color={colors.brand} />
                  <T size={type.sm} color={colors.onBrandSecondary} style={{ flex: 1 }}>
                    Online payment isn't set up yet. You can still enjoy your free trial, or ask admin to activate a plan for you.
                  </T>
                </Row>
              </Card>
            ) : null}

            {[
              { m: 1, label: "Monthly" },
              { m: 3, label: "3 Months" },
              { m: 6, label: "6 Months" },
              { m: 12, label: "12 Months" },
            ].map((d) => (
              <Card key={d.m} testID={`plan-${d.m}`} style={{ gap: spacing.sm }}>
                <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
                  <View>
                    <T weight="bold" size={type.lg}>{d.label}</T>
                    {d.m >= 6 ? <T size={type.sm} color={colors.brand} weight="semibold">Best value</T> : null}
                  </View>
                  <T weight="extrabold" size={type.xl} color={colors.brand}>₹{sub.prices[String(d.m)] ?? sub.prices[d.m]}</T>
                </Row>
                <Btn title="Pay & Activate" icon="card" onPress={() => buyDuration(d.m)} loading={buying === d.m} testID={`buy-${d.m}`} />
              </Card>
            ))}

            {sub.history?.length ? (
              <>
                <View style={{ height: 1, backgroundColor: colors.divider, marginVertical: spacing.xs }} />
                <T weight="bold" size={type.lg}>Payment History & Invoices</T>
                {sub.history.map((h: any) => (
                  <Card key={h.id} testID={`invoice-row-${h.id}`} style={{ gap: spacing.sm }}>
                    <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                      <View style={{ flex: 1 }}>
                        <T weight="bold">{h.plan_name}</T>
                        <T size={type.sm} color={colors.onSurfaceSecondary}>{h.invoice_no || "—"}</T>
                        <T size={12} color={colors.onSurfaceTertiary}>{new Date(h.created_at).toLocaleDateString()} · {(h.method || "online").toUpperCase()}</T>
                      </View>
                      <T weight="extrabold" color={colors.brand}>₹{h.amount}</T>
                    </Row>
                    <Btn title="Download Invoice" variant="secondary" icon="download" onPress={() => getInvoice(h)} testID={`invoice-${h.id}`} />
                  </Card>
                ))}
              </>
            ) : null}
          </>
        ) : (
          <LoadingView />
        )}
      </Sheet>

      <HostelFormSheet visible={editOpen} onClose={() => setEditOpen(false)} initial={hostel} onSaved={async () => { setEditOpen(false); await refreshHostels(); load(); }} />

      <CelebrationOverlay visible={celebrate} name={activeHostel?.name} planLabel={sub?.subscription?.plan} onClose={() => setCelebrate(false)} />
    </Screen>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <View style={{ flex: 1, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md }}>
      <T weight="extrabold" size={type.lg} color={tone}>{value}</T>
      <T size={type.sm} color={colors.onSurfaceSecondary}>{label}</T>
    </View>
  );
}

const styles = {
  mIcon: { width: 44, height: 44, borderRadius: radius.md, alignItems: "center" as const, justifyContent: "center" as const },
};
