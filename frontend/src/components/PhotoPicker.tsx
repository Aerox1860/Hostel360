import { useState } from "react";
import { View, Pressable, ScrollView, Linking } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { T, Btn } from "@/src/components/ui";
import { useToast } from "@/src/components/Toast";
import { colors, spacing, radius, type } from "@/src/theme";

export function PhotoPicker({
  photos,
  onChange,
  testID,
}: {
  photos: string[];
  onChange: (photos: string[]) => void;
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
        if (!perm.canAskAgain) {
          setBlocked(true);
        } else {
          toast.show("Photo access is needed to add photos", "error");
        }
        return;
      }
    }
    setBlocked(false);
    setBusy(true);
    try {
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        base64: true,
        quality: 0.5,
        allowsMultipleSelection: true,
        selectionLimit: 6,
      });
      if (!res.canceled) {
        const added = res.assets
          .filter((a) => a.base64)
          .map((a) => `data:image/jpeg;base64,${a.base64}`);
        onChange([...photos, ...added].slice(0, 8));
      }
    } catch {
      toast.show("Could not open gallery", "error");
    } finally {
      setBusy(false);
    }
  };

  const remove = (idx: number) => onChange(photos.filter((_, i) => i !== idx));

  return (
    <View style={{ gap: spacing.sm }} testID={testID}>
      <T size={type.sm} weight="semibold" color={colors.onSurfaceSecondary}>
        Photos {photos.length ? `(${photos.length})` : ""}
      </T>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
        {photos.map((p, i) => (
          <View key={i} style={styles.thumbWrap}>
            <Image source={{ uri: p }} style={styles.thumb} contentFit="cover" />
            <Pressable testID={`remove-photo-${i}`} onPress={() => remove(i)} style={styles.removeBtn} hitSlop={6}>
              <Ionicons name="close" size={14} color="#fff" />
            </Pressable>
          </View>
        ))}
        <Pressable testID="add-photo-tile" onPress={pick} disabled={busy} style={styles.addTile}>
          <Ionicons name={busy ? "hourglass" : "camera"} size={22} color={colors.brand} />
          <T size={11} weight="semibold" color={colors.brand}>
            {busy ? "..." : "Add"}
          </T>
        </Pressable>
      </ScrollView>
      {blocked ? (
        <View style={{ gap: 6 }}>
          <T size={type.sm} color={colors.error}>
            Photo access is blocked. Enable it in Settings to add photos.
          </T>
          <Btn title="Open Settings" variant="ghost" icon="settings" onPress={() => Linking.openSettings()} testID="open-settings" />
        </View>
      ) : null}
    </View>
  );
}

const styles = {
  thumbWrap: { position: "relative" as const },
  thumb: { width: 84, height: 84, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary },
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
    width: 84,
    height: 84,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderStyle: "dashed" as const,
    borderColor: colors.brand,
    backgroundColor: colors.brandTertiary,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 2,
  },
};
