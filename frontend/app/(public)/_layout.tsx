import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors, font } from "@/src/theme";

export default function PublicLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.onSurfaceTertiary,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.divider,
          height: 72,
          paddingBottom: 6,
          paddingTop: 6,
        },
        tabBarItemStyle: { minHeight: 48, justifyContent: "center" },
        tabBarIconStyle: { marginBottom: 2 },
        tabBarLabelStyle: { fontFamily: font.semibold, fontSize: 12, marginTop: 2 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Explore",
          tabBarIcon: ({ color }) => <Ionicons name="search" color={color} size={22} />,
          tabBarAccessibilityLabel: "Explore hostels",
        }}
      />
      <Tabs.Screen
        name="favorites"
        options={{
          title: "Saved",
          tabBarIcon: ({ color }) => <Ionicons name="heart" color={color} size={22} />,
          tabBarAccessibilityLabel: "Saved hostels",
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: "Account",
          tabBarIcon: ({ color }) => <Ionicons name="person-circle" color={color} size={22} />,
          tabBarAccessibilityLabel: "Account",
        }}
      />
    </Tabs>
  );
}
