import { useCallback, useState } from "react";
import { View, ScrollView, Pressable } from "react-native";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen, AppHeader, T, Card, Row, Badge, LoadingView, Sheet, Btn, Field } from "@/src/components/ui";
import { api } from "@/src/api/client";
import { useToast } from "@/src/components/Toast";
import { colors, spacing, type, radius } from "@/src/theme";

export default function TenantSupport() {
  const toast = useToast();
  const [complaints, setComplaints] = useState<any[]>([]);
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api.get<{ complaints: any[]; requests: any[] }>("/tenant/complaints");
      setComplaints(d.complaints);
      setRequests(d.requests);
    } catch {
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const raise = async () => {
    if (!title || !body) { toast.show("Enter subject and details", "error"); return; }
    setSaving(true);
    try {
      await api.post("/tenant/complaints", { title, body });
      toast.show("Complaint raised");
      setOpen(false); setTitle(""); setBody("");
      load();
    } catch (e: any) { toast.show(e.message, "error"); }
    finally { setSaving(false); }
  };

  const request = async (type: "room_change" | "checkout") => {
    try {
      await api.post("/tenant/requests", { type, note: "" });
      toast.show(type === "checkout" ? "Checkout requested" : "Room change requested");
      load();
    } catch (e: any) { toast.show(e.message, "error"); }
  };

  if (loading) return <Screen><LoadingView /></Screen>;

  return (
    <Screen edges={["top"]}>
      <AppHeader
        title="Support"
        subtitle="Complaints & requests"
        right={
          <Pressable testID="add-complaint" onPress={() => setOpen(true)} hitSlop={10} style={{ width: 36, height: 36, borderRadius: radius.pill, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="add" size={22} color="#fff" />
          </Pressable>
        }
      />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing["3xl"] }}>
        <Row style={{ gap: spacing.md }}>
          <Pressable testID="req-room-change" onPress={() => request("room_change")} style={{ flex: 1 }}>
            <Card style={{ alignItems: "center", gap: 6, paddingVertical: spacing.lg }}>
              <Ionicons name="swap-horizontal" size={24} color={colors.brand} />
              <T weight="semibold" size={type.sm}>Request Room Change</T>
            </Card>
          </Pressable>
          <Pressable testID="req-checkout" onPress={() => request("checkout")} style={{ flex: 1 }}>
            <Card style={{ alignItems: "center", gap: 6, paddingVertical: spacing.lg }}>
              <Ionicons name="exit" size={24} color={colors.warning} />
              <T weight="semibold" size={type.sm}>Request Checkout</T>
            </Card>
          </Pressable>
        </Row>

        {requests.length ? (
          <>
            <T weight="extrabold" size={type.lg}>My Requests</T>
            {requests.map((r) => (
              <Card key={r.id} style={{ gap: 2 }}>
                <Row style={{ justifyContent: "space-between" }}>
                  <T weight="bold" style={{ textTransform: "capitalize" }}>{r.type.replace("_", " ")}</T>
                  <Badge label={r.status} tone={r.status === "resolved" ? "success" : "info"} />
                </Row>
              </Card>
            ))}
          </>
        ) : null}

        <T weight="extrabold" size={type.lg}>My Complaints</T>
        {complaints.length === 0 ? (
          <Card><T color={colors.onSurfaceSecondary}>No complaints raised yet. Tap + to raise one.</T></Card>
        ) : (
          complaints.map((c) => (
            <Card key={c.id} testID={`complaint-${c.id}`} style={{ gap: 4 }}>
              <Row style={{ justifyContent: "space-between" }}>
                <T weight="bold">{c.title}</T>
                <Badge label={c.status} tone={c.status === "resolved" ? "success" : "warning"} />
              </Row>
              <T size={type.sm} color={colors.onSurfaceSecondary}>{c.body}</T>
            </Card>
          ))
        )}
      </ScrollView>

      <Sheet visible={open} onClose={() => setOpen(false)} title="Raise a Complaint">
        <Field label="Subject" value={title} onChangeText={setTitle} placeholder="e.g. Water leakage" autoCapitalize="sentences" testID="complaint-title" />
        <Field label="Details" value={body} onChangeText={setBody} placeholder="Describe the issue..." multiline autoCapitalize="sentences" testID="complaint-body" />
        <Btn title="Submit Complaint" onPress={raise} loading={saving} testID="complaint-submit" />
      </Sheet>
    </Screen>
  );
}
