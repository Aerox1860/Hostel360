import { useCallback, useState, useEffect } from "react";
import { View, ScrollView, Pressable, Linking, Dimensions } from "react-native";
import { Image } from "expo-image";
import { useLocalSearchParams, router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen, T, Btn, Badge, Card, Row, LoadingView, Sheet, Field } from "@/src/components/ui";
import { api } from "@/src/api/client";
import { useToast } from "@/src/components/Toast";
import { colors, spacing, radius, type, shadow } from "@/src/theme";

const AMENITY_ICON: Record<string, any> = {
  "Wi-Fi": "wifi",
  Food: "restaurant",
  Parking: "car",
  Laundry: "shirt",
  CCTV: "videocam",
  AC: "snow",
};
const W = Dimensions.get("window").width;

export default function HostelDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const toast = useToast();
  const [hostel, setHostel] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [enquiryOpen, setEnquiryOpen] = useState(false);
  const [enqType, setEnqType] = useState<"enquiry" | "site_visit" | "callback">("enquiry");
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [message, setMessage] = useState("");
  const [visitDate, setVisitDate] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    try {
      const { hostel } = await api.get<{ hostel: any }>(`/public/hostels/${id}`);
      setHostel(hostel);
    } catch {
      toast.show("Could not load hostel", "error");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const openEnquiry = (t: "enquiry" | "site_visit" | "callback") => {
    setEnqType(t);
    setEnquiryOpen(true);
  };

  const submitEnquiry = async () => {
    if (!name || !mobile) {
      toast.show("Enter your name and mobile", "error");
      return;
    }
    setSubmitting(true);
    try {
      await api.post("/public/enquiry", {
        hostel_id: id,
        name,
        mobile,
        type: enqType,
        message,
        visit_date: visitDate,
      });
      setEnquiryOpen(false);
      setName(""); setMobile(""); setMessage(""); setVisitDate("");
      toast.show("Request sent! The owner will contact you soon.");
    } catch (e: any) {
      toast.show(e.message || "Failed to send", "error");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <Screen bg={colors.surface}><LoadingView /></Screen>;
  if (!hostel) return <Screen bg={colors.surface}><LoadingView label="Not found" /></Screen>;

  const photos: string[] = hostel.photos?.length ? hostel.photos : [];
  const enqTitle = { enquiry: "Send Enquiry", site_visit: "Book a Site Visit", callback: "Request Callback" }[enqType];

  return (
    <Screen edges={[]} bg={colors.surface}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }}>
        <View>
          <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} style={{ height: 300 }}>
            {photos.map((p, i) => (
              <Image key={i} source={{ uri: p }} style={{ width: W, height: 300 }} contentFit="cover" transition={200} />
            ))}
            {photos.length === 0 ? <View style={{ width: W, height: 300, backgroundColor: colors.surfaceTertiary }} /> : null}
          </ScrollView>
          <Pressable testID="detail-back" onPress={() => router.back()} style={styles.floatBack}>
            <Ionicons name="chevron-back" size={24} color={colors.onSurface} />
          </Pressable>
          {hostel.verification_status === "verified" ? (
            <View style={styles.verified}>
              <Ionicons name="shield-checkmark" size={14} color="#fff" />
              <T size={12} weight="bold" color="#fff">Admin Verified</T>
            </View>
          ) : null}
        </View>

        <View style={{ padding: spacing.lg, gap: spacing.lg }}>
          <View style={{ gap: 4 }}>
            <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
              <View style={{ flex: 1 }}>
                <T weight="extrabold" size={type["2xl"]}>{hostel.name}</T>
                <Row style={{ gap: 4, marginTop: 4 }}>
                  <Ionicons name="location" size={14} color={colors.onSurfaceSecondary} />
                  <T color={colors.onSurfaceSecondary}>{hostel.address}</T>
                </Row>
              </View>
              {hostel.rating ? (
                <View style={styles.ratingPill}>
                  <Ionicons name="star" size={14} color={colors.warning} />
                  <T weight="bold">{hostel.rating}</T>
                </View>
              ) : null}
            </Row>
          </View>

          <Row style={{ gap: spacing.sm, flexWrap: "wrap" }}>
            <Badge label={hostel.pg_name || "PG"} tone="brand" />
            {hostel.available_beds != null ? <Badge label={`${hostel.available_beds} beds available`} tone="success" /> : null}
          </Row>

          {/* Room options */}
          {hostel.room_options?.length ? (
            <View style={{ gap: spacing.sm }}>
              <T weight="bold" size={type.lg}>Room Types</T>
              {hostel.room_options.map((r: any, i: number) => (
                <Card key={i} style={{ padding: spacing.md }}>
                  <Row style={{ justifyContent: "space-between" }}>
                    <Row style={{ gap: spacing.sm }}>
                      <Ionicons name="bed-outline" size={18} color={colors.brand} />
                      <T weight="semibold" style={{ textTransform: "capitalize" }}>{r.room_type} Sharing</T>
                    </Row>
                    <T weight="extrabold" color={colors.brand}>₹{r.rent}/mo</T>
                  </Row>
                </Card>
              ))}
            </View>
          ) : null}

          {/* Amenities */}
          {hostel.amenities?.length ? (
            <View style={{ gap: spacing.sm }}>
              <T weight="bold" size={type.lg}>Amenities</T>
              <Row style={{ flexWrap: "wrap", gap: spacing.sm }}>
                {hostel.amenities.map((a: string) => (
                  <View key={a} style={styles.amenity}>
                    <Ionicons name={AMENITY_ICON[a] || "checkmark-circle"} size={16} color={colors.brand} />
                    <T size={type.sm} weight="medium">{a}</T>
                  </View>
                ))}
              </Row>
            </View>
          ) : null}

          {/* Reviews */}
          <View style={{ gap: spacing.sm }}>
            <T weight="bold" size={type.lg}>Ratings & Reviews</T>
            {hostel.reviews?.length ? (
              hostel.reviews.map((rv: any) => (
                <Card key={rv.id} style={{ padding: spacing.md, gap: 4 }}>
                  <Row style={{ justifyContent: "space-between" }}>
                    <T weight="bold">{rv.name || "Guest"}</T>
                    <Row style={{ gap: 2 }}>
                      {[1, 2, 3, 4, 5].map((s) => (
                        <Ionicons key={s} name={s <= rv.rating ? "star" : "star-outline"} size={13} color={colors.warning} />
                      ))}
                    </Row>
                  </Row>
                  {rv.comment ? <T size={type.sm} color={colors.onSurfaceSecondary}>{rv.comment}</T> : null}
                </Card>
              ))
            ) : (
              <T color={colors.onSurfaceSecondary}>No reviews yet.</T>
            )}
          </View>

          {/* Contact actions */}
          <View style={{ gap: spacing.sm }}>
            <Row style={{ gap: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Btn title="Call" icon="call" variant="secondary" onPress={() => Linking.openURL(`tel:${hostel.mobile}`)} testID="btn-call" />
              </View>
              <View style={{ flex: 1 }}>
                <Btn title="Site Visit" icon="calendar" variant="secondary" onPress={() => openEnquiry("site_visit")} testID="btn-sitevisit" />
              </View>
            </Row>
            <Btn title="Request Callback" icon="chatbubble-ellipses" variant="ghost" onPress={() => openEnquiry("callback")} testID="btn-callback" />
          </View>
        </View>
      </ScrollView>

      {/* Sticky enquiry CTA */}
      <View style={styles.stickyBar}>
        <Btn title="Send Enquiry" icon="paper-plane" onPress={() => openEnquiry("enquiry")} testID="btn-enquiry" />
      </View>

      <Sheet visible={enquiryOpen} onClose={() => setEnquiryOpen(false)} title={enqTitle}>
        <Field label="Your name" value={name} onChangeText={setName} placeholder="Full name" autoCapitalize="words" testID="enq-name" />
        <Field label="Mobile number" value={mobile} onChangeText={setMobile} placeholder="10-digit mobile" keyboardType="phone-pad" testID="enq-mobile" />
        {enqType === "site_visit" ? (
          <Field label="Preferred date" value={visitDate} onChangeText={setVisitDate} placeholder="e.g. 25 Jun, evening" testID="enq-date" />
        ) : null}
        {enqType === "enquiry" ? (
          <Field label="Message" value={message} onChangeText={setMessage} placeholder="Ask about availability, food, rules..." multiline testID="enq-message" />
        ) : null}
        <Btn title={enqTitle} onPress={submitEnquiry} loading={submitting} testID="enq-submit" />
      </Sheet>
    </Screen>
  );
}

const styles = {
  floatBack: {
    position: "absolute" as const,
    top: 44,
    left: spacing.lg,
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: "rgba(255,255,255,0.94)",
    alignItems: "center" as const,
    justifyContent: "center" as const,
    ...shadow.card,
  },
  verified: {
    position: "absolute" as const,
    top: 48,
    right: spacing.lg,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    backgroundColor: colors.brand,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  ratingPill: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    backgroundColor: colors.surfaceSecondary,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.md,
  },
  amenity: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
    backgroundColor: colors.brandTertiary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  stickyBar: {
    position: "absolute" as const,
    left: 0,
    right: 0,
    bottom: 0,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
    backgroundColor: colors.surface,
    borderTopColor: colors.divider,
    borderTopWidth: 1,
  },
};
