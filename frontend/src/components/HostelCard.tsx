import React from "react";
import { View, Pressable } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { T, Badge } from "@/src/components/ui";
import { colors, spacing, radius, shadow, type } from "@/src/theme";

export interface Hostel {
  id: string;
  name: string;
  city?: string;
  area?: string;
  gender?: string;
  photos?: string[];
  amenities?: string[];
  min_rent?: number | null;
  rating?: number;
  verification_status?: string;
  status?: string;
}

const genderLabel: Record<string, string> = {
  boys: "Boys Hostel",
  girls: "Girls Hostel",
  "co-living": "Co-Living",
  pg: "PG",
};

export function HostelCard({
  hostel,
  onPress,
  favorited,
  onToggleFav,
  testID,
}: {
  hostel: Hostel;
  onPress: () => void;
  favorited?: boolean;
  onToggleFav?: () => void;
  testID?: string;
}) {
  const photo = hostel.photos?.[0];
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      style={({ pressed }) => [
        {
          backgroundColor: colors.surface,
          borderRadius: radius.lg,
          overflow: "hidden",
          borderWidth: 1,
          borderColor: colors.border,
        },
        shadow.card,
        pressed ? { opacity: 0.92 } : null,
      ]}
    >
      <View style={{ height: 168 }}>
        {photo ? (
          <Image source={{ uri: photo }} style={{ width: "100%", height: "100%" }} contentFit="cover" transition={200} />
        ) : (
          <View style={{ flex: 1, backgroundColor: colors.surfaceTertiary }} />
        )}
        <LinearGradient
          colors={["transparent", "rgba(26,29,26,0.75)"]}
          style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 90 }}
        />
        {hostel.verification_status === "verified" ? (
          <View style={styles.verifiedBadge}>
            <Ionicons name="shield-checkmark" size={13} color={colors.onBrandPrimary} />
            <T size={11} weight="bold" color={colors.onBrandPrimary}>
              Verified
            </T>
          </View>
        ) : null}
        {onToggleFav ? (
          <Pressable testID={`fav-${hostel.id}`} onPress={onToggleFav} hitSlop={10} style={styles.favBtn}>
            <Ionicons name={favorited ? "heart" : "heart-outline"} size={18} color={favorited ? colors.error : colors.onSurface} />
          </Pressable>
        ) : null}
        <View style={{ position: "absolute", left: spacing.md, right: spacing.md, bottom: spacing.md }}>
          <T weight="extrabold" size={type.lg} color="#fff" numberOfLines={1}>
            {hostel.name}
          </T>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 }}>
            <Ionicons name="location" size={12} color="#fff" />
            <T size={type.sm} color="#fff" numberOfLines={1}>
              {[hostel.area, hostel.city].filter(Boolean).join(", ")}
            </T>
          </View>
        </View>
      </View>
      <View style={{ padding: spacing.md, gap: spacing.sm }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <View style={{ flexDirection: "row", gap: spacing.sm, alignItems: "center" }}>
            <Badge label={genderLabel[hostel.gender || "pg"] || "PG"} tone="brand" />
            {hostel.rating ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
                <Ionicons name="star" size={13} color={colors.warning} />
                <T size={type.sm} weight="bold">
                  {hostel.rating}
                </T>
              </View>
            ) : null}
          </View>
          {hostel.min_rent ? (
            <T weight="extrabold" size={type.lg} color={colors.brand}>
              ₹{hostel.min_rent}
              <T size={type.sm} color={colors.onSurfaceTertiary}>
                /mo
              </T>
            </T>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = {
  verifiedBadge: {
    position: "absolute" as const,
    top: spacing.md,
    right: spacing.md,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    backgroundColor: colors.brand,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  favBtn: {
    position: "absolute" as const,
    top: spacing.md,
    left: spacing.md,
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    backgroundColor: "rgba(255,255,255,0.92)",
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
};
