import { useState, useEffect } from "react";
import { View } from "react-native";
import { Sheet, Field, Btn, Chip, T, Row } from "@/src/components/ui";
import { api } from "@/src/api/client";
import { useToast } from "@/src/components/Toast";
import { colors, spacing, type } from "@/src/theme";

const GENDERS = [
  { k: "pg", label: "PG" },
  { k: "boys", label: "Boys" },
  { k: "girls", label: "Girls" },
  { k: "co-living", label: "Co-Living" },
];
const AMENITIES = ["Wi-Fi", "Food", "Parking", "Laundry", "CCTV", "AC", "Gym", "Power Backup"];

export function HostelFormSheet({
  visible,
  onClose,
  initial,
  onSaved,
}: {
  visible: boolean;
  onClose: () => void;
  initial: any;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(initial?.name || "");
  const [pgName, setPgName] = useState(initial?.pg_name || "");
  const [ownerName, setOwnerName] = useState(initial?.owner_name || "");
  const [mobile, setMobile] = useState(initial?.mobile || "");
  const [address, setAddress] = useState(initial?.address || "");
  const [city, setCity] = useState(initial?.city || "");
  const [state, setState] = useState(initial?.state || "");
  const [area, setArea] = useState(initial?.area || "");
  const [gmap, setGmap] = useState(initial?.google_location || "");
  const [gender, setGender] = useState(initial?.gender || "pg");
  const [amenities, setAmenities] = useState<string[]>(initial?.amenities || ["Wi-Fi", "Food"]);
  const [saving, setSaving] = useState(false);

  const toggleAmenity = (a: string) =>
    setAmenities((p) => (p.includes(a) ? p.filter((x) => x !== a) : [...p, a]));

  useEffect(() => {
    if (visible) {
      setName(initial?.name || "");
      setPgName(initial?.pg_name || "");
      setOwnerName(initial?.owner_name || "");
      setMobile(initial?.mobile || "");
      setAddress(initial?.address || "");
      setCity(initial?.city || "");
      setState(initial?.state || "");
      setArea(initial?.area || "");
      setGmap(initial?.google_location || "");
      setGender(initial?.gender || "pg");
      setAmenities(initial?.amenities || ["Wi-Fi", "Food"]);
    }
  }, [visible, initial]);

  const save = async () => {
    if (!name || !ownerName || !mobile || !address || !city || !state) {
      toast.show("Fill all required fields", "error");
      return;
    }
    setSaving(true);
    try {
      if (initial?.id) {
        await api.put(`/owner/hostel/${initial.id}`, {
          name, pg_name: pgName, owner_name: ownerName, mobile, address, city, state,
          area, google_location: gmap, gender, amenities, photos: initial?.photos || [],
          sharing_types: initial?.sharing_types || [],
        });
      } else {
        await api.post("/owner/hostel", {
          name, pg_name: pgName, owner_name: ownerName, mobile, address, city, state,
          area, google_location: gmap, gender, amenities, photos: [], sharing_types: [],
        });
      }
      toast.show(initial?.id ? "Hostel updated" : "Hostel submitted for verification");
      onSaved();
    } catch (e: any) {
      toast.show(e.message, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={initial ? "Edit Hostel" : "Add Your Hostel"}>
      <Field label="Hostel name *" value={name} onChangeText={setName} placeholder="Green Nest Co-Living" autoCapitalize="words" testID="h-name" />
      <Field label="PG / Brand name" value={pgName} onChangeText={setPgName} placeholder="Green Nest PG" autoCapitalize="words" testID="h-pg" />
      <Field label="Owner name *" value={ownerName} onChangeText={setOwnerName} placeholder="Your name" autoCapitalize="words" testID="h-owner" />
      <Field label="Mobile number *" value={mobile} onChangeText={setMobile} placeholder="10-digit mobile" keyboardType="phone-pad" testID="h-mobile" />
      <Field label="Full address *" value={address} onChangeText={setAddress} placeholder="Street, landmark" autoCapitalize="sentences" testID="h-address" />
      <Row style={{ gap: spacing.sm }}>
        <View style={{ flex: 1 }}><Field label="City *" value={city} onChangeText={setCity} placeholder="City" autoCapitalize="words" testID="h-city" /></View>
        <View style={{ flex: 1 }}><Field label="State *" value={state} onChangeText={setState} placeholder="State" autoCapitalize="words" testID="h-state" /></View>
      </Row>
      <Field label="Area / Locality" value={area} onChangeText={setArea} placeholder="e.g. Indiranagar" autoCapitalize="words" testID="h-area" />
      <Field label="Google Maps location (lat,lng)" value={gmap} onChangeText={setGmap} placeholder="12.97, 77.64" testID="h-gmap" />

      <T size={type.sm} weight="semibold" color={colors.onSurfaceSecondary}>Hostel type</T>
      <Row style={{ gap: spacing.sm, flexWrap: "wrap" }}>
        {GENDERS.map((g) => (
          <Chip key={g.k} label={g.label} active={gender === g.k} onPress={() => setGender(g.k)} testID={`h-gender-${g.k}`} />
        ))}
      </Row>

      <T size={type.sm} weight="semibold" color={colors.onSurfaceSecondary}>Amenities</T>
      <Row style={{ gap: spacing.sm, flexWrap: "wrap" }}>
        {AMENITIES.map((a) => (
          <Chip key={a} label={a} active={amenities.includes(a)} onPress={() => toggleAmenity(a)} testID={`h-amenity-${a}`} />
        ))}
      </Row>

      <Btn title={initial ? "Save Changes" : "Submit for Verification"} onPress={save} loading={saving} testID="h-save" />
    </Sheet>
  );
}
