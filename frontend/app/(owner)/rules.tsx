import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useFocusEffect, router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import {
  AppHeader,
  Badge,
  Btn,
  Card,
  EmptyState,
  Field,
  LoadingView,
  Row,
  Screen,
  Sheet,
  T,
} from "@/src/components/ui";
import { HostelSwitcher } from "@/src/components/HostelSwitcher";
import { useOwnerHostel } from "@/src/context/OwnerHostelContext";
import { ApiError, api } from "@/src/api/client";
import { useToast } from "@/src/components/Toast";
import { tenantDocumentImageUri } from "@/src/utils/tenantDocumentImage";
import { colors, radius, spacing, type } from "@/src/theme";

const MAX_IMAGES = 5;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

type PickedRulesImage = {
  key: string;
  asset?: ImagePicker.ImagePickerAsset;
  uploadId?: string;
  label: string;
};

type RulesDocument = {
  id: string;
  version: number;
  text: string;
  created_at: string;
  published_at: string;
  source_image_ids?: string[];
};

type AcknowledgementRow = {
  tenant_id: string;
  tenant_name: string;
  room_number?: string | null;
  bed_number?: string | null;
  policy_version?: number | null;
  status: string;
  acknowledged_at?: string | null;
};

type FailedAction = "load" | "ocr" | "draft" | "publish" | null;

