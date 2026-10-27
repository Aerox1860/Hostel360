import { useState } from "react";
import { View, Pressable, Platform } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { router, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen, T, Field, Btn, Row } from "@/src/components/ui";
import { Logo } from "@/src/components/Logo";
import { GoogleSignInButton } from "@/src/components/GoogleSignInButton";
import { useAuth, routeAfterAuthentication } from "@/src/context/AuthContext";
import { useToast } from "@/src/components/Toast";
import { colors, spacing, radius, type } from "@/src/theme";

export default function Login() {
  const { propertyId } = useLocalSearchParams<{ propertyId?: string | string[] }>();
  const {
    login,
    loginWithGoogle,
    loginWithGoogleToken,
    linkPendingGoogleAccount,
    googleLinkPending,
  } = useAuth();
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const selectedPropertyId = Array.isArray(propertyId) ? propertyId[0] : propertyId;
  const directGoogleWebEnabled =
    Platform.OS === "web" &&
    process.env.EXPO_PUBLIC_GOOGLE_DIRECT_SIGNIN_ENABLED === "true" &&
    Boolean(process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID);

  const onLogin = async () => {
    if (!email || !password) {
      toast.show("Enter email and password", "error");
      return;
    }
    setLoading(true);
    try {
      const user = await login(email.trim(), password);
      if (googleLinkPending && !user.must_change_password) {
        try {
          await linkPendingGoogleAccount();
          toast.show("Google Sign-In linked to your account");
        } catch (error: any) {
          toast.show(error.message || "Could not link Google Sign-In", "error");
        }
      }
      if (user.must_change_password) {
        toast.show("Set a new password to continue", "info");
      } else {
        toast.show(`Welcome back, ${user.name || "there"}!`);
      }
      router.replace(routeAfterAuthentication(user, selectedPropertyId) as any);
    } catch (e: any) {
      toast.show(e.message || "Login failed", "error");
    } finally {
      setLoading(false);
    }
  };

  const onGooglePress = async () => {
    try {
      await loginWithGoogle(selectedPropertyId);
    } catch (error: any) {
      toast.show(error.message || "Google Sign-In failed", "error");
    }
  };

  const onGoogleCredential = async (idToken: string) => {
    try {
      await loginWithGoogleToken(idToken, selectedPropertyId);
    } catch (error: any) {
      toast.show(error.message || "Google Sign-In failed", "error");
    }
  };

  return (
    <Screen edges={["top", "bottom"]} bg={colors.surface}>
      <KeyboardAwareScrollView
        bottomOffset={24}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ flexGrow: 1, padding: spacing.xl, justifyContent: "center", gap: spacing.lg }}
      >
        <Pressable
          testID="login-back"
          onPress={() => router.replace("/(public)" as any)}
          hitSlop={10}
          style={{ position: "absolute", top: spacing.md, left: spacing.lg }}
        >
          <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
        </Pressable>

        <View style={{ alignItems: "center", marginBottom: spacing.md }}>
          <Logo size={54} />
          <T size={type.base} color={colors.onSurfaceSecondary} style={{ marginTop: spacing.md }}>
            Manage & discover hostels, all in one place
          </T>
        </View>

        <T weight="extrabold" size={type["2xl"]}>
          Sign in
        </T>

        <Field
          label="Email"
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          keyboardType="email-address"
          testID="login-email"
        />
        <Field
          label="Password"
          value={password}
          onChangeText={setPassword}
          placeholder="••••••••"
          secureTextEntry
          testID="login-password"
        />

        <Btn title="Sign In" onPress={onLogin} loading={loading} testID="login-submit" />

        <Row style={{ gap: spacing.md, marginVertical: spacing.xs }}>
          <View style={{ flex: 1, height: 1, backgroundColor: colors.divider }} />
          <T size={type.sm} color={colors.onSurfaceTertiary}>
            or
          </T>
          <View style={{ flex: 1, height: 1, backgroundColor: colors.divider }} />
        </Row>

        {directGoogleWebEnabled ? (
          <GoogleSignInButton
            onCredential={onGoogleCredential}
            onError={(error) => toast.show(error.message || "Google Sign-In failed", "error")}
          />
        ) : (
          <Pressable testID="login-google" onPress={onGooglePress} style={googleStyle}>
            <Ionicons name="logo-google" size={20} color={colors.onSurface} />
            <T weight="bold" size={type.lg}>
              Continue with Google
            </T>
          </Pressable>
        )}
        {googleLinkPending ? (
          <T size={type.sm} color={colors.onSurfaceSecondary} style={{ textAlign: "center" }}>
            Sign in with your existing password to securely link this Google account.
          </T>
        ) : null}

        <Row style={{ justifyContent: "center", gap: 4, marginTop: spacing.sm }}>
          <T color={colors.onSurfaceSecondary}>New here?</T>
          <Pressable
            testID="go-register"
            onPress={() => router.push({
              pathname: "/(auth)/register",
              ...(propertyId ? { params: { propertyId } } : {}),
            })}
          >
            <T weight="bold" color={colors.brand}>
              Create an account
            </T>
          </Pressable>
        </Row>
      </KeyboardAwareScrollView>
    </Screen>
  );
}

const googleStyle = {
  height: 52,
  borderRadius: radius.md,
  borderWidth: 1.5,
  borderColor: colors.borderStrong,
  alignItems: "center" as const,
  justifyContent: "center" as const,
  flexDirection: "row" as const,
  gap: spacing.sm,
  backgroundColor: colors.surface,
};
