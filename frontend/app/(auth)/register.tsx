import { useState } from "react";
import { View, Pressable } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { router } from "expo-router";
import { Screen, T, Field, Btn, Row, AppHeader } from "@/src/components/ui";
import { useAuth, routeForRole } from "@/src/context/AuthContext";
import { useToast } from "@/src/components/Toast";
import { colors, spacing, radius, type } from "@/src/theme";

export default function Register() {
  const { register } = useAuth();
  const toast = useToast();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [mobile, setMobile] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"tenant" | "owner">("tenant");
  const [loading, setLoading] = useState(false);

  const onSubmit = async () => {
    if (!name || !email || !password) {
      toast.show("Fill in all required fields", "error");
      return;
    }
    setLoading(true);
    try {
      const user = await register({ name, email: email.trim(), mobile, password, role });
      toast.show("Account created!");
      router.replace(routeForRole(user.role) as any);
    } catch (e: any) {
      toast.show(e.message || "Registration failed", "error");
    } finally {
      setLoading(false);
    }
  };

  const RoleCard = ({ value, title, desc, icon }: { value: "tenant" | "owner"; title: string; desc: string; icon: string }) => (
    <Pressable
      testID={`role-${value}`}
      onPress={() => setRole(value)}
      style={{
        flex: 1,
        padding: spacing.md,
        borderRadius: radius.md,
        borderWidth: 1.5,
        borderColor: role === value ? colors.brand : colors.border,
        backgroundColor: role === value ? colors.brandTertiary : colors.surface,
        gap: 4,
      }}
    >
      <T weight="bold" size={type.lg} color={role === value ? colors.brand : colors.onSurface}>
        {title}
      </T>
      <T size={type.sm} color={colors.onSurfaceSecondary}>
        {desc}
      </T>
    </Pressable>
  );

  return (
    <Screen edges={["top", "bottom"]} bg={colors.surface}>
      <AppHeader title="Create account" onBack={() => router.back()} />
      <KeyboardAwareScrollView
        bottomOffset={24}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg }}
      >
        <T weight="semibold" color={colors.onSurfaceSecondary}>
          I am a
        </T>
        <Row style={{ gap: spacing.md }}>
          <RoleCard value="tenant" title="Tenant" desc="View rent, receipts & notices" icon="person" />
          <RoleCard value="owner" title="Hostel Owner" desc="Manage rooms & tenants" icon="business" />
        </Row>

        <Field label="Full name" value={name} onChangeText={setName} placeholder="John Doe" autoCapitalize="words" testID="reg-name" />
        <Field label="Email" value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" testID="reg-email" />
        <Field label="Mobile" value={mobile} onChangeText={setMobile} placeholder="9876543210" keyboardType="phone-pad" testID="reg-mobile" />
        <Field label="Password" value={password} onChangeText={setPassword} placeholder="Min 6 characters" secureTextEntry testID="reg-password" />

        <Btn title="Create Account" onPress={onSubmit} loading={loading} testID="reg-submit" />
        <Row style={{ justifyContent: "center", gap: 4 }}>
          <T color={colors.onSurfaceSecondary}>Already have an account?</T>
          <Pressable onPress={() => router.replace("/(auth)/login" as any)}>
            <T weight="bold" color={colors.brand}>
              Sign in
            </T>
          </Pressable>
        </Row>
      </KeyboardAwareScrollView>
    </Screen>
  );
}
