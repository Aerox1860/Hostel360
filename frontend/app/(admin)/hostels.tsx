import { useCallback, useState } from "react";
import { View, FlatList, ScrollView, Pressable } from "react-native";
import { useFocusEffect, router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen, AppHeader, T, Chip, Card, Row, Badge, LoadingView, EmptyState, Sheet, Btn } from "@/src/components/ui";
import { api } from "@/src/api/client";
import { useToast } from "@/src/components/Toast";
import { colors, spacing, type, radius } from "@/src/theme";

const FILTERS = [
  { k: "all", label: "All" },
  { k: "pending", label: "Pending" },
  { k: "approved", label: "Approved" },
  { k: "suspended", label: "Suspended" },
  { k: "rejected", label: "Rejected" },
];

const statusTone: Record<string, any> = { approved: "success", pending: "warning", suspended: "error", rejected: "neutral" };

export default function AdminHostels() {
  const toast = useToast();
  const [filter, setFilter] = useState("all");
  const [hostels, setHostels] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState<any>(null);

  const load = useCallback(async () => {
    try {
      const { hostels } = await api.get<{ hostels: any[] }>(`/admin/hostels?status_filter=${filter}`);
      setHostels(hostels);
    } catch {
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  const act = async (action: string) => {
    if (!sel) return;
    try {
      await api.post(`/admin/hostels/${sel.id}/verify`, { action });
      toast.show(`Hostel ${action}${action.endsWith("e") ? "d" : "ed"}`);
      setSel(null);
      load();
    } catch (e: any) {
      toast.show(e.message, "error");
    }
  };

  return (
    <Screen edges={["top"]}>
      <AppHeader title="Hostel Verification" subtitle="Review & manage all listings" />
      <View style={{ backgroundColor: colors.surface, borderBottomColor: colors.divider, borderBottomWidth: 1, paddingVertical: spacing.md }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingHorizontal: spacing.lg }}>
          {FILTERS.map((f) => (
            <Chip key={f.k} label={f.label} active={filter === f.k} onPress={() => setFilter(f.k)} testID={`filter-${f.k}`} />
          ))}
        </ScrollView>
      </View>

      {loading ? (
        <LoadingView />
      ) : (
        <FlatList
          data={hostels}
          keyExtractor={(h) => h.id}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}
          ListEmptyComponent={<View style={{ flex: 1 }}><EmptyState icon="business-outline" title="No hostels here" /></View>}
          renderItem={({ item }) => (
            <Card testID={`admin-hostel-${item.id}`} style={{ gap: spacing.sm }}>
              <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                <View style={{ flex: 1 }}>
                  <T weight="bold" size={type.lg}>{item.name}</T>
                  <T size={type.sm} color={colors.onSurfaceSecondary}>{item.owner_name} · {item.city}, {item.state}</T>
                </View>
                <Badge label={item.status} tone={statusTone[item.status] || "neutral"} />
              </Row>
              <Row style={{ gap: spacing.md, flexWrap: "wrap" }}>
                <MetaChip icon="shield-checkmark" text={item.verification_status === "verified" ? "Verified" : "Unverified"} />
                <MetaChip icon="walk" text={`Site: ${item.site_visit_status === "verified" ? "Done" : "Pending"}`} />
                {item.premium_plan ? <MetaChip icon="diamond" text={item.premium_plan} /> : null}
              </Row>
              <Row style={{ gap: spacing.sm, marginTop: spacing.xs }}>
                <View style={{ flex: 1 }}>
                  <Btn title="View" variant="secondary" icon="eye" onPress={() => router.push(`/hostel/${item.id}` as any)} testID={`admin-view-${item.id}`} />
                </View>
                <View style={{ flex: 1 }}>
                  <Btn title="Manage" icon="settings" onPress={() => setSel(item)} testID={`admin-manage-${item.id}`} />
                </View>
              </Row>
            </Card>
          )}
        />
      )}

      <Sheet visible={!!sel} onClose={() => setSel(null)} title={sel?.name}>
        <T color={colors.onSurfaceSecondary}>Take a verification action for this hostel.</T>
        <View style={{ gap: spacing.sm }}>
          <Btn title="Approve Hostel" icon="checkmark-circle" onPress={() => act("approve")} testID="action-approve" />
          <Btn title="Suspend Hostel" variant="secondary" icon="pause-circle" onPress={() => act("suspend")} testID="action-suspend" />
          <Btn title="Reactivate Hostel" variant="secondary" icon="play-circle" onPress={() => act("reactivate")} testID="action-reactivate" />
          <Btn title="Reject Hostel" variant="danger" icon="close-circle" onPress={() => act("reject")} testID="action-reject" />
        </View>
      </Sheet>
    </Screen>
  );
}

function MetaChip({ icon, text }: { icon: any; text: string }) {
  return (
    <Row style={{ gap: 4, backgroundColor: colors.surfaceSecondary, paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.sm }}>
      <Ionicons name={icon} size={12} color={colors.onSurfaceSecondary} />
      <T size={12} color={colors.onSurfaceSecondary}>{text}</T>
    </Row>
  );
}
