import { useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { Screen, T, Field, Btn } from "@/src/components/ui";
import { Logo } from "@/src/components/Logo";
import { useAuth, routeAfterAuthentication } from "@/src/context/AuthContext";
import { useToast } from "@/src/components/Toast";
import { colors, spacing, type } from "@/src/theme";

export default function ChangePassword() {
  const { propertyId } = useLocalSearchParams<{ propertyId?: string | string[] }>();
  const {
    changeTenantPassword,
    linkPendingGoogleAccount,
    googleLinkPending,
    logout,
  } = useAuth();
  const toast = useToast();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!currentPassword || newPassword.length < 8 || newPassword.length > 72) {
      toast.show("Use a new password between 8 and 72 characters.", "error");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.show("The new passwords do not match.", "error");
      return;
    }
    setSaving(true);
    try {
      const user = await changeTenantPassword(currentPassword, newPassword);
      let googleLinkError: string | null = null;
      if (googleLinkPending) {
        try {
          await linkPendingGoogleAccount();
        } catch (error) {
          googleLinkError = error instanceof Error ? error.message : "Google could not be linked.";
        }
      }
      toast.show(
        googleLinkError
          ? `Password updated, but Google could not be linked: ${googleLinkError}`
          : googleLinkPending
            ? "Password updated and Google Sign-In linked."
            : "Password updated. Welcome to Hostel360!",
        googleLinkError ? "error" : "success",
      );
      const selectedPropertyId = Array.isArray(propertyId) ? propertyId[0] : propertyId;
      router.replace(routeAfterAuthentication(user, selectedPropertyId) as any);
    } catch (error) {
      toast.show(error instanceof Error ? error.message : "Could not update password.", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen edges={["top", "bottom"]} bg={colors.surface}>
      <KeyboardAwareScrollView
        bottomOffset={24}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ flexGrow: 1, padding: spacing.xl, justifyContent: "center", gap: spacing.lg }}
      >
        <Logo size={54} />
        <T weight="extrabold" size={type["2xl"]}>Set a new password</T>
        <T color={colors.onSurfaceSecondary}>
          For your security, change your temporary password before continuing.
        </T>
        {googleLinkPending ? (
          <T color={colors.onSurfaceSecondary}>
            Your Google account will be linked after this password change.
          </T>
        ) : null}
        <Field
          label="Current temporary password"
          value={currentPassword}
          onChangeText={setCurrentPassword}
          secureTextEntry
          testID="current-password"
        />
        <Field
          label="New password"
          value={newPassword}
          onChangeText={setNewPassword}
          placeholder="At least 8 characters"
          secureTextEntry
          testID="new-password"
        />
        <Field
          label="Confirm new password"
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          secureTextEntry
          testID="confirm-password"
        />
        <Btn title="Save new password" onPress={submit} loading={saving} testID="save-password" />
        <Btn title="Log out" variant="ghost" onPress={logout} disabled={saving} testID="password-logout" />
      </KeyboardAwareScrollView>
    </Screen>
  );
}
