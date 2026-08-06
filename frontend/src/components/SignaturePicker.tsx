import { useState } from "react";
import { View, Pressable, Linking } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { T, Btn } from "@/src/components/ui";
import { useToast } from "@/src/components/Toast";
import { colors, spacing, radius, type } from "@/src/theme";

export function SignaturePicker({
  signature,
  onChange,
  testID,
}: {
  signature?: string | null;
  onChange: (sig: string | null) => void;
  testID?: string;
}) {
  const toast = useToast();
  const [blocked, setBlocked] = useState(false);
  const [busy, setBusy] = useState(false);

  const pick = async () => {
    let perm = await ImagePicker.getMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      if (perm.canAskAgain) {
        perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      }
      if (!perm.granted) {
        if (!perm.canAskAgain) setBlocked(true);
        else toast.show("Photo access is needed to add a signature", "error");
        return;
      }
    }
    setBlocked(false);
    setBusy(true);
    try {
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        base64: true,
        quality: 0.7,
        allowsMultipleSelection: false,
      });
      if (!res.canceled && res.assets[0]?.base64) {
        onChange(`data:image/png;base64,${res.assets[0].base64}`);
      }
    } catch {
      toast.show("Could not open gallery", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: spacing.sm }} testID={testID}>
      <T size={type.sm} weight="semibold" color={colors.onSurfaceSecondary}>
        Owner signature (printed on tenant rent receipts)
      </T>
      {signature ? (
        <View style={styles.sigWrap}>
          <Image source={{ uri: signature }} style={styles.sig} contentFit="contain" />
          <Pressable testID="remove-signature" onPress={() => onChange(null)} style={styles.removeBtn} hitSlop={6}>
            <Ionicons name="close" size={14} color="#fff" />
          </Pressable>
        </View>
      ) : (
        <Pressable testID="add-signature-tile" onPress={pick} disabled={busy} style={styles.addTile}>
          <Ionicons name={busy ? "hourglass" : "create"} size={22} color={colors.brand} />
          <T size={11} weight="semibold" color={colors.brand}>
            {busy ? "..." : "Upload signature"}
          </T>
        </Pressable>
      )}
      {signature ? (
        <Btn title="Replace signature" variant="ghost" icon="image" onPress={pick} loading={busy} testID="replace-signature" />
      ) : null}
      {blocked ? (
        <View style={{ gap: 6 }}>
          <T size={type.sm} color={colors.error}>
            Photo access is blocked. Enable it in Settings to add a signature.
          </T>
          <Btn title="Open Settings" variant="ghost" icon="settings" onPress={() => Linking.openSettings()} testID="open-settings-sig" />
        </View>
      ) : null}
    </View>
  );
}

const styles = {
  sigWrap: { position: "relative" as const, alignSelf: "flex-start" as const },
  sig: {
    width: 200,
    height: 90,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceTertiary,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  removeBtn: {
    position: "absolute" as const,
    top: -6,
    right: -6,
    width: 24,
    height: 24,
    borderRadius: radius.pill,
    backgroundColor: colors.error,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  addTile: {
    width: 200,
    height: 90,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderStyle: "dashed" as const,
    borderColor: colors.brand,
    backgroundColor: colors.brandTertiary,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 4,
  },
};
