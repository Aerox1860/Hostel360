import { useCallback, useState } from "react";
import { View, FlatList } from "react-native";
import { useFocusEffect, router } from "expo-router";
import { Screen, AppHeader, LoadingView, EmptyState } from "@/src/components/ui";
import { HostelCard, Hostel } from "@/src/components/HostelCard";
import { api } from "@/src/api/client";
import { useAuth } from "@/src/context/AuthContext";
import { spacing } from "@/src/theme";

export default function Favorites() {
  const { user } = useAuth();
  const [hostels, setHostels] = useState<Hostel[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    try {
      const { hostels } = await api.get<{ hostels: Hostel[] }>("/favorites");
      setHostels(hostels);
    } catch {
    } finally {
      setLoading(false);
    }
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load();
    }, [load])
  );

  return (
    <Screen edges={["top"]}>
      <AppHeader title="Saved Hostels" subtitle="Your shortlisted places" />
      {loading ? (
        <LoadingView />
      ) : !user ? (
        <EmptyState
          icon="heart-outline"
          title="Sign in to save hostels"
          subtitle="Create a free account to shortlist and compare hostels."
          ctaLabel="Sign in"
          onCta={() => router.push("/(auth)/login" as any)}
        />
      ) : (
        <FlatList
          data={hostels}
          keyExtractor={(h) => h.id}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, flexGrow: 1 }}
          ListEmptyComponent={
            <View style={{ flex: 1 }}>
              <EmptyState icon="heart-outline" title="No saved hostels yet" subtitle="Tap the heart on any hostel to save it here." />
            </View>
          }
          renderItem={({ item }) => (
            <HostelCard hostel={item} onPress={() => router.push(`/hostel/${item.id}` as any)} />
          )}
        />
      )}
    </Screen>
  );
}
