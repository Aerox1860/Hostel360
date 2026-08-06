import { useCallback, useState } from "react";
import { View, FlatList, ScrollView, RefreshControl, Pressable } from "react-native";
import { useFocusEffect, router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen, T, Chip, LoadingView, EmptyState, Field } from "@/src/components/ui";
import { HostelCard, Hostel } from "@/src/components/HostelCard";
import { Logo } from "@/src/components/Logo";
import { api } from "@/src/api/client";
import { useAuth } from "@/src/context/AuthContext";
import { colors, spacing, type, radius } from "@/src/theme";

const GENDERS = [
  { k: "all", label: "All" },
  { k: "boys", label: "Boys" },
  { k: "girls", label: "Girls" },
  { k: "co-living", label: "Co-Living" },
  { k: "pg", label: "PG" },
];
const SHARING = [
  { k: "all", label: "Any sharing" },
  { k: "single", label: "Single" },
  { k: "double", label: "Double" },
  { k: "triple", label: "Triple" },
];

export default function Explore() {
  const { user } = useAuth();
  const [hostels, setHostels] = useState<Hostel[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [q, setQ] = useState("");
  const [gender, setGender] = useState("all");
  const [sharing, setSharing] = useState("all");
  const [favIds, setFavIds] = useState<string[]>([]);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (gender !== "all") params.set("gender", gender);
      if (sharing !== "all") params.set("sharing", sharing);
      const { hostels } = await api.get<{ hostels: Hostel[] }>(`/public/hostels?${params.toString()}`);
      setHostels(hostels);
      if (user) {
        const f = await api.get<{ hostels: Hostel[] }>("/favorites");
        setFavIds(f.hostels.map((h) => h.id));
      }
    } catch {
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [q, gender, sharing, user]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const toggleFav = async (id: string) => {
    if (!user) {
      router.push("/(auth)/login" as any);
      return;
    }
    setFavIds((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
    try {
      await api.post(`/favorites/${id}`);
    } catch {}
  };

  return (
    <Screen edges={["top"]}>
      <View style={{ backgroundColor: colors.surface, borderBottomColor: colors.divider, borderBottomWidth: 1 }}>
        <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md, gap: spacing.md }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Logo size={34} />
            <Pressable
              testID="header-search-hint"
              onPress={() => {}}
              style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
            >
              <Ionicons name="location-outline" size={16} color={colors.brand} />
              <T size={type.sm} weight="semibold" color={colors.brand}>
                Find your stay
              </T>
            </Pressable>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, paddingHorizontal: spacing.md }}>
            <Ionicons name="search" size={18} color={colors.onSurfaceTertiary} />
            <View style={{ flex: 1 }}>
              <Field value={q} onChangeText={setQ} placeholder="Search by name, city or area" testID="search-input" />
            </View>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: spacing.sm, paddingRight: spacing.lg }}
          >
            {GENDERS.map((g) => (
              <Chip key={g.k} label={g.label} active={gender === g.k} onPress={() => setGender(g.k)} testID={`chip-gender-${g.k}`} />
            ))}
          </ScrollView>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: spacing.sm, paddingRight: spacing.lg }}
          >
            {SHARING.map((s) => (
              <Chip key={s.k} label={s.label} active={sharing === s.k} onPress={() => setSharing(s.k)} testID={`chip-sharing-${s.k}`} />
            ))}
          </ScrollView>
        </View>
      </View>

      {loading ? (
        <LoadingView label="Finding hostels" />
      ) : (
        <FlatList
          data={hostels}
          keyExtractor={(h) => h.id}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing["3xl"] }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brand} />}
          ListEmptyComponent={
            <View style={{ paddingTop: spacing["3xl"] }}>
              <EmptyState
                icon="home-outline"
                title="No hostels found"
                subtitle="Try adjusting your filters or search a different city."
                ctaLabel="Reset filters"
                onCta={() => { setGender("all"); setSharing("all"); setQ(""); }}
              />
            </View>
          }
          renderItem={({ item }) => (
            <HostelCard
              hostel={item}
              testID={`hostel-${item.id}`}
              favorited={favIds.includes(item.id)}
              onToggleFav={() => toggleFav(item.id)}
              onPress={() => router.push(`/hostel/${item.id}` as any)}
            />
          )}
        />
      )}
    </Screen>
  );
}
