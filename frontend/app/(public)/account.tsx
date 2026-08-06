import { View, Pressable, ScrollView } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen, AppHeader, T, Btn, Card, Row } from "@/src/components/ui";
import { Logo } from "@/src/components/Logo";
import { useAuth, routeForRole } from "@/src/context/AuthContext";
import { colors, spacing, radius, type } from "@/src/theme";

export default function Account() {
  const { user, logout } = useAuth();

  const roleLabel = user
    ? { admin: "Platform Admin", owner: "Hostel Owner", tenant: "Tenant" }[user.role]
    : null;

  return (
    <Screen edges={["top"]}>
      <AppHeader title="Account" />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}>
        {!user ? (
          <>
            <Card style={{ alignItems: "center", gap: spacing.md, paddingVertical: spacing.xl }}>
              <Logo size={50} showText={false} />
              <T weight="extrabold" size={type.xl} style={{ textAlign: "center" }}>
                Welcome to Hostel 360
              </T>
              <T color={colors.onSurfaceSecondary} style={{ textAlign: "center", maxWidth: 280 }}>
                Sign in to manage your hostel, view your rent, or save your favorite stays.
              </T>
              <View style={{ width: "100%", gap: spacing.sm, marginTop: spacing.sm }}>
                <Btn title="Sign In" onPress={() => router.push("/(auth)/login" as any)} testID="account-signin" />
                <Btn title="Create Account" variant="ghost" onPress={() => router.push("/(auth)/register" as any)} testID="account-register" />
              </View>
            </Card>
            <FeatureRow icon="business" title="List your hostel" desc="Owners can add rooms, tenants & collect rent" />
            <FeatureRow icon="receipt" title="Tenant portal" desc="View rent status, receipts & raise complaints" />
            <FeatureRow icon="shield-checkmark" title="Verified listings" desc="Every hostel is admin-verified for trust" />
          </>
        ) : (
          <>
            <Card>
              <Row style={{ gap: spacing.md }}>
                <View style={styles.avatar}>
                  <T weight="extrabold" size={type.xl} color={colors.onBrandPrimary}>
                    {(user.name || user.email || "?")[0].toUpperCase()}
                  </T>
                </View>
                <View style={{ flex: 1 }}>
                  <T weight="bold" size={type.lg}>
                    {user.name || "User"}
                  </T>
                  <T size={type.sm} color={colors.onSurfaceSecondary}>
                    {user.email}
                  </T>
                  <View style={{ marginTop: 4, backgroundColor: colors.brandSecondary, alignSelf: "flex-start", paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.pill }}>
                    <T size={11} weight="bold" color={colors.brand}>
                      {roleLabel}
                    </T>
                  </View>
                </View>
              </Row>
            </Card>

            <Btn
              title="Go to my dashboard"
              icon="grid"
              onPress={() => router.replace(routeForRole(user.role) as any)}
              testID="account-dashboard"
            />
            <Btn title="Browse hostels" variant="secondary" icon="search" onPress={() => router.push("/(public)" as any)} />
            <Btn title="Log out" variant="ghost" icon="log-out" onPress={logout} testID="account-logout" />
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

function FeatureRow({ icon, title, desc }: { icon: any; title: string; desc: string }) {
  return (
    <Row style={{ gap: spacing.md, paddingHorizontal: spacing.xs }}>
      <View style={styles.featIcon}>
        <Ionicons name={icon} size={20} color={colors.brand} />
      </View>
      <View style={{ flex: 1 }}>
        <T weight="bold">{title}</T>
        <T size={type.sm} color={colors.onSurfaceSecondary}>
          {desc}
        </T>
      </View>
    </Row>
  );
}

const styles = {
  avatar: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    backgroundColor: colors.brand,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  featIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.brandSecondary,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
};
