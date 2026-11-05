import { useCallback, useRef, useState } from "react";
import { View, FlatList, Pressable } from "react-native";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen, AppHeader, T, Card, Row, Badge, LoadingView, EmptyState, Sheet, Btn, Field } from "@/src/components/ui";
import { useOwnerHostel } from "@/src/context/OwnerHostelContext";
import { api } from "@/src/api/client";
import { useToast } from "@/src/components/Toast";
import { colors, spacing, type, radius } from "@/src/theme";

const BED_COUNT_OPTIONS = [1, 2, 3, 4, 5, 6, 7];
const BED_PILL_COLORS = [
  { background: "#E3ECE5", foreground: "#1D402A" },
  { background: "#E0F2FE", foreground: "#075985" },
  { background: "#FEF3C7", foreground: "#92400E" },
  { background: "#FCE7F3", foreground: "#9D174D" },
  { background: "#EDE9FE", foreground: "#5B21B6" },
  { background: "#CCFBF1", foreground: "#115E59" },
  { background: "#FFEDD5", foreground: "#9A3412" },
];

export default function Rooms() {
  const { show } = useToast();
  const { activeId, activeHostel } = useOwnerHostel();
  const [rooms, setRooms] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [floor, setFloor] = useState("");
  const [roomNo, setRoomNo] = useState("");
  const [rent, setRent] = useState("");
  const [beds, setBeds] = useState("2");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const savingRef = useRef(false);
  const deletingRef = useRef(false);

  const load = useCallback(async () => {
    if (!activeId) {
      setRooms([]);
      setLoading(false);
      return;
    }
    try {
      const { rooms } = await api.get<{ rooms: any[] }>(`/owner/rooms?hostel_id=${activeId}`);
      setRooms(rooms);
    } catch (e: any) {
      show(e?.message || "Could not load rooms", "error");
    } finally {
      setLoading(false);
    }
  }, [activeId, show]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const save = async () => {
    if (savingRef.current) return;
    if (!floor.trim() || !roomNo.trim() || !rent) {
      show("Fill floor, room number and rent", "error");
      return;
    }
    if (!/^[1-7]$/.test(beds)) {
      show("Beds must be a whole number from 1 to 7", "error");
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      await api.post("/owner/rooms", {
        hostel_id: activeId,
        floor: floor.trim(), room_number: roomNo.trim(),
        rent: parseInt(rent) || 0, bed_count: Number(beds),
      });
      show("Room added");
      setOpen(false);
      setFloor(""); setRoomNo(""); setRent(""); setBeds("2");
      await load();
    } catch (e: any) {
      show(e?.message || "Could not add room", "error");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const del = async (id: string) => {
    if (deletingRef.current) return;
    deletingRef.current = true;
    setDeletingId(id);
    try {
      await api.del(`/owner/rooms/${id}`);
      show("Room deleted");
      await load();
    } catch (e: any) {
      show(e?.message || "Could not delete room", "error");
    } finally {
      deletingRef.current = false;
      setDeletingId(null);
    }
  };

  if (loading) return <Screen><LoadingView /></Screen>;

  return (
    <Screen edges={["top"]}>
      <AppHeader
        title="Rooms & Beds"
        subtitle={`${activeHostel?.name || "Hostel"} · ${rooms.length} rooms · ${rooms.reduce((total, room) => total + (room.beds?.length || 0), 0)} beds`}
        right={
          <Pressable testID="add-room" onPress={() => setOpen(true)} hitSlop={10} style={{ width: 36, height: 36, borderRadius: radius.pill, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="add" size={22} color="#fff" />
          </Pressable>
        }
      />
      <FlatList
        data={rooms}
        keyExtractor={(r) => r.id}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}
        ListEmptyComponent={<View style={{ flex: 1 }}><EmptyState icon="bed-outline" title="No rooms yet" subtitle="Add rooms and beds to start allocating tenants." ctaLabel="Add Room" onCta={() => setOpen(true)} /></View>}
        renderItem={({ item }) => {
          const roomBeds = item.beds || [];
          const occ = roomBeds.filter((b: any) => b.status === "occupied").length;
          return (
            <Card testID={`room-${item.id}`} style={{ gap: spacing.sm }}>
              <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                <View>
                  <T weight="extrabold" size={type.lg}>Room {item.room_number}</T>
                  <T size={type.sm} color={colors.onSurfaceSecondary}>Floor {item.floor} · {item.bed_count ?? roomBeds.length} beds</T>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <T weight="extrabold" color={colors.brand}>₹{item.rent}</T>
                  <Badge label={`${occ}/${roomBeds.length} filled`} tone={occ === roomBeds.length ? "error" : "success"} />
                </View>
              </Row>
              <Row style={{ gap: spacing.sm, flexWrap: "wrap" }}>
                {roomBeds.map((b: any) => (
                  <View key={b.bed_number} style={[styles.bed, { backgroundColor: b.status === "occupied" ? colors.brandSecondary : colors.surfaceSecondary }]}>
                    <Ionicons name={b.status === "occupied" ? "person" : "bed"} size={14} color={b.status === "occupied" ? colors.brand : colors.onSurfaceTertiary} />
                    <T size={12} weight="semibold" color={b.status === "occupied" ? colors.brand : colors.onSurfaceTertiary}>{b.bed_number}</T>
                  </View>
                ))}
              </Row>
              {occ === 0 && !roomBeds.some((b: any) => b.tenant_id) ? (
                <Pressable testID={`del-room-${item.id}`} onPress={() => del(item.id)} disabled={deletingId !== null} style={{ alignSelf: "flex-start" }}>
                  <Row style={{ gap: 4 }}>
                    <Ionicons name="trash" size={14} color={colors.error} />
                    <T size={type.sm} weight="semibold" color={colors.error}>Delete room</T>
                  </Row>
                </Pressable>
              ) : null}
            </Card>
          );
        }}
      />

      <Sheet visible={open} onClose={() => setOpen(false)} title="Add Room" centered>
        <Row style={{ gap: spacing.sm }}>
          <View style={{ flex: 1 }}><Field label="Floor" value={floor} onChangeText={setFloor} placeholder="1" testID="room-floor" /></View>
          <View style={{ flex: 1 }}><Field label="Room number" value={roomNo} onChangeText={setRoomNo} placeholder="101" testID="room-number" /></View>
        </Row>
        <T size={type.sm} weight="semibold" color={colors.onSurfaceSecondary}>Number of Beds</T>
        <Row style={{ gap: spacing.sm, flexWrap: "wrap" }}>
          {BED_COUNT_OPTIONS.map((count, index) => {
            const selected = beds === String(count);
            const pillColor = BED_PILL_COLORS[index];
            return (
              <Pressable
                key={count}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                testID={`room-bed-count-${count}`}
                onPress={() => setBeds(String(count))}
                style={[
                  styles.bedCountPill,
                  {
                    backgroundColor: selected ? colors.brand : pillColor.background,
                    borderColor: selected ? colors.brand : "transparent",
                  },
                ]}
              >
                <T size={type.base} weight="bold" color={selected ? "#FFFFFF" : pillColor.foreground}>
                  {count}
                </T>
              </Pressable>
            );
          })}
        </Row>
        <Row style={{ gap: spacing.sm }}>
          <View style={{ flex: 1 }}><Field label="Monthly rent (₹)" value={rent} onChangeText={setRent} placeholder="7000" keyboardType="numeric" testID="room-rent" /></View>
        </Row>
        <Btn title="Add Room" onPress={save} loading={saving} testID="room-save" />
      </Sheet>
    </Screen>
  );
}

const styles = {
  bedCountPill: {
    width: 42,
    height: 42,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  bed: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.sm,
  },
};
