import { useState } from "react";
import { View, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { T, Sheet, Btn, Row, Badge } from "@/src/components/ui";
import { HostelFormSheet } from "@/src/components/HostelFormSheet";
import { useOwnerHostel } from "@/src/context/OwnerHostelContext";
import { colors, spacing, radius, type } from "@/src/theme";

export function HostelSwitcher() {
  const { hostels, activeId, activeHostel, setActive, refresh } = useOwnerHostel();
  const [open, setOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  if (!activeHostel) return null;

  return (
    <>
      <Pressable testID="hostel-switcher" onPress={() => setOpen(true)} style={styles.pill}>
        <Ionicons name="business" size={16} color={colors.brand} />
        <T weight="bold" size={type.sm} color={colors.brand} numberOfLines={1} style={{ maxWidth: 180 }}>
          {activeHostel.name}
        </T>
        {hostels.length > 1 ? <Ionicons name="chevron-down" size={14} color={colors.brand} /> : null}
      </Pressable>

      <Sheet visible={open} onClose={() => setOpen(false)} title="My Hostels">
        {hostels.map((h) => (
          <Pressable
            key={h.id}
            testID={`switch-${h.id}`}
            onPress={() => { setActive(h.id); setOpen(false); }}
            style={[styles.row, h.id === activeId ? { borderColor: colors.brand, backgroundColor: colors.brandTertiary } : null]}
          >
            <View style={{ flex: 1 }}>
              <T weight="bold">{h.name}</T>
              <T size={type.sm} color={colors.onSurfaceSecondary}>{[h.area, h.city].filter(Boolean).join(", ") || "No address"}</T>
            </View>
            <Row style={{ gap: spacing.sm }}>
              <Badge label={h.status} tone={h.status === "approved" ? "success" : h.status === "pending" ? "warning" : "neutral"} />
              {h.id === activeId ? <Ionicons name="checkmark-circle" size={20} color={colors.brand} /> : null}
            </Row>
          </Pressable>
        ))}
        <Btn title="Add New Hostel" icon="add" onPress={() => { setOpen(false); setAddOpen(true); }} testID="add-hostel" />
      </Sheet>

      <HostelFormSheet
        visible={addOpen}
        onClose={() => setAddOpen(false)}
        initial={null}
        onSaved={async () => {
          setAddOpen(false);
          const list = await refresh();
          if (list.length) setActive(list[list.length - 1].id);
        }}
      />
    </>
  );
}

const styles = {
  pill: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
    backgroundColor: colors.brandSecondary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    alignSelf: "flex-start" as const,
  },
  row: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
};
