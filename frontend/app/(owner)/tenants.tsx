import { useCallback, useState } from "react";
import { View, FlatList, Pressable } from "react-native";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen, AppHeader, T, Card, Row, Badge, LoadingView, EmptyState, Sheet, Btn, Field, Chip } from "@/src/components/ui";
import { api } from "@/src/api/client";
import { useToast } from "@/src/components/Toast";
import { colors, spacing, type, radius } from "@/src/theme";

export default function Tenants() {
  const toast = useToast();
  const [tenants, setTenants] = useState<any[]>([]);
  const [rooms, setRooms] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [manage, setManage] = useState<any>(null);
  const [transferOpen, setTransferOpen] = useState<any>(null);

  // add form
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [email, setEmail] = useState("");
  const [rent, setRent] = useState("");
  const [deposit, setDeposit] = useState("");
  const [advance, setAdvance] = useState("");
  const [roomId, setRoomId] = useState("");
  const [bed, setBed] = useState("");
  const [createLogin, setCreateLogin] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const t = await api.get<{ tenants: any[] }>("/owner/tenants");
      const r = await api.get<{ rooms: any[] }>("/owner/rooms");
      setTenants(t.tenants);
      setRooms(r.rooms);
    } catch {
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const availableRooms = rooms.filter((r) => r.beds.some((b: any) => b.status === "available"));
  const selectedRoom = rooms.find((r) => r.id === roomId);

  const pickRoom = (r: any) => {
    setRoomId(r.id);
    setBed("");
    if (!rent) setRent(String(r.rent));
  };

  const resetForm = () => {
    setName(""); setMobile(""); setEmail(""); setRent(""); setDeposit(""); setAdvance("");
    setRoomId(""); setBed(""); setCreateLogin(false);
  };

  const save = async () => {
    if (!name || !mobile || !roomId || !bed || !rent) {
      toast.show("Fill name, mobile, room, bed and rent", "error");
      return;
    }
    setSaving(true);
    try {
      const res = await api.post<{ login_password?: string }>("/owner/tenants", {
        name, mobile, email: email || undefined, room_id: roomId, bed_number: bed,
        joining_date: new Date().toISOString(), monthly_rent: parseInt(rent) || 0,
        security_deposit: parseInt(deposit) || 0, advance_amount: parseInt(advance) || 0,
        create_login: createLogin && !!email, password: createLogin ? "Tenant@12345" : undefined,
      });
      toast.show(createLogin && email ? "Tenant added. Login password: Tenant@12345" : "Tenant added");
      setAddOpen(false);
      resetForm();
      load();
    } catch (e: any) {
      toast.show(e.message, "error");
    } finally {
      setSaving(false);
    }
  };

  const checkout = async (id: string) => {
    try {
      await api.post(`/owner/tenants/${id}/checkout`);
      toast.show("Tenant checked out");
      setManage(null);
      load();
    } catch (e: any) { toast.show(e.message, "error"); }
  };
  const del = async (id: string) => {
    try {
      await api.del(`/owner/tenants/${id}`);
      toast.show("Tenant removed");
      setManage(null);
      load();
    } catch (e: any) { toast.show(e.message, "error"); }
  };
  const doTransfer = async (rid: string, bn: string) => {
    try {
      await api.post(`/owner/tenants/${transferOpen.id}/transfer`, { room_id: rid, bed_number: bn });
      toast.show("Tenant transferred");
      setTransferOpen(null);
      setManage(null);
      load();
    } catch (e: any) { toast.show(e.message, "error"); }
  };

  if (loading) return <Screen><LoadingView /></Screen>;

  return (
    <Screen edges={["top"]}>
      <AppHeader
        title="Tenants"
        subtitle={`${tenants.filter((t) => t.active).length} active`}
        right={
          <Pressable testID="add-tenant" onPress={() => setAddOpen(true)} hitSlop={10} style={{ width: 36, height: 36, borderRadius: radius.pill, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="person-add" size={18} color="#fff" />
          </Pressable>
        }
      />
      <FlatList
        data={tenants}
        keyExtractor={(t) => t.id}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}
        ListEmptyComponent={<View style={{ flex: 1 }}><EmptyState icon="people-outline" title="No tenants yet" subtitle="Add tenants and allocate them to beds." ctaLabel="Add Tenant" onCta={() => setAddOpen(true)} /></View>}
        renderItem={({ item }) => (
          <Card testID={`tenant-${item.id}`} style={{ gap: spacing.sm, opacity: item.active ? 1 : 0.6 }}>
            <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
              <View style={{ flex: 1 }}>
                <T weight="bold" size={type.lg}>{item.name}</T>
                <T size={type.sm} color={colors.onSurfaceSecondary}>{item.tenant_code} · {item.mobile}</T>
                <Row style={{ gap: 4, marginTop: 2 }}>
                  <Ionicons name="bed" size={13} color={colors.brand} />
                  <T size={type.sm} color={colors.onSurfaceSecondary}>Room {item.room_number} · Bed {item.bed_number}</T>
                </Row>
              </View>
              <View style={{ alignItems: "flex-end", gap: 4 }}>
                <T weight="extrabold" color={colors.brand}>₹{item.monthly_rent}</T>
                {item.active ? (
                  <Badge label={item.payment_status === "paid" ? "Paid" : "Rent Due"} tone={item.payment_status === "paid" ? "success" : "warning"} />
                ) : (
                  <Badge label="Checked out" tone="neutral" />
                )}
              </View>
            </Row>
            {item.active ? (
              <Btn title="Manage" variant="secondary" icon="settings" onPress={() => setManage(item)} testID={`manage-tenant-${item.id}`} />
            ) : (
              <Pressable testID={`del-tenant-${item.id}`} onPress={() => del(item.id)}>
                <T size={type.sm} weight="semibold" color={colors.error} style={{ textAlign: "center" }}>Delete record</T>
              </Pressable>
            )}
          </Card>
        )}
      />

      {/* Add tenant */}
      <Sheet visible={addOpen} onClose={() => setAddOpen(false)} title="Add Tenant">
        <Field label="Full name *" value={name} onChangeText={setName} placeholder="Tenant name" autoCapitalize="words" testID="t-name" />
        <Field label="Mobile *" value={mobile} onChangeText={setMobile} placeholder="10-digit mobile" keyboardType="phone-pad" testID="t-mobile" />
        <Field label="Email (for login)" value={email} onChangeText={setEmail} placeholder="tenant@email.com" keyboardType="email-address" testID="t-email" />

        <T size={type.sm} weight="semibold" color={colors.onSurfaceSecondary}>Select room *</T>
        {availableRooms.length === 0 ? (
          <T size={type.sm} color={colors.error}>No rooms with available beds. Add a room first.</T>
        ) : (
          <Row style={{ gap: spacing.sm, flexWrap: "wrap" }}>
            {availableRooms.map((r) => <Chip key={r.id} label={`Room ${r.room_number}`} active={roomId === r.id} onPress={() => pickRoom(r)} testID={`t-room-${r.id}`} />)}
          </Row>
        )}
        {selectedRoom ? (
          <>
            <T size={type.sm} weight="semibold" color={colors.onSurfaceSecondary}>Select bed *</T>
            <Row style={{ gap: spacing.sm, flexWrap: "wrap" }}>
              {selectedRoom.beds.filter((b: any) => b.status === "available").map((b: any) => (
                <Chip key={b.bed_number} label={b.bed_number} active={bed === b.bed_number} onPress={() => setBed(b.bed_number)} testID={`t-bed-${b.bed_number}`} />
              ))}
            </Row>
          </>
        ) : null}

        <Row style={{ gap: spacing.sm }}>
          <View style={{ flex: 1 }}><Field label="Rent (₹) *" value={rent} onChangeText={setRent} placeholder="7000" keyboardType="numeric" testID="t-rent" /></View>
          <View style={{ flex: 1 }}><Field label="Deposit (₹)" value={deposit} onChangeText={setDeposit} placeholder="14000" keyboardType="numeric" testID="t-deposit" /></View>
        </Row>
        <Field label="Advance (₹)" value={advance} onChangeText={setAdvance} placeholder="0" keyboardType="numeric" testID="t-advance" />

        <Pressable testID="t-login-toggle" onPress={() => setCreateLogin((v) => !v)}>
          <Row style={{ gap: spacing.sm }}>
            <Ionicons name={createLogin ? "checkbox" : "square-outline"} size={22} color={colors.brand} />
            <T style={{ flex: 1 }}>Create tenant login (password: Tenant@12345)</T>
          </Row>
        </Pressable>

        <Btn title="Add Tenant" onPress={save} loading={saving} testID="t-save" />
      </Sheet>

      {/* Manage tenant */}
      <Sheet visible={!!manage} onClose={() => setManage(null)} title={manage?.name}>
        <T color={colors.onSurfaceSecondary}>Room {manage?.room_number} · Bed {manage?.bed_number}</T>
        <Btn title="Transfer Room / Bed" variant="secondary" icon="swap-horizontal" onPress={() => { setTransferOpen(manage); }} testID="t-transfer-open" />
        <Btn title="Checkout Tenant" variant="secondary" icon="exit" onPress={() => checkout(manage.id)} testID="t-checkout" />
        <Btn title="Delete Tenant" variant="danger" icon="trash" onPress={() => del(manage.id)} testID="t-delete" />
      </Sheet>

      {/* Transfer */}
      <Sheet visible={!!transferOpen} onClose={() => setTransferOpen(null)} title="Transfer to">
        {rooms.filter((r) => r.beds.some((b: any) => b.status === "available")).map((r) => (
          <View key={r.id} style={{ gap: spacing.sm }}>
            <T weight="bold">Room {r.room_number} · ₹{r.rent}</T>
            <Row style={{ gap: spacing.sm, flexWrap: "wrap" }}>
              {r.beds.filter((b: any) => b.status === "available").map((b: any) => (
                <Chip key={b.bed_number} label={b.bed_number} onPress={() => doTransfer(r.id, b.bed_number)} testID={`transfer-${b.bed_number}`} />
              ))}
            </Row>
          </View>
        ))}
      </Sheet>
    </Screen>
  );
}