function imageMimeType(asset: ImagePicker.ImagePickerAsset) {
  const supplied = asset.mimeType?.toLowerCase();
  if (supplied && ALLOWED_TYPES.has(supplied)) return supplied;
  const extension = (asset.fileName || asset.uri).split(/[?#.]/).pop()?.toLowerCase();
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "png") return "image/png";
  if (extension === "webp") return "image/webp";
  return "";
}

function imageFileName(asset: ImagePicker.ImagePickerAsset, index: number, mimeType: string) {
  const name = asset.fileName?.trim();
  if (name && /\.[a-z0-9]+$/i.test(name)) return name;
  const extension = mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
  return `rules-${index + 1}.${extension}`;
}

function withDeadline<T>(promise: Promise<T>, milliseconds: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ApiError(message, 408)), milliseconds);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export default function RulesManagement() {
  const toast = useToast();
  const { activeId, activeHostel } = useOwnerHostel();
  const [loading, setLoading] = useState(true);
  const [operation, setOperation] = useState<"uploading" | "ocr" | "draft" | "publishing" | null>(null);
  const [error, setError] = useState("");
  const [failedAction, setFailedAction] = useState<FailedAction>(null);
  const [text, setText] = useState("");
  const [selectedImages, setSelectedImages] = useState<PickedRulesImage[]>([]);
  const [uncertainSections, setUncertainSections] = useState<string[]>([]);
  const [latest, setLatest] = useState<RulesDocument | null>(null);
  const [history, setHistory] = useState<RulesDocument[]>([]);
  const [reportRows, setReportRows] = useState<AcknowledgementRow[]>([]);
  const [reportHistory, setReportHistory] = useState<any[]>([]);
  const [reportTotals, setReportTotals] = useState({ total: 0, acknowledged: 0, pending: 0 });
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"All" | "Pending" | "Acknowledged">("All");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [expandedVersion, setExpandedVersion] = useState<number | null>(null);
  const [permissionBlocked, setPermissionBlocked] = useState(false);
  const [originalPreviewItem, setOriginalPreviewItem] = useState<PickedRulesImage | null>(null);
  const [originalPreviewUri, setOriginalPreviewUri] = useState<string | null>(null);
  const [originalPreviewLoading, setOriginalPreviewLoading] = useState(false);
  const [originalPreviewError, setOriginalPreviewError] = useState("");

  useEffect(() => () => {
    if (Platform.OS === "web" && originalPreviewUri?.startsWith("blob:")) {
      URL.revokeObjectURL(originalPreviewUri);
    }
  }, [originalPreviewUri]);

  const load = useCallback(async () => {
    if (!activeId) {
      setLoading(false);
      setLatest(null);
      setReportRows([]);
      return;
    }
    setLoading(true);
    setError("");
    setFailedAction(null);
    try {
      const hostelId = encodeURIComponent(activeId);
      const [rules, report] = await Promise.all([
        api.get<{
          draft: { text: string; source_image_ids?: string[] } | null;
          latest: RulesDocument | null;
          history: RulesDocument[];
        }>(`/owner/rules?hostel_id=${hostelId}`),
        api.get<{
          total_active_tenants: number;
          acknowledged_count: number;
          pending_count: number;
          tenants: AcknowledgementRow[];
          history: any[];
        }>(`/owner/rules/acknowledgements?hostel_id=${hostelId}`),
      ]);
      setLatest(rules.latest);
      setHistory(rules.history || []);
      setText(rules.draft?.text ?? rules.latest?.text ?? "");
      setSelectedImages((rules.draft?.source_image_ids || []).map((id, index) => ({
        key: id,
        uploadId: id,
        label: `Saved source image ${index + 1}`,
      })));
      setReportRows(report.tenants || []);
      setReportHistory(report.history || []);
      setReportTotals({
        total: report.total_active_tenants || 0,
        acknowledged: report.acknowledged_count || 0,
        pending: report.pending_count || 0,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not load rules and acknowledgement report";
      setError(message);
      setFailedAction("load");
    } finally {
      setLoading(false);
    }
  }, [activeId]);

  useFocusEffect(useCallback(() => {
    void load();
  }, [load]));

  const visibleRows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return reportRows.filter((row) => {
      const matchesFilter = filter === "All" || row.status === filter;
      const matchesSearch = !query || [
        row.tenant_name,
        row.room_number || "",
        row.bed_number || "",
      ].some((value) => value.toLocaleLowerCase().includes(query));
      return matchesFilter && matchesSearch;
    });
  }, [filter, reportRows, search]);

  const addPickedAssets = (assets: ImagePicker.ImagePickerAsset[]) => {
    const available = MAX_IMAGES - selectedImages.length;
    if (available <= 0) {
      setError(`Select no more than ${MAX_IMAGES} images at a time.`);
      return;
    }
    const accepted: PickedRulesImage[] = [];
    for (const asset of assets.slice(0, available)) {
      const mimeType = imageMimeType(asset);
      if (!mimeType) {
        setError("Only JPG, PNG, or WebP images are supported.");
        continue;
      }
      if (asset.fileSize !== undefined && asset.fileSize > MAX_IMAGE_BYTES) {
        setError("Each rules image must be 10 MB or smaller.");
        continue;
      }
      accepted.push({
        key: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        asset,
        label: asset.fileName || `Selected image ${selectedImages.length + accepted.length + 1}`,
      });
    }
    if (assets.length > available) setError(`Only ${MAX_IMAGES} images can be selected at a time.`);
    if (accepted.length) {
      setError("");
      setSelectedImages((current) => [...current, ...accepted]);
    }
  };

  const pickGallery = async () => {
    try {
      let permission = await ImagePicker.getMediaLibraryPermissionsAsync();
      if (!permission.granted && permission.canAskAgain) {
        permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      }
      if (!permission.granted) {
        setPermissionBlocked(!permission.canAskAgain);
        setError(permission.canAskAgain ? "Photo library permission is required to choose rules images." : "Allow photo library access in device settings to select rules images.");
        return;
      }
      setPermissionBlocked(false);
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsMultipleSelection: true,
        selectionLimit: MAX_IMAGES,
        quality: 1,
      });
      if (!result.canceled) addPickedAssets(result.assets);
    } catch {
      setError("Could not open the photo library. Please retry.");
    }
  };

  const takePhoto = async () => {
    try {
      let permission = await ImagePicker.getCameraPermissionsAsync();
      if (!permission.granted && permission.canAskAgain) {
        permission = await ImagePicker.requestCameraPermissionsAsync();
      }
      if (!permission.granted) {
        setPermissionBlocked(!permission.canAskAgain);
        setError(permission.canAskAgain ? "Camera permission is required to take a rules image." : "Allow camera access in device settings to take a rules image.");
        return;
      }
      setPermissionBlocked(false);
      const result = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 1 });
      if (!result.canceled) addPickedAssets(result.assets);
    } catch {
      setError("Could not open the camera. Please retry.");
    }
  };

  const removeImage = async (item: PickedRulesImage) => {
    if (item.uploadId) {
      try {
        await api.delete(`/owner/rules/images/${encodeURIComponent(item.uploadId)}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not remove this saved image.");
        return;
      }
    }
    setSelectedImages((current) => current.filter((image) => image.key !== item.key));
  };

  const openOriginalImage = async (item: PickedRulesImage) => {
    setOriginalPreviewItem(item);
    setOriginalPreviewUri(null);
    setOriginalPreviewError("");
    if (item.asset?.uri) {
      setOriginalPreviewUri(item.asset.uri);
      return;
    }
    if (!item.uploadId) {
      setOriginalPreviewError("This original image is not available. Select and upload it again.");
      return;
    }
    setOriginalPreviewLoading(true);
    try {
      const image = await api.getBlob(`/owner/rules/images/${encodeURIComponent(item.uploadId)}`);
      setOriginalPreviewUri(await tenantDocumentImageUri(image, Platform.OS === "web"));
    } catch (e) {
      setOriginalPreviewError(e instanceof Error ? e.message : "Could not load the private original image.");
    } finally {
      setOriginalPreviewLoading(false);
    }
  };

  const uploadImage = async (item: PickedRulesImage, index: number) => {
    if (item.uploadId) return item.uploadId;
    if (!activeId || !item.asset) throw new Error("Select at least one rules image.");
    const mimeType = imageMimeType(item.asset);
    const fileName = imageFileName(item.asset, index, mimeType);
    if (Platform.OS !== "web") {
      const response = await withDeadline(
        api.uploadNativeFile<{ upload_id: string }>(
          `/owner/rules/images?hostel_id=${encodeURIComponent(activeId)}`,
          item.asset.uri,
          fileName,
          mimeType,
        ),
        30000,
        "Image upload timed out. Check your connection and retry.",
      );
      return response.upload_id;
    }
    const fileResponse = await fetch(item.asset.uri);
    if (!fileResponse.ok) throw new Error("Could not read the selected image.");
    const form = new FormData();
    form.append("file", await fileResponse.blob(), fileName);
    const response = await api.uploadWithTimeout<{ upload_id: string }>(
      `/owner/rules/images?hostel_id=${encodeURIComponent(activeId)}`,
      form,
      30000,
      "Image upload timed out. Check your connection and retry.",
    );
    return response.upload_id;
  };

  const extractText = async () => {
    if (!activeId || selectedImages.length === 0 || operation) return;
    setOperation("uploading");
    setError("");
    setFailedAction(null);
    try {
      const uploadIds: string[] = [];
      for (let index = 0; index < selectedImages.length; index += 1) {
        const item = selectedImages[index];
        const uploadId = await uploadImage(item, index);
        uploadIds.push(uploadId);
        if (!item.uploadId) {
          setSelectedImages((current) => current.map((image) =>
            image.key === item.key ? { ...image, uploadId } : image,
          ));
        }
      }
      setOperation("ocr");
      const result = await api.postWithTimeout<{
        text: string;
        uncertain_sections: string[];
        source_image_ids: string[];
      }>(
        "/owner/rules/ocr",
        { hostel_id: activeId, upload_ids: uploadIds },
        240000,
        "Text extraction did not finish. Retry with clearer or fewer images, or enter the rules manually.",
      );
      setText(result.text);
      setUncertainSections(result.uncertain_sections || []);
      if (!result.text.trim()) {
        setError("No readable text was extracted. Try a clearer image or enter the rules manually.");
        setFailedAction("ocr");
        return;
      }
      toast.show("Text extracted and saved as a draft. Review it before publishing.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not extract text. Please retry.");
      setFailedAction("ocr");
    } finally {
      setOperation(null);
    }
  };

  const saveDraft = async () => {
    if (!activeId || !text.trim() || operation) return;
    setOperation("draft");
    setError("");
    setFailedAction(null);
    try {
      const sourceImageIds = selectedImages.flatMap((item) => item.uploadId ? [item.uploadId] : []);
      await api.put("/owner/rules/draft", {
        hostel_id: activeId,
        text,
        source_image_ids: sourceImageIds,
      });
      toast.show("Draft saved");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the draft.");
      setFailedAction("draft");
    } finally {
      setOperation(null);
    }
  };

  const publish = async () => {
    if (!activeId || !text.trim() || operation) return;
    setOperation("publishing");
    setError("");
    setFailedAction(null);
    try {
      const sourceImageIds = selectedImages.flatMap((item) => item.uploadId ? [item.uploadId] : []);
      const result = await api.post<{ policy: RulesDocument; already_published: boolean }>(
        "/owner/rules/publish",
        { hostel_id: activeId, text, source_image_ids: sourceImageIds },
      );
      setLatest(result.policy);
      toast.show(result.already_published
        ? `Rules version ${result.policy.version} is already published`
        : `Rules version ${result.policy.version} published`);
      setPreviewOpen(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not publish the rules.");
      setFailedAction("publish");
    } finally {
      setOperation(null);
    }
  };

  const askToPublish = () => {
    if (!text.trim() || operation) return;
    const message = `Publish these rules for ${activeHostel?.name || "this hostel"}? Active tenants who have not acknowledged this version will be asked to review it.`;
    if (Platform.OS === "web") {
      if (typeof window !== "undefined" && window.confirm(message)) void publish();
      return;
    }
    Alert.alert("Publish Rules", message, [
      { text: "Cancel", style: "cancel" },
      { text: "Publish", onPress: () => void publish() },
    ]);
  };

  const openPreview = () => setPreviewOpen(true);

  if (loading) return <Screen><LoadingView label="Loading rules and tenant report..." /></Screen>;

  return (
    <Screen edges={["top"]}>
      <AppHeader title="Rules & Regulations" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <HostelSwitcher />
        {!activeId ? (
          <EmptyState icon="business-outline" title="No hostel selected" subtitle="Create or select a hostel to manage its rules." />
        ) : (
          <>
            {error ? (
              <Card style={styles.errorCard}>
                <Row style={{ gap: spacing.sm, alignItems: "flex-start" }}>
                  <Ionicons name="alert-circle" size={20} color={colors.error} />
                  <T color={colors.error} style={{ flex: 1 }}>{error}</T>
                </Row>
                {failedAction === "load" ? <Btn title="Retry loading" variant="ghost" onPress={() => void load()} testID="rules-retry-load" /> : null}
                {failedAction === "ocr" ? <Btn title="Retry text extraction" variant="ghost" icon="refresh" onPress={() => void extractText()} testID="rules-retry-ocr" /> : null}
                {failedAction === "draft" ? <Btn title="Retry saving draft" variant="ghost" icon="refresh" onPress={() => void saveDraft()} testID="rules-retry-draft" /> : null}
                {failedAction === "publish" ? <Btn title="Retry publishing" variant="ghost" icon="refresh" onPress={askToPublish} testID="rules-retry-publish" /> : null}
                {permissionBlocked ? (
                  <Btn title="Open Settings" variant="secondary" icon="settings" onPress={() => void Linking.openSettings()} />
                ) : null}
              </Card>
            ) : null}

            <Card style={{ gap: spacing.md }}>
              <View style={{ gap: spacing.xs }}>
                <T weight="extrabold" size={type.lg}>Policy editor</T>
                <T size={type.sm} color={colors.onSurfaceSecondary}>
                  Add rule images, review the extracted text, then preview and publish the version for this hostel.
                </T>
              </View>
              {latest ? (
                <Row style={{ justifyContent: "space-between" }}>
                  <T size={type.sm} color={colors.onSurfaceSecondary}>Current published version</T>
                  <Badge label={`Version ${latest.version}`} tone="success" />
                </Row>
              ) : (
                <Badge label="No policy published" tone="warning" />
              )}
              <Row style={{ gap: spacing.sm }}>
                <Btn
                  title="Take photo"
                  icon="camera"
                  variant="secondary"
                  onPress={() => void takePhoto()}
                  disabled={operation !== null || selectedImages.length >= MAX_IMAGES}
                  style={{ flex: 1 }}
                  testID="rules-camera"
                />
                <Btn
                  title="Choose images"
                  icon="images"
                  variant="secondary"
                  onPress={() => void pickGallery()}
                  disabled={operation !== null || selectedImages.length >= MAX_IMAGES}
                  style={{ flex: 1 }}
                  testID="rules-gallery"
                />
              </Row>
              {selectedImages.length > 0 ? (
                <View style={styles.imageList}>
                  {selectedImages.map((item, index) => (
                    <View key={item.key} style={styles.imageItem}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`View original image ${index + 1}`}
                        onPress={() => void openOriginalImage(item)}
                        style={styles.originalImageButton}
                      >
                        {item.asset ? (
                          <Image source={{ uri: item.asset.uri }} style={styles.thumbnail} contentFit="cover" />
                        ) : (
                          <View style={[styles.thumbnail, styles.savedThumbnail]}>
                            <Ionicons name="document-attach" size={20} color={colors.brand} />
                          </View>
                        )}
                      </Pressable>
                      <View style={{ flex: 1 }}>
                        <T size={type.sm} weight="semibold" numberOfLines={1}>{item.label}</T>
                        {item.uploadId ? (
                          <T size={11} color={colors.success}>Securely uploaded</T>
                        ) : item.asset?.fileSize !== undefined ? (
                          <T size={11} color={colors.onSurfaceTertiary}>{(item.asset.fileSize / 1024 / 1024).toFixed(1)} MB</T>
                        ) : null}
                      </View>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Remove image ${index + 1}`}
                        onPress={() => void removeImage(item)}
                        disabled={operation !== null}
                        style={styles.removeButton}
                      >
                        <Ionicons name="close" size={18} color={colors.error} />
                      </Pressable>
                    </View>
                  ))}
                </View>
              ) : null}
              <Btn
                title={operation === "uploading" ? "Uploading images..." : operation === "ocr" ? "Extracting text..." : "Extract text from images"}
                icon="scan"
                onPress={() => void extractText()}
                loading={operation === "uploading" || operation === "ocr"}
                disabled={selectedImages.length === 0 || operation !== null}
                testID="rules-extract"
              />
              {operation === "uploading" || operation === "ocr" ? (
                <Row style={{ gap: spacing.sm }}>
                  <ActivityIndicator size="small" color={colors.brand} />
                  <T size={type.sm} color={colors.onSurfaceSecondary}>
                    {operation === "uploading" ? "Uploading private images..." : "Reading each image in order..."}
                  </T>
                </Row>
              ) : null}
              <View style={styles.editorWrap}>
                <T size={type.sm} weight="semibold" color={colors.onSurfaceSecondary}>Editable policy draft</T>
                <TextInput
                  testID="rules-editor"
                  value={text}
                  onChangeText={setText}
                  multiline
                  maxLength={50000}
                  placeholder="Extracted text will appear here. You can also enter rules manually."
                  placeholderTextColor={colors.onSurfaceTertiary}
                  textAlignVertical="top"
                  style={styles.editor}
                  accessibilityLabel="Editable rules and regulations draft"
                />
                <T size={11} color={colors.onSurfaceTertiary}>{text.length}/50000 characters</T>
              </View>
              {uncertainSections.length > 0 ? (
                <Card style={styles.uncertainCard}>
                  <T weight="bold" color={colors.warning}>Please review uncertain text</T>
                  <T size={type.sm} color={colors.onSurfaceSecondary}>
                    OCR marked these passages as unclear. Verify each against the original image before publishing.
                  </T>
                  {uncertainSections.map((section, index) => (
                    <T key={`${index}-${section}`} size={type.sm} color={colors.warning}>• {section}</T>
                  ))}
                </Card>
              ) : null}
              <Row style={{ gap: spacing.sm }}>
                <Btn
                  title="Save draft"
                  icon="save"
                  variant="secondary"
                  onPress={() => void saveDraft()}
                  loading={operation === "draft"}
                  disabled={!text.trim() || operation !== null}
                  style={{ flex: 1 }}
                  testID="rules-save-draft"
                />
                <Btn
                  title="Preview tenant view"
                  icon="eye"
                  variant="ghost"
                  onPress={openPreview}
                  disabled={!text.trim()}
                  style={{ flex: 1 }}
                  testID="rules-preview"
                />
              </Row>
              <Btn
                title="Publish rules"
                icon="checkmark-circle"
                onPress={askToPublish}
                loading={operation === "publishing"}
                disabled={!text.trim() || operation !== null}
                testID="rules-publish"
              />
            </Card>

            <Card style={{ gap: spacing.md }}>
              <View style={{ gap: spacing.xs }}>
                <T weight="extrabold" size={type.lg}>Acknowledgement tracking</T>
                <T size={type.sm} color={colors.onSurfaceSecondary}>
                  Tenant status is loaded from the server for the selected hostel.
                </T>
              </View>
              <Row style={{ gap: spacing.sm }}>
                <ReportStat label="Active tenants" value={reportTotals.total} />
                <ReportStat label="Acknowledged" value={reportTotals.acknowledged} />
                <ReportStat label="Pending" value={reportTotals.pending} />
              </Row>
              <Field
                label="Search active tenants"
                value={search}
                onChangeText={setSearch}
                placeholder="Name, room, or bed"
                testID="rules-report-search"
              />
              <Row style={{ gap: spacing.xs, flexWrap: "wrap" }}>
                {(["All", "Pending", "Acknowledged"] as const).map((item) => (
                  <Pressable key={item} onPress={() => setFilter(item)} style={styles.filter}>
                    <Badge label={item} tone={filter === item ? "brand" : "neutral"} />
                  </Pressable>
                ))}
              </Row>
              {visibleRows.length ? visibleRows.map((row) => (
                <Card key={row.tenant_id} style={styles.reportRow}>
                  <Row style={{ justifyContent: "space-between", alignItems: "flex-start", gap: spacing.sm }}>
                    <View style={{ flex: 1 }}>
                      <T weight="bold">{row.tenant_name}</T>
                      <T size={type.sm} color={colors.onSurfaceSecondary}>
                        {[row.room_number ? `Room ${row.room_number}` : "", row.bed_number ? `Bed ${row.bed_number}` : ""].filter(Boolean).join(" · ") || "Room/bed unavailable"}
                      </T>
                    </View>
                    <Badge label={row.status} tone={row.status === "Acknowledged" ? "success" : row.status === "Pending" ? "warning" : "neutral"} />
                  </Row>
                  <T size={type.sm} color={colors.onSurfaceSecondary}>
                    {row.policy_version ? `Required version ${row.policy_version}` : "No policy version required"}
                  </T>
                  {row.acknowledged_at ? (
                    <T size={type.sm} color={colors.success}>Acknowledged {new Date(row.acknowledged_at).toLocaleString()}</T>
                  ) : null}
                </Card>
              )) : (
                <T size={type.sm} color={colors.onSurfaceSecondary}>
                  {reportRows.length ? "No tenants match this search and filter." : "No active tenants are assigned to this hostel."}
                </T>
              )}
            </Card>

            <Card style={{ gap: spacing.md }}>
              <Pressable onPress={() => setHistoryOpen((open) => !open)} style={styles.historyToggle}>
                <View>
                  <T weight="extrabold" size={type.lg}>Policy and acknowledgement history</T>
                  <T size={type.sm} color={colors.onSurfaceSecondary}>
                    Published versions and saved acknowledgement records are retained.
                  </T>
                </View>
                <Ionicons name={historyOpen ? "chevron-up" : "chevron-down"} size={20} color={colors.onSurfaceSecondary} />
              </Pressable>
              {historyOpen ? (
                <>
                  {history.length === 0 ? <T size={type.sm} color={colors.onSurfaceSecondary}>No published versions yet.</T> : null}
                  {history.map((policy) => (
                    <Pressable
                      key={policy.id}
                      onPress={() => setExpandedVersion((version) => version === policy.version ? null : policy.version)}
                      style={styles.historyItem}
                    >
                      <Row style={{ justifyContent: "space-between" }}>
                        <T weight="bold">Version {policy.version}</T>
                        <T size={11} color={colors.onSurfaceTertiary}>{new Date(policy.published_at).toLocaleString()}</T>
                      </Row>
                      {expandedVersion === policy.version ? (
                        <T size={type.sm} color={colors.onSurfaceSecondary}>{policy.text}</T>
                      ) : (
                        <T size={type.sm} color={colors.onSurfaceSecondary} numberOfLines={2}>{policy.text}</T>
                      )}
                    </Pressable>
                  ))}
                  {reportHistory.length ? (
                    <>
                      <View style={styles.divider} />
                      <T weight="bold">Acknowledgement history</T>
                      {reportHistory.map((record, index) => (
                        <View key={`${record.policy_id}-${record.tenant_id}-${index}`} style={styles.historyItem}>
                          <T size={type.sm} weight="semibold">{record.tenant_name} · Version {record.policy_version}</T>
                          <T size={11} color={colors.onSurfaceTertiary}>
                            {record.acknowledged_at ? new Date(record.acknowledged_at).toLocaleString() : "Timestamp unavailable"}
                          </T>
                        </View>
                      ))}
                    </>
                  ) : null}
                </>
              ) : null}
            </Card>
          </>
        )}
      </ScrollView>

      <Sheet visible={previewOpen} onClose={() => setPreviewOpen(false)} title="Tenant policy preview">
        <Card style={{ gap: spacing.sm }}>
          <T weight="extrabold" size={type.lg}>Rules & Regulations</T>
          {latest ? <T size={type.sm} color={colors.onSurfaceSecondary}>Current version {latest.version}; publishing this draft will create a new version if its text differs.</T> : null}
          <T style={{ lineHeight: 24 }}>{text}</T>
        </Card>
        <Btn title="Publish this policy" icon="checkmark-circle" onPress={askToPublish} loading={operation === "publishing"} disabled={operation !== null} testID="rules-preview-publish" />
      </Sheet>

      <Sheet
        visible={Boolean(originalPreviewItem)}
        onClose={() => setOriginalPreviewItem(null)}
        title={originalPreviewItem?.label || "Original rules image"}
      >
        {originalPreviewLoading ? (
          <ActivityIndicator size="large" color={colors.brand} />
        ) : originalPreviewError ? (
          <Card style={{ gap: spacing.sm }}>
            <T color={colors.error}>{originalPreviewError}</T>
            {originalPreviewItem ? (
              <Btn title="Retry loading image" icon="refresh" variant="secondary" onPress={() => void openOriginalImage(originalPreviewItem)} />
            ) : null}
          </Card>
        ) : originalPreviewUri ? (
          <Image
            source={{ uri: originalPreviewUri }}
            style={styles.originalPreview}
            contentFit="contain"
            accessibilityLabel="Original uploaded PG rules image"
          />
        ) : null}
      </Sheet>
    </Screen>
  );
}

