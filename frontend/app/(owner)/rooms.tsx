import { useCallback, useState } from "react";
import { View, FlatList, Pressable } from "react-native";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen, AppHeader, T, Card, Row, Badge, LoadingView, EmptyState, Sheet, Btn, Field, Chip } from "@/src/components/ui";
import { api } from "@/src/api/client";
import { useToast } from "@/src/components/Toast";
import { colors, spacing, type, radius } from "@/src/theme";

const TYPES = [
  { k: "single", label: "Single", beds: 1 },
  { k: "double", label: "Double", beds: 2 },
  { k: "triple", label: "Triple", beds: 3 },
  { k: "dormitory", label: "Dorm", beds: 6 },
];

export default function Rooms() {
  const toast = useToast();
  const [rooms, setRooms] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [floor, setFloor] = useState("");
  const [roomNo, setRoomNo] = useState("");
  const [rtype, setRtype] = useState("double");
  const [rent, setRent] = useState("");
  const [beds, setBeds] = useState("2");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const { rooms } = await api.get<{ rooms: any[] }>("/owner/rooms");
      setRooms(rooms);
    } catch {
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const pickType = (t: any) => {
    setRtype(t.k);
    setBeds(String(t.beds));
  };

  const save = async () => {
    if (!floor || !roomNo || !rent) {
      toast.show("Fill floor, room number and rent", "error");
      return;
    }
    setSaving(true);
    try {
      await api.post("/owner/rooms", {
        floor, room_number: roomNo, room_type: rtype,
        rent: parseInt(rent) || 0, bed_count: parseInt(beds) || 1,
      });
      toast.show("Room added");
      setOpen(false);
      setFloor(""); setRoomNo(""); setRent(""); setBeds("2"); setRtype("double");
      load();
    } catch (e: any) {
      toast.show(e.message, "error");
    } finally {
      setSaving(false);
    }
  };

  const del = async (id: string) => {
    try {
      await api.del(`/owner/rooms/${id}`);
      toast.show("Room deleted");
      load();
    } catch (e: any) {
      toast.show(e.message, "error");
    }
  };

  if (loading) return <Screen><LoadingView /></Screen>;

  return (
    <Screen edges={["top"]}>
      <AppHeader
        title="Rooms & Beds"
        subtitle={`${rooms.length} rooms`}
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
          const occ = item.beds.filter((b: any) => b.status === "occupied").length;
          return (
            <Card testID={`room-${item.id}`} style={{ gap: spacing.sm }}>
              <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                <View>
                  <T weight="extrabold" size={type.lg}>Room {item.room_number}</T>
                  <T size={type.sm} color={colors.onSurfaceSecondary}>Floor {item.floor} · <T style={{ textTransform: "capitalize" }}>{item.room_type}</T></T>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <T weight="extrabold" color={colors.brand}>₹{item.rent}</T>
                  <Badge label={`${occ}/${item.beds.length} filled`} tone={occ === item.beds.length ? "error" : "success"} />
                </View>
              </Row>
              <Row style={{ gap: spacing.sm, flexWrap: "wrap" }}>
                {item.beds.map((b: any) => (
                  <View key={b.bed_number} style={[styles.bed, { backgroundColor: b.status === "occupied" ? colors.brandSecondary : colors.surfaceSecondary }]}>
                    <Ionicons name={b.status === "occupied" ? "person" : "bed"} size={14} color={b.status === "occupied" ? colors.brand : colors.onSurfaceTertiary} />
                    <T size={12} weight="semibold" color={b.status === "occupied" ? colors.brand : colors.onSurfaceTertiary}>{b.bed_number}</T>
                  </View>
                ))}
              </Row>
              {occ === 0 ? (
                <Pressable testID={`del-room-${item.id}`} onPress={() => del(item.id)} style={{ alignSelf: "flex-start" }}>
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

      <Sheet visible={open} onClose={() => setOpen(false)} title="Add Room">
        <Row style={{ gap: spacing.sm }}>
          <View style={{ flex: 1 }}><Field label="Floor" value={floor} onChangeText={setFloor} placeholder="1" testID="room-floor" /></View>
          <View style={{ flex: 1 }}><Field label="Room number" value={roomNo} onChangeText={setRoomNo} placeholder="101" testID="room-number" /></View>
        </Row>
        <T size={type.sm} weight="semibold" color={colors.onSurfaceSecondary}>Room type</T>
        <Row style={{ gap: spacing.sm, flexWrap: "wrap" }}>
          {TYPES.map((t) => <Chip key={t.k} label={t.label} active={rtype === t.k} onPress={() => pickType(t)} testID={`room-type-${t.k}`} />)}
        </Row>
        <Row style={{ gap: spacing.sm }}>
          <View style={{ flex: 1 }}><Field label="Monthly rent (₹)" value={rent} onChangeText={setRent} placeholder="7000" keyboardType="numeric" testID="room-rent" /></View>
          <View style={{ flex: 1 }}><Field label="Beds" value={beds} onChangeText={setBeds} placeholder="2" keyboardType="numeric" testID="room-beds" /></View>
        </Row>
        <Btn title="Add Room" onPress={save} loading={saving} testID="room-save" />
      </Sheet>
    </Screen>
  );
}

const styles = {
  bed: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.sm,
  },
};
