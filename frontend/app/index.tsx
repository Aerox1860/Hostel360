import { useEffect } from "react";
import { View } from "react-native";
import { Redirect } from "expo-router";
import { useAuth, routeForRole } from "@/src/context/AuthContext";
import { LoadingView } from "@/src/components/ui";
import { colors } from "@/src/theme";

export default function Index() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.surface }}>
        <LoadingView label="Loading Hostel 360" />
      </View>
    );
  }

  if (user) {
    return <Redirect href={routeForRole(user.role) as any} />;
  }
  return <Redirect href={"/(public)" as any} />;
}
