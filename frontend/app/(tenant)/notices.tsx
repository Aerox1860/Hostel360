import { useCallback, useState } from "react";
import { View, FlatList } from "react-native";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen, AppHeader, T, Card, Row, LoadingView, EmptyState } from "@/src/components/ui";
import { api } from "@/src/api/client";
import { colors, spacing, type, radius } from "@/src/theme";

export default function TenantNotices() {
  const [notices, setNotices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const { notices } = await api.get<{ notices: any[] }>("/tenant/notices");
      setNotices(notices);
    } catch {
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading) return <Screen><LoadingView /></Screen>;

  return (
    <Screen edges={["top"]}>
      <AppHeader title="Notices" subtitle="From your hostel" />
      <FlatList
        data={notices}
        keyExtractor={(n) => n.id}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}
        ListEmptyComponent={<View style={{ flex: 1 }}><EmptyState icon="megaphone-outline" title="No notices" subtitle="Announcements from your owner will appear here." /></View>}
        renderItem={({ item }) => (
          <Card testID={`notice-${item.id}`} style={{ gap: spacing.sm, flexDirection: "row" }}>
            <View style={styles.icon}><Ionicons name="megaphone" size={18} color={colors.brand} /></View>
            <View style={{ flex: 1 }}>
              <T weight="bold">{item.title}</T>
              <T size={type.sm} color={colors.onSurfaceSecondary}>{item.body}</T>
              <T size={12} color={colors.onSurfaceTertiary} style={{ marginTop: 4 }}>{new Date(item.created_at).toLocaleDateString()}</T>
            </View>
          </Card>
        )}
      />
    </Screen>
  );
}

const styles = {
  icon: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.brandSecondary, alignItems: "center" as const, justifyContent: "center" as const },
};
