import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors, font } from "@/src/theme";

export default function AdminLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.onSurfaceTertiary,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.divider, height: 64, paddingBottom: 8, paddingTop: 6 },
        tabBarLabelStyle: { fontFamily: font.semibold, fontSize: 11 },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Dashboard", tabBarIcon: ({ color, size }) => <Ionicons name="stats-chart" color={color} size={size} /> }} />
      <Tabs.Screen name="hostels" options={{ title: "Hostels", tabBarIcon: ({ color, size }) => <Ionicons name="business" color={color} size={size} /> }} />
      <Tabs.Screen name="plans" options={{ title: "Plans", tabBarIcon: ({ color, size }) => <Ionicons name="pricetags" color={color} size={size} /> }} />
      <Tabs.Screen name="owners" options={{ title: "Owners", tabBarIcon: ({ color, size }) => <Ionicons name="people" color={color} size={size} /> }} />
    </Tabs>
  );
}
