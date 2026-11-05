import { useCallback, useState } from "react";
import { Platform, Pressable, ScrollView, Switch, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { AdvertisementMedia, type Advertisement } from "@/src/components/AdvertisementSlot";
import { api } from "@/src/api/client";
import { normalizeAdMediaUri } from "@/src/utils/adMediaUri";
import { useToast } from "@/src/components/Toast";
import { AppHeader, Badge, Btn, Card, Chip, Field, LoadingView, Row, Screen, Sheet, T } from "@/src/components/ui";
import { colors, radius, spacing, type } from "@/src/theme";

type Campaign = Omit<Advertisement, "display_duration_seconds"> & {
  display_duration_seconds: 5 | 10 | 15 | 30;
  target_audience?: "users_tenants" | "owners" | "both";
  schedule_type: "daily" | "monthly";
  start_at: string;
  end_at: string;
  timezone: string;
  daily_start_time?: string | null;
  daily_end_time?: string | null;
  days_of_week: number[];
  days_of_month: number[];
  frequency_limit?: number | null;
  status: "draft" | "scheduled" | "active" | "paused" | "expired";
  impressions: number;
  clicks: number;
  click_through_rate: number;
  media_id?: string | null;
};

type FormState = {
  title: string;
  description: string;
  media_type: "image" | "video" | "link";
  media_id: string;
  alt_text: string;
  destination_url: string;
  target_audience: "users_tenants" | "owners" | "both" | null;
  schedule_type: "daily" | "monthly";
  start_at: string;
  end_at: string;
  timezone: string;
  daily_start_time: string;
  daily_end_time: string;
  days_of_week: number[];
  days_of_month: string;
  display_duration_seconds: 5 | 10 | 15 | 30;
  frequency_limit: string;
};

type AdvertisementSettingsForm = {
  ads_enabled: boolean;
  free_cooldown_minutes: string;
  premium_cooldown_minutes: string;
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const AUDIENCES = [
  { value: "users_tenants", label: "Users", description: "Tenants and users only" },
  { value: "owners", label: "Owners", description: "Hostel owners only" },
  { value: "both", label: "Both", description: "Tenants/users and hostel owners" },
] as const;
const MEDIA_LIMITS = {
  image: 20 * 1024 * 1024,
  video: 100 * 1024 * 1024,
};
const IMAGE_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};
const VIDEO_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  webm: "video/webm",
};
const validDate = (value: string) =>
  /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) && Number.isFinite(Date.parse(value));