function ReportStat({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.stat}>
      <T size={type.xl} weight="extrabold" color={colors.brand}>{value}</T>
      <T size={11} color={colors.onSurfaceSecondary}>{label}</T>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, paddingBottom: spacing["3xl"], gap: spacing.md },
  errorCard: { gap: spacing.sm, borderColor: colors.error, backgroundColor: "#FFF7F7" },
  imageList: { gap: spacing.sm },
  imageItem: {
    minHeight: 64,
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSecondary,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  thumbnail: { width: 48, height: 48, borderRadius: radius.sm, backgroundColor: colors.surfaceTertiary },
  originalImageButton: { borderRadius: radius.sm },
  originalPreview: { width: "100%", height: 480, backgroundColor: colors.surfaceSecondary },
  savedThumbnail: { alignItems: "center", justifyContent: "center" },
  removeButton: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  editorWrap: { gap: spacing.xs },
  editor: {
    minHeight: 240,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    color: colors.onSurface,
    padding: spacing.md,
    fontSize: type.base,
    lineHeight: 22,
    textAlignVertical: "top",
  },
  uncertainCard: { gap: spacing.xs, backgroundColor: "#FFFBEB", borderColor: "#FDE68A" },
  stat: { flex: 1, minHeight: 76, justifyContent: "center", gap: 2, padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.brandTertiary },
  filter: { minHeight: 40, justifyContent: "center" },
  reportRow: { gap: spacing.xs, padding: spacing.md },
  historyToggle: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  historyItem: { gap: spacing.xs, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
  divider: { height: 1, backgroundColor: colors.divider },
});
