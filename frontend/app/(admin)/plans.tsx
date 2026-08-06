import { useCallback, useState } from "react";
import { View, ScrollView, Pressable } from "react-native";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen, AppHeader, T, Card, Row, Badge, LoadingView, Sheet, Btn, Field } from "@/src/components/ui";
import { api } from "@/src/api/client";
import { useToast } from "@/src/components/Toast";
import { colors, spacing, type, radius } from "@/src/theme";

export default function AdminPlans() {
  const toast = useToast();
  const [plans, setPlans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<any>(null);
  const [name, setName] = useState("");
  const [months, setMonths] = useState("");
  const [price, setPrice] = useState("");
  const [features, setFeatures] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const { plans } = await api.get<{ plans: any[] }>("/plans");
      setPlans(plans);
    } catch {
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openNew = () => {
    setEditing({});
    setName(""); setMonths(""); setPrice(""); setFeatures("");
  };
  const openEdit = (p: any) => {
    setEditing(p);
    setName(p.name); setMonths(String(p.duration_months)); setPrice(String(p.price));
    setFeatures((p.features || []).join(", "));
  };

  const save = async () => {
    if (!name || !months || !price) {
      toast.show("Fill name, duration and price", "error");
      return;
    }
    setSaving(true);
    const body = {
      name,
      duration_months: parseInt(months) || 1,
      price: parseFloat(price) || 0,
      features: features.split(",").map((f) => f.trim()).filter(Boolean),
      active: editing?.active ?? true,
    };
    try {
      if (editing?.id) await api.put(`/admin/plans/${editing.id}`, body);
      else await api.post("/admin/plans", body);
      toast.show("Plan saved");
      setEditing(null);
      load();
    } catch (e: any) {
      toast.show(e.message, "error");
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (p: any) => {
    try {
      await api.post(`/admin/plans/${p.id}/toggle`);
      load();
    } catch (e: any) {
      toast.show(e.message, "error");
    }
  };

  if (loading) return <Screen><LoadingView /></Screen>;

  return (
    <Screen edges={["top"]}>
      <AppHeader
        title="Subscription Plans"
        subtitle="Manage owner premium plans"
        right={
          <Pressable testID="add-plan" onPress={openNew} hitSlop={10} style={{ width: 36, height: 36, borderRadius: radius.pill, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="add" size={22} color="#fff" />
          </Pressable>
        }
      />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing["3xl"] }}>
        {plans.map((p) => (
          <Card key={p.id} testID={`plan-${p.id}`} style={{ gap: spacing.sm }}>
            <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
              <View style={{ flex: 1 }}>
                <T weight="extrabold" size={type.lg}>{p.name}</T>
                <T size={type.sm} color={colors.onSurfaceSecondary}>{p.duration_months} month{p.duration_months > 1 ? "s" : ""}</T>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <T weight="extrabold" size={type.xl} color={colors.brand}>${p.price}</T>
                <Badge label={p.active ? "Active" : "Inactive"} tone={p.active ? "success" : "neutral"} />
              </View>
            </Row>
            {p.features?.length ? (
              <View style={{ gap: 4 }}>
                {p.features.map((f: string, i: number) => (
                  <Row key={i} style={{ gap: 6 }}>
                    <Ionicons name="checkmark-circle" size={14} color={colors.brand} />
                    <T size={type.sm} color={colors.onSurfaceSecondary}>{f}</T>
                  </Row>
                ))}
              </View>
            ) : null}
            <Row style={{ gap: spacing.sm, marginTop: spacing.xs }}>
              <View style={{ flex: 1 }}>
                <Btn title="Edit" variant="secondary" icon="create" onPress={() => openEdit(p)} testID={`edit-plan-${p.id}`} />
              </View>
              <View style={{ flex: 1 }}>
                <Btn title={p.active ? "Deactivate" : "Activate"} variant="ghost" onPress={() => toggle(p)} testID={`toggle-plan-${p.id}`} />
              </View>
            </Row>
          </Card>
        ))}
      </ScrollView>

      <Sheet visible={!!editing} onClose={() => setEditing(null)} title={editing?.id ? "Edit Plan" : "New Plan"}>
        <Field label="Plan name" value={name} onChangeText={setName} placeholder="e.g. Monthly Plan" autoCapitalize="words" testID="plan-name" />
        <Field label="Duration (months)" value={months} onChangeText={setMonths} placeholder="1" keyboardType="numeric" testID="plan-months" />
        <Field label="Price (USD)" value={price} onChangeText={setPrice} placeholder="19.99" keyboardType="numeric" testID="plan-price" />
        <Field label="Features (comma separated)" value={features} onChangeText={setFeatures} placeholder="Verified badge, Priority support" multiline testID="plan-features" />
        <Btn title="Save Plan" onPress={save} loading={saving} testID="plan-save" />
      </Sheet>
    </Screen>
  );
}