function mediaMetadata(asset: ImagePicker.ImagePickerAsset) {
  const rawName = asset.fileName || asset.file?.name || asset.uri.split(/[?#]/, 1)[0].split("/").pop() || "";
  const extension = rawName.includes(".") ? rawName.split(".").pop()!.toLowerCase() : "";
  const mime = (asset.mimeType || asset.file?.type || "").toLowerCase();
  const mediaType = asset.type === "video" || mime.startsWith("video/")
    ? "video"
    : asset.type === "image" || mime.startsWith("image/")
      ? "image"
      : null;
  const supportedTypes = mediaType === "image" ? IMAGE_TYPES : mediaType === "video" ? VIDEO_TYPES : null;
  const inferredMime = supportedTypes?.[extension];
  const normalizedMime = mime === "image/jpg" ? "image/jpeg" : mime;
  const resolvedMime = !normalizedMime || normalizedMime === "application/octet-stream"
    ? inferredMime
    : normalizedMime;
  if (!mediaType || !supportedTypes || !resolvedMime || !Object.values(supportedTypes).includes(resolvedMime)) {
    throw new Error("Unsupported file format. Choose a JPG, JPEG, PNG, WebP, MP4, or WebM file.");
  }
  const matchingExtension = Object.entries(supportedTypes).find(([, type]) => type === resolvedMime)?.[0];
  if (extension && supportedTypes[extension] !== resolvedMime) {
    throw new Error("The selected file extension does not match its media type.");
  }
  const fileExtension = extension || matchingExtension;
  if (!fileExtension) {
    throw new Error("Could not determine the selected file extension. Please choose the file again.");
  }
  const fileName = `${rawName.replace(/[\\/]/g, "_").replace(/\.[^.]*$/, "") || "advertisement"}.${fileExtension}`;
  const fileSize = asset.file?.size ?? asset.fileSize;
  const limit = MEDIA_LIMITS[mediaType];
  if (typeof fileSize === "number" && fileSize > limit) {
    throw new Error(`${mediaType === "image" ? "Images" : "Videos"} must be ${limit / (1024 * 1024)} MB or smaller.`);
  }
  const uri = normalizeAdMediaUri(asset.uri, Platform.OS === "web", Boolean(asset.file));
  return { fileName, mimeType: resolvedMime, uri };
}

function emptyForm(): FormState {
  const start = new Date(Date.now() + 60_000);
  const end = new Date(Date.now() + 30 * 24 * 60 * 60_000);
  return {
    title: "",
    description: "",
    media_type: "link",
    media_id: "",
    alt_text: "",
    destination_url: "",
    target_audience: "both",
    schedule_type: "daily",
    start_at: start.toISOString(),
    end_at: end.toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    daily_start_time: "",
    daily_end_time: "",
    days_of_week: [],
    days_of_month: "",
    display_duration_seconds: 15,
    frequency_limit: "",
  };
}

function formFromCampaign(campaign: Campaign): FormState {
  return {
    title: campaign.title,
    description: campaign.description || "",
    media_type: campaign.media_type,
    media_id: campaign.media_id || "",
    alt_text: campaign.alt_text || "",
    destination_url: campaign.destination_url || "",
    target_audience: campaign.target_audience || null,
    schedule_type: campaign.schedule_type,
    start_at: campaign.start_at,
    end_at: campaign.end_at,
    timezone: campaign.timezone,
    daily_start_time: campaign.daily_start_time || "",
    daily_end_time: campaign.daily_end_time || "",
    days_of_week: campaign.days_of_week || [],
    days_of_month: (campaign.days_of_month || []).join(", "),
    display_duration_seconds: campaign.display_duration_seconds,
    frequency_limit: campaign.frequency_limit?.toString() || "",
  };
}

function parseDates(value: string, minimum: number, maximum: number): number[] {
  if (!value.trim()) return [];
  const parsed = value.split(",").map((part) => part.trim());
  if (parsed.some((part) => !/^\d+$/.test(part))) {
    throw new Error("Enter selected monthly dates as comma-separated numbers, such as 1, 15, 28.");
  }
  const days = parsed.map(Number);
  if (days.some((day) => day < minimum || day > maximum) || new Set(days).size !== days.length) {
    throw new Error(`Selected dates must be unique numbers between ${minimum} and ${maximum}.`);
  }
  return days;
}

export default function AdminAdvertisements() {
  const toast = useToast();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [adSettings, setAdSettings] = useState<AdvertisementSettingsForm>({
    ads_enabled: true,
    free_cooldown_minutes: "30",
    premium_cooldown_minutes: "30",
  });
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<Campaign | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Campaign | null>(null);
  const [audienceOpen, setAudienceOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await api.get<{ advertisements: Campaign[] }>("/admin/advertisements");
      setCampaigns(result.advertisements);
    } catch (error: any) {
      toast.show(error?.message || "Could not load advertisements", "error");
    } finally {
      setLoading(false);
    }
    try {
      const settings = await api.get<{
        ads_enabled: boolean;
        free_cooldown_minutes: number;
        premium_cooldown_minutes: number;
      }>("/admin/advertisements/settings");
      setAdSettings({
        ads_enabled: settings.ads_enabled,
        free_cooldown_minutes: String(settings.free_cooldown_minutes),
        premium_cooldown_minutes: String(settings.premium_cooldown_minutes),
      });
    } catch (error: any) {
      toast.show(error?.message || "Could not load ad delivery settings", "error");
    }
  }, [toast]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const discardMedia = async (mediaId: string) => {
    try {
      await api.del(`/admin/advertisements/media/${mediaId}`);
    } catch (error: any) {
      toast.show(error?.message || "Could not discard uploaded media", "error");
    }
  };

  const discardIfUnassigned = async (mediaId: string) => {
    if (campaigns.some((campaign) => campaign.media_id === mediaId)) return;
    await discardMedia(mediaId);
  };

  const saveAdSettings = async () => {
    const freeCooldown = Number(adSettings.free_cooldown_minutes);
    const premiumCooldown = Number(adSettings.premium_cooldown_minutes);
    if (
      !/^\d+$/.test(adSettings.free_cooldown_minutes)
      || !/^\d+$/.test(adSettings.premium_cooldown_minutes)
      || freeCooldown < 30
      || premiumCooldown < 30
      || freeCooldown > 10080
      || premiumCooldown > 10080
    ) {
      toast.show("Cooldowns must be whole minutes between 30 and 10,080.", "error");
      return;
    }
    setSettingsSaving(true);
    try {
      const saved = await api.put<{
        ads_enabled: boolean;
        free_cooldown_minutes: number;
        premium_cooldown_minutes: number;
      }>("/admin/advertisements/settings", {
        ads_enabled: adSettings.ads_enabled,
        free_cooldown_minutes: freeCooldown,
        premium_cooldown_minutes: premiumCooldown,
      });
      setAdSettings({
        ads_enabled: saved.ads_enabled,
        free_cooldown_minutes: String(saved.free_cooldown_minutes),
        premium_cooldown_minutes: String(saved.premium_cooldown_minutes),
      });
      toast.show("Ad delivery settings saved", "success");
    } catch (error: any) {
      toast.show(error?.message || "Could not save ad delivery settings", "error");
    } finally {
      setSettingsSaving(false);
    }
  };

  const resetForm = () => {
    if (form.media_id) void discardIfUnassigned(form.media_id);
    setForm(emptyForm());
    setEditingId(null);
    setPreview(null);
  };

  const pickMedia = async () => {
    if (saving || uploading) return;
    setUploading(true);
    let stage = "picker";
    try {
      if (Platform.OS !== "web") {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
          toast.show("Allow photo library access to upload advertisement media", "error");
          return;
        }
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images", "videos"],
        quality: 0.85,
        allowsMultipleSelection: false,
      });
      if (result.canceled || !result.assets[0]) return;
      const asset = result.assets[0];
      const assetName = asset.fileName || asset.file?.name || null;
      const uriScheme = asset.uri.match(/^([a-z][a-z\d+.-]*):/i)?.[1]?.toLowerCase() || "none";
      console.info("[ad-media] asset selected", {
        platform: Platform.OS,
        uriScheme,
        mimeType: asset.mimeType || asset.file?.type || null,
        fileName: assetName,
        sizeBytes: asset.file?.size ?? asset.fileSize ?? null,
      });
      stage = "validation";
      const { fileName, mimeType, uri } = mediaMetadata(asset);
      let uploaded: { media_id: string; media_type: "image" | "video" };
      if (Platform.OS === "web") {
        stage = "form_data";
        const data = new FormData();
        data.append("file", asset.file!, fileName);
        console.info("[ad-media] multipart body ready", {
          platform: Platform.OS,
          formDataConstructor: data.constructor.name,
          isBrowserFormData: data instanceof FormData,
          isBrowserFile: typeof File !== "undefined" && asset.file instanceof File,
        });
        stage = "request";
        uploaded = await api.upload<{ media_id: string; media_type: "image" | "video" }>(
          "/admin/advertisements/media",
          data,
        );
      } else {
        stage = "native_upload";
        uploaded = await api.uploadNativeFile<{ media_id: string; media_type: "image" | "video" }>(
          "/admin/advertisements/media",
          uri,
          fileName,
          mimeType,
        );
      }
      if (form.media_id) await discardIfUnassigned(form.media_id);
      setForm((current) => ({
        ...current,
        media_type: uploaded.media_type,
        media_id: uploaded.media_id,
      }));
    } catch (error: any) {
      const message = error?.message || "";
      const networkFailure = error instanceof TypeError || /network request failed|failed to fetch|network error/i.test(message);
      console.error("[ad-media] upload failed", {
        platform: Platform.OS,
        stage,
        errorName: error instanceof Error ? error.name : "UnknownError",
        errorMessage: message,
      });
      toast.show(
        networkFailure
          ? "Upload failed because the server could not be reached. Check your connection and try again."
          : message || "Could not upload advertisement media. Please try again.",
        "error",
      );
    } finally {
      setUploading(false);
    }
  };

  const save = async (publish: boolean) => {
    if (saving) return;
    if (!form.title.trim()) {
      toast.show("Enter an advertisement title", "error");
      return;
    }
    if (!form.target_audience) {
      toast.show("Select an audience before saving this advertisement", "error");
      return;
    }
    if (!validDate(form.start_at) || !validDate(form.end_at)) {
      toast.show("Campaign dates must be ISO date-times with a time-zone offset", "error");
      return;
    }
    if (Date.parse(form.start_at) >= Date.parse(form.end_at)) {
      toast.show("Campaign end must be after campaign start", "error");
      return;
    }
    if (form.media_type !== "link" && !form.media_id) {
      toast.show("Upload an image or video, or choose a link-only promotion", "error");
      return;
    }
    if (form.destination_url.trim()) {
      try {
        const url = new URL(form.destination_url.trim());
        if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error();
      } catch {
        toast.show("Promotional links must be valid http or https URLs", "error");
        return;
      }
    }
    if (Boolean(form.daily_start_time) !== Boolean(form.daily_end_time)) {
      toast.show("Provide both daily display-window times", "error");
      return;
    }
    if (form.frequency_limit && (!/^\d+$/.test(form.frequency_limit) || Number(form.frequency_limit) < 1 || Number(form.frequency_limit) > 100)) {
      toast.show("Frequency limit must be a whole number from 1 to 100", "error");
      return;
    }

    let daysOfMonth: number[];
    try {
      daysOfMonth = parseDates(form.days_of_month, 1, 31);
    } catch (error: any) {
      toast.show(error.message, "error");
      return;
    }

    const body = {
      ...form,
      title: form.title.trim(),
      description: form.description.trim(),
      alt_text: form.alt_text.trim(),
      destination_url: form.destination_url.trim() || null,
      media_id: form.media_id || null,
      days_of_month: daysOfMonth,
      frequency_limit: form.frequency_limit ? Number(form.frequency_limit) : null,
      daily_start_time: form.daily_start_time || null,
      daily_end_time: form.daily_end_time || null,
    };
    setSaving(true);
    try {
      const result = editingId
        ? await api.put<{ advertisement: Campaign }>(`/admin/advertisements/${editingId}`, body)
        : await api.post<{ advertisement: Campaign }>("/admin/advertisements", body);
      if (publish) {
        await api.post(`/admin/advertisements/${result.advertisement.id}/status`, { action: "publish" });
      }
      toast.show(publish ? "Advertisement published" : editingId ? "Advertisement updated" : "Draft saved");
      setForm(emptyForm());
      setEditingId(null);
      setPreview(null);
      await load();
    } catch (error: any) {
      toast.show(error?.message || "Could not save advertisement", "error");
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (campaign: Campaign, action: "publish" | "pause") => {
    try {
      await api.post(`/admin/advertisements/${campaign.id}/status`, { action });
      toast.show(action === "publish" ? "Advertisement published" : "Advertisement paused");
      await load();
    } catch (error: any) {
      toast.show(error?.message || "Could not update advertisement status", "error");
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    try {
      await api.del(`/admin/advertisements/${deleteTarget.id}`);
      if (form.media_id === deleteTarget.media_id) {
        setForm(emptyForm());
        setEditingId(null);
      }
      if (preview?.id === deleteTarget.id) setPreview(null);
      setDeleteTarget(null);
      toast.show("Advertisement deleted");
      await load();
    } catch (error: any) {
      toast.show(error?.message || "Could not delete advertisement", "error");
    }
  };

  const edit = (campaign: Campaign) => {
    setForm(formFromCampaign(campaign));
    setEditingId(campaign.id);
    setPreview(null);
  };

  if (loading) return <Screen><LoadingView /></Screen>;

  return (
    <Screen edges={["top"]}>
      <AppHeader title="Advertisement Management" subtitle={`${campaigns.length} campaigns`} />
      <ScrollView contentContainerStyle={{ alignSelf: "center", width: "100%", maxWidth: 960, padding: spacing.lg, gap: spacing.md, paddingBottom: spacing["3xl"] }}>
        <Card style={{ gap: spacing.md }}>
          <T weight="extrabold" size={type.lg}>Global ad delivery</T>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md }}>
            <View style={{ flex: 1, gap: spacing.xs }}>
              <T weight="semibold">{adSettings.ads_enabled ? "Advertisements are ON" : "Advertisements are OFF"}</T>
              <T size={type.sm} color={colors.onSurfaceSecondary}>
                When OFF, no campaign is delivered, regardless of its status or schedule.
              </T>
            </View>
            <Switch
              accessibilityLabel="Enable advertisements globally"
              value={adSettings.ads_enabled}
              onValueChange={(ads_enabled) => setAdSettings({ ...adSettings, ads_enabled })}
              trackColor={{ false: colors.borderStrong, true: colors.brandSecondary }}
              thumbColor={adSettings.ads_enabled ? colors.brand : colors.surfaceSecondary}
              disabled={settingsSaving}
            />
          </View>
          <View style={{ gap: spacing.md }}>
            <Field
              label="Free user cooldown (minutes)"
              value={adSettings.free_cooldown_minutes}
              onChangeText={(free_cooldown_minutes) => setAdSettings({ ...adSettings, free_cooldown_minutes })}
              placeholder="30"
              keyboardType="numeric"
            />
            <Field
              label="Premium user cooldown (minutes)"
              value={adSettings.premium_cooldown_minutes}
              onChangeText={(premium_cooldown_minutes) => setAdSettings({ ...adSettings, premium_cooldown_minutes })}
              placeholder="30"
              keyboardType="numeric"
            />
          </View>
          <T size={type.sm} color={colors.onSurfaceSecondary}>
            By default, eligible users and tenants can see one ad every 30 minutes. Campaign daily frequency limits still apply.
          </T>
          <Btn title="Save delivery settings" onPress={saveAdSettings} loading={settingsSaving} />
        </Card>

        <Card style={{ gap: spacing.md }}>
          <T weight="extrabold" size={type.xl}>{editingId ? "Edit advertisement" : "Create advertisement"}</T>
          <Field label="Title" value={form.title} onChangeText={(title) => setForm({ ...form, title })} placeholder="Campaign title" autoCapitalize="sentences" />
          <Field label="Description" value={form.description} onChangeText={(description) => setForm({ ...form, description })} placeholder="Describe the promotion" multiline autoCapitalize="sentences" />
          <Field label="Image description (accessibility)" value={form.alt_text} onChangeText={(alt_text) => setForm({ ...form, alt_text })} placeholder="Describe the image or video" autoCapitalize="sentences" />

          <View style={{ gap: spacing.xs }}>
            <T size={type.sm} weight="semibold" color={colors.onSurfaceSecondary}>Media</T>
            <Row style={{ gap: spacing.sm, flexWrap: "wrap" }}>
              <Btn title={uploading ? "Uploading..." : form.media_id ? "Replace media" : "Choose image or video"} icon="cloud-upload" onPress={pickMedia} loading={uploading} disabled={saving} variant="secondary" />
              {form.media_id ? <Btn title="Remove media" icon="close-circle" variant="ghost" onPress={() => {
                void discardIfUnassigned(form.media_id);
                setForm({ ...form, media_id: "", media_type: "link" });
              }} /> : null}
            </Row>
            {form.media_type !== "link" && form.media_id ? (
              <T size={type.sm} color={colors.onSurfaceSecondary}>Uploaded {form.media_type}</T>
            ) : null}
          </View>
          <Field label="Promotional link (optional)" value={form.destination_url} onChangeText={(destination_url) => setForm({ ...form, destination_url })} placeholder="https://example.com" keyboardType="default" autoCapitalize="none" />

          <View style={{ gap: spacing.xs }}>
            <T size={type.sm} weight="semibold" color={colors.onSurfaceSecondary}>Target audience</T>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Target audience: ${AUDIENCES.find((option) => option.value === form.target_audience)?.label || "Not set"}`}
              accessibilityHint="Opens audience options"
              onPress={() => setAudienceOpen(true)}
              style={{
                minHeight: 52,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                paddingHorizontal: spacing.md,
                borderWidth: 1.5,
                borderColor: form.target_audience ? colors.border : colors.warning,
                borderRadius: radius.md,
                backgroundColor: colors.surface,
              }}
            >
              <View>
                <T weight="semibold">
                  {AUDIENCES.find((option) => option.value === form.target_audience)?.label || "Audience not set"}
                </T>
                <T size={type.sm} color={colors.onSurfaceSecondary}>
                  {AUDIENCES.find((option) => option.value === form.target_audience)?.description
                    || "This existing ad is not delivered until an audience is selected."}
                </T>
              </View>
              <Ionicons name="chevron-down" size={20} color={colors.onSurfaceSecondary} />
            </Pressable>
          </View>

          <View style={{ gap: spacing.xs }}>
            <T size={type.sm} weight="semibold" color={colors.onSurfaceSecondary}>Recurring schedule</T>
            <Row style={{ gap: spacing.xs }}>
              <Chip label="Daily / weekly" active={form.schedule_type === "daily"} onPress={() => setForm({ ...form, schedule_type: "daily" })} />
              <Chip label="Monthly" active={form.schedule_type === "monthly"} onPress={() => setForm({ ...form, schedule_type: "monthly" })} />
            </Row>
          </View>
          {form.schedule_type === "daily" ? (
            <View style={{ gap: spacing.xs }}>
              <T size={type.sm} weight="semibold" color={colors.onSurfaceSecondary}>Show on days (none means every day)</T>
              <Row style={{ gap: 4, flexWrap: "wrap" }}>
                {WEEKDAYS.map((day, index) => (
                  <Chip key={day} label={day} active={form.days_of_week.includes(index)} onPress={() => setForm({
                    ...form,
                    days_of_week: form.days_of_week.includes(index)
                      ? form.days_of_week.filter((value) => value !== index)
                      : [...form.days_of_week, index].sort(),
                  })} />
                ))}
              </Row>
            </View>
          ) : (
            <Field label="Monthly dates (optional)" value={form.days_of_month} onChangeText={(days_of_month) => setForm({ ...form, days_of_month })} placeholder="1, 15, 28 (blank means every date)" keyboardType="default" />
          )}

          <Field label="Campaign starts at (ISO 8601 with offset)" value={form.start_at} onChangeText={(start_at) => setForm({ ...form, start_at })} placeholder="2026-10-01T09:00:00+05:30" autoCapitalize="none" />
          <Field label="Campaign ends at (ISO 8601 with offset)" value={form.end_at} onChangeText={(end_at) => setForm({ ...form, end_at })} placeholder="2026-11-01T09:00:00+05:30" autoCapitalize="none" />
          <Field label="Time zone (IANA)" value={form.timezone} onChangeText={(timezone) => setForm({ ...form, timezone })} placeholder="Asia/Kolkata" autoCapitalize="none" />
          <T size={type.sm} color={colors.onSurfaceSecondary}>
            Campaign dates use the explicit offset above; recurring days and display windows use this IANA time zone.
          </T>
          <Field label="Daily display starts (HH:MM, optional)" value={form.daily_start_time} onChangeText={(daily_start_time) => setForm({ ...form, daily_start_time })} placeholder="09:00" autoCapitalize="none" />
          <Field label="Daily display ends (HH:MM, optional)" value={form.daily_end_time} onChangeText={(daily_end_time) => setForm({ ...form, daily_end_time })} placeholder="21:00" autoCapitalize="none" />

          <View style={{ gap: spacing.xs }}>
            <T size={type.sm} weight="semibold" color={colors.onSurfaceSecondary}>Display duration per impression</T>
            <Row style={{ gap: spacing.xs }}>
              {([5, 10, 15, 30] as const).map((seconds) => (
                <Chip key={seconds} label={`${seconds}s`} active={form.display_duration_seconds === seconds} onPress={() => setForm({ ...form, display_duration_seconds: seconds })} />
              ))}
            </Row>
          </View>
          <Field label="Frequency limit per user per day (optional)" value={form.frequency_limit} onChangeText={(frequency_limit) => setForm({ ...form, frequency_limit })} placeholder="For example, 3" keyboardType="numeric" />

          <Row style={{ gap: spacing.sm, flexWrap: "wrap" }}>
            <Btn title="Save draft" variant="secondary" onPress={() => save(false)} loading={saving} disabled={uploading} />
            <Btn title="Save & publish" icon="megaphone" onPress={() => save(true)} loading={saving} disabled={uploading} />
            {editingId ? <Btn title="Cancel edit" variant="ghost" onPress={resetForm} disabled={saving} /> : null}
          </Row>
        </Card>

        {preview ? (
          <Card style={{ gap: spacing.sm, borderColor: colors.brand, borderWidth: 1.5 }}>
            <Row style={{ justifyContent: "space-between" }}>
              <T weight="bold" size={type.lg}>Preview · {preview.title}</T>
              <Pressable accessibilityRole="button" accessibilityLabel="Close preview" onPress={() => setPreview(null)} hitSlop={8}>
                <Ionicons name="close" size={20} color={colors.onSurfaceSecondary} />
              </Pressable>
            </Row>
            {preview.description ? <T color={colors.onSurfaceSecondary}>{preview.description}</T> : null}
            <AdvertisementMedia key={preview.media_url} advertisement={preview} />
            {preview.destination_url ? <T color={colors.brand}>{preview.destination_url}</T> : null}
          </Card>
        ) : null}

        <T weight="extrabold" size={type.xl}>Campaigns</T>
        {campaigns.length === 0 ? (
          <Card><T color={colors.onSurfaceSecondary}>No advertisements yet. Create a campaign above.</T></Card>
        ) : campaigns.map((campaign) => (
          <Card key={campaign.id} testID={`advertisement-${campaign.id}`} style={{ gap: spacing.sm }}>
            <Row style={{ alignItems: "flex-start", gap: spacing.sm }}>
              <View style={{ flex: 1, gap: spacing.xs }}>
                <T weight="bold" size={type.lg}>{campaign.title}</T>
                <T size={type.sm} color={colors.onSurfaceSecondary} numberOfLines={3}>{campaign.description || campaign.destination_url || "No description"}</T>
              </View>
              <Badge
                label={campaign.status}
                tone={campaign.status === "active" ? "success" : campaign.status === "scheduled" ? "info" : campaign.status === "paused" ? "warning" : campaign.status === "expired" ? "neutral" : "brand"}
              />
            </Row>
            <T size={type.sm} color={colors.onSurfaceSecondary}>
              {AUDIENCES.find((option) => option.value === campaign.target_audience)?.label || "Audience not set (not delivered)"}
              {" · "}{campaign.schedule_type}{" · "}{campaign.display_duration_seconds}s per impression
            </T>
            <Row style={{ gap: spacing.md, flexWrap: "wrap" }}>
              <T size={type.sm}>Impressions: {campaign.impressions}</T>
              <T size={type.sm}>Clicks: {campaign.clicks}</T>
              <T size={type.sm}>CTR: {campaign.click_through_rate}%</T>
            </Row>
            <Row style={{ gap: spacing.xs, flexWrap: "wrap" }}>
              <Btn title="Preview" icon="eye" variant="ghost" onPress={() => setPreview(campaign)} />
              <Btn title="Edit" icon="create" variant="secondary" onPress={() => edit(campaign)} />
              {campaign.status === "active" || campaign.status === "scheduled" ? (
                <Btn title="Pause" icon="pause" variant="ghost" onPress={() => changeStatus(campaign, "pause")} />
              ) : campaign.status === "draft" || campaign.status === "paused" ? (
                <Btn title="Publish" icon="play" onPress={() => changeStatus(campaign, "publish")} />
              ) : null}
              <Btn title="Delete" icon="trash" variant="danger" onPress={() => setDeleteTarget(campaign)} />
            </Row>
          </Card>
        ))}
      </ScrollView>
      <Sheet visible={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Delete advertisement?">
        <T color={colors.onSurfaceSecondary}>
          Delete “{deleteTarget?.title}”? Reporting history is retained; viewer names and contact details are not stored.
        </T>
        <Row style={{ gap: spacing.sm }}>
          <View style={{ flex: 1 }}>
            <Btn title="Cancel" variant="ghost" onPress={() => setDeleteTarget(null)} />
          </View>
          <View style={{ flex: 1 }}>
            <Btn title="Delete" variant="danger" icon="trash" onPress={remove} />
          </View>
        </Row>
      </Sheet>
      <Sheet visible={audienceOpen} onClose={() => setAudienceOpen(false)} title="Choose an audience">
        <T color={colors.onSurfaceSecondary}>An advertisement is delivered only to the audience you select.</T>
        {AUDIENCES.map((option) => {
          const selected = form.target_audience === option.value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              onPress={() => {
                setForm((current) => ({ ...current, target_audience: option.value }));
                setAudienceOpen(false);
              }}
              style={{
                minHeight: 64,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                gap: spacing.md,
                padding: spacing.md,
                borderWidth: selected ? 1.5 : 1,
                borderColor: selected ? colors.brand : colors.border,
                borderRadius: radius.md,
                backgroundColor: selected ? colors.brandTertiary : colors.surface,
              }}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <T weight="bold">{option.label}</T>
                <T size={type.sm} color={colors.onSurfaceSecondary}>{option.description}</T>
              </View>
              <Ionicons
                name={selected ? "radio-button-on" : "radio-button-off"}
                size={20}
                color={selected ? colors.brand : colors.onSurfaceTertiary}
              />
            </Pressable>
          );
        })}
      </Sheet>
    </Screen>
  );
}
