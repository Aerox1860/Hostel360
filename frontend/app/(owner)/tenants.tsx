import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, FlatList, Pressable, Image, Platform, StyleSheet, Alert } from "react-native";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import { Screen, AppHeader, T, Card, Row, Badge, LoadingView, EmptyState, Sheet, Btn, Field, Chip } from "@/src/components/ui";
import { useOwnerHostel } from "@/src/context/OwnerHostelContext";
import { api } from "@/src/api/client";
import { useToast } from "@/src/components/Toast";
import { colors, spacing, type, radius } from "@/src/theme";
import { tenantDocumentImageUri } from "@/src/utils/tenantDocumentImage";
import { openTenantReportEvidence } from "@/src/utils/tenantReportEvidence";
import { reportDate, reportStatusLabel, reportStatusTone } from "@/src/utils/globalHistory";

type TenantDocumentKind = "aadhaar_front" | "aadhaar_back" | "selfie";
type SelectedDocument = ImagePicker.ImagePickerAsset | null;
type SelectedReportEvidence = {
  uri: string;
  name: string;
  mimeType: string;
  size?: number;
} | null;
type HistoryReport = {
  id: string;
  previous_hostel?: string | null;
  amount?: number | null;
  category?: string | null;
  reported_at?: string | null;
  status?: string | null;
  evidence_summary?: string | null;
  evidence_documents?: { id: string; filename: string; content_type: string; size: number; uploaded_at?: string }[];
  details_available?: boolean;
  details?: string | null;
  tenant_response?: { text?: string; created_at?: string } | null;
  stay_start_date?: string | null;
  vacated_at?: string | null;
};

type TenantReport = HistoryReport & {
  title?: string;
  amount_claimed?: number;
  outstanding_balance?: number;
  status_note?: string | null;
  tenant_response?: { text?: string; created_at?: string } | null;
  settlements?: { entry_type: string; amount: number; note?: string | null; created_at?: string }[];
};

const tenantReportCategories = [
  { value: "unpaid_rent", label: "Unpaid rent" },
  { value: "pending_utilities", label: "Pending utility bills" },
  { value: "property_damage", label: "Property damage" },
  { value: "unpaid_agreed_charges", label: "Unpaid agreed charges" },
  { value: "other", label: "Other legitimate issue" },
] as const;

function reportCategoryLabel(category?: string | null) {
  return tenantReportCategories.find((item) => item.value === category)?.label || category || "Unspecified category";
}

const tenantDocumentLabels: Record<TenantDocumentKind, string> = {
  aadhaar_front: "Aadhaar front (optional)",
  aadhaar_back: "Aadhaar back (optional)",
  selfie: "Tenant selfie (optional)",
};

function dateOnly(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export default function Tenants() {
  const toastShow = useToast().show;
  const { activeId, activeHostel } = useOwnerHostel();
  const [tenants, setTenants] = useState<any[]>([]);
  const [rooms, setRooms] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [manage, setManage] = useState<any>(null);
  const [transferOpen, setTransferOpen] = useState<any>(null);
  const [tenantDetails, setTenantDetails] = useState<any>(null);
  const [tenantReports, setTenantReports] = useState<TenantReport[]>([]);
  const [reportSettlementAmounts, setReportSettlementAmounts] = useState<Record<string, string>>({});
  const [reportActionId, setReportActionId] = useState("");
  const [evidenceLoadingId, setEvidenceLoadingId] = useState("");
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [tenantActionIds, setTenantActionIds] = useState<Set<string>>(() => new Set());
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => new Date());
  const [documentPreview, setDocumentPreview] = useState("");
  const [documentPreviewOpen, setDocumentPreviewOpen] = useState(false);
  const [documentPreviewLoading, setDocumentPreviewLoading] = useState(false);
  const [documentImageLoading, setDocumentImageLoading] = useState(false);
  const [documentPreviewError, setDocumentPreviewError] = useState("");
  const [documentPreviewKind, setDocumentPreviewKind] = useState<TenantDocumentKind | null>(null);
  const documentImageTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const documentRequestId = useRef(0);
  const detailsRequestId = useRef(0);
  const tenantListRequestId = useRef(0);
  const detailsLoadingRef = useRef(false);
  const openingTenantId = useRef("");
  const loadedHostelId = useRef("");
  const tenantActionLocks = useRef(new Set<string>());

  // add form
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [email, setEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [rent, setRent] = useState("");
  const [deposit, setDeposit] = useState("");
  const [advance, setAdvance] = useState("");
  const [roomId, setRoomId] = useState("");
  const [bed, setBed] = useState("");
  const [joiningDate, setJoiningDate] = useState(() => dateOnly(new Date()));
  const [aadhaarNumber, setAadhaarNumber] = useState("");
  const [aadhaarCheckStatus, setAadhaarCheckStatus] = useState<"idle" | "checking" | "available" | "duplicate">("idle");
  const [aadhaarCheckMessage, setAadhaarCheckMessage] = useState("");
  const aadhaarCheckValue = useRef("");
  const [documents, setDocuments] = useState<Record<TenantDocumentKind, SelectedDocument>>({
    aadhaar_front: null,
    aadhaar_back: null,
    selfie: null,
  });
  const [createLogin, setCreateLogin] = useState(false);
  const [historyCode, setHistoryCode] = useState("");
  const [historyGrantId, setHistoryGrantId] = useState("");
  const [historyReports, setHistoryReports] = useState<HistoryReport[]>([]);
  const [historyLookupLoading, setHistoryLookupLoading] = useState(false);
  const [historyLookupError, setHistoryLookupError] = useState("");
  const [reportOpen, setReportOpen] = useState(false);
  const [reportCategory, setReportCategory] = useState("");
  const [reportAmount, setReportAmount] = useState("");
  const [reportDetails, setReportDetails] = useState("");
  const [reportEvidenceSummary, setReportEvidenceSummary] = useState("");
  const [reportEvidenceAsset, setReportEvidenceAsset] = useState<SelectedReportEvidence>(null);
  const [reportSaving, setReportSaving] = useState(false);
  const reportSavingRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [savingStage, setSavingStage] = useState("");
  const savingRef = useRef(false);
  const historyLookupRequestId = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++tenantListRequestId.current;
    if (!activeId) {
      loadedHostelId.current = "";
      setTenants([]);
      setRooms([]);
      setLoading(false);
      return;
    }
    if (loadedHostelId.current !== activeId) {
      loadedHostelId.current = activeId;
      setTenants([]);
      setRooms([]);
    }
    try {
      const hostelId = encodeURIComponent(activeId);
      const [t, r] = await Promise.all([
        api.get<{ tenants: any[] }>(`/owner/tenants?hostel_id=${hostelId}`),
        api.get<{ rooms: any[] }>(`/owner/rooms?hostel_id=${hostelId}`),
      ]);
      if (requestId !== tenantListRequestId.current) return;
      setTenants(t.tenants);
      setRooms(r.rooms);
    } catch (error) {
      if (requestId === tenantListRequestId.current) {
        toastShow(error instanceof Error ? error.message : "Could not refresh tenant and room details.", "error");
      }
    } finally {
      if (requestId === tenantListRequestId.current) setLoading(false);
    }
  }, [activeId, toastShow]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const availableRooms = rooms.filter((r) => r.beds.some((b: any) => b.status === "available"));
  const selectedRoom = rooms.find((r) => r.id === roomId);
  const activeTenantCount = useMemo(() => tenants.filter((tenant) => tenant.active).length, [tenants]);

  const pickRoom = (r: any) => {
    setRoomId(r.id);
    setBed("");
    if (!rent) setRent(String(r.rent));
  };

  const resetForm = () => {
    setName(""); setMobile(""); setEmail(""); setLoginPassword(""); setRent(""); setDeposit(""); setAdvance("");
    setRoomId(""); setBed(""); setJoiningDate(dateOnly(new Date())); setAadhaarNumber("");
    setAadhaarCheckStatus("idle"); setAadhaarCheckMessage(""); aadhaarCheckValue.current = "";
    setDocuments({ aadhaar_front: null, aadhaar_back: null, selfie: null }); setCreateLogin(false);
    setHistoryCode(""); setHistoryGrantId(""); setHistoryReports([]); setHistoryLookupError("");
  };

  const lookupHistory = async () => {
    const code = historyCode.trim();
    if (!code) {
      setHistoryLookupError("Enter the share code the tenant provided.");
      return;
    }
    const requestId = ++historyLookupRequestId.current;
    setHistoryLookupLoading(true);
    setHistoryLookupError("");
    setHistoryGrantId("");
    setHistoryReports([]);
    try {
      const response = await api.post<{ grant_id: string; reports: HistoryReport[] }>("/owner/tenant-history/lookup", { code });
      if (requestId !== historyLookupRequestId.current) return;
      if (!response.grant_id) throw new Error("The lookup did not return an admission grant.");
      setHistoryGrantId(response.grant_id);
      setHistoryReports(Array.isArray(response.reports) ? response.reports : []);
    } catch (error) {
      if (requestId !== historyLookupRequestId.current) return;
      setHistoryLookupError(error instanceof Error ? error.message : "Could not look up the shared history.");
    } finally {
      if (requestId === historyLookupRequestId.current) setHistoryLookupLoading(false);
    }
  };

  const checkAadhaar = async () => {
    const normalized = aadhaarNumber.replace(/[\s-]/g, "");
    if (!/^\d{12}$/.test(normalized)) {
      setAadhaarCheckStatus("idle");
      setAadhaarCheckMessage("Enter a valid 12-digit Aadhaar number.");
      return false;
    }
    setAadhaarCheckStatus("checking");
    setAadhaarCheckMessage("");
    try {
      await api.post<{ available: boolean }>(
        `/owner/tenants/check-aadhaar?hostel_id=${encodeURIComponent(activeId || "")}`,
        { aadhaar_number: aadhaarNumber },
      );
      aadhaarCheckValue.current = normalized;
      setAadhaarCheckStatus("available");
      setAadhaarCheckMessage("Aadhaar number is available for registration.");
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not check this Aadhaar number.";
      setAadhaarCheckStatus(message.toLowerCase().includes("already registered") ? "duplicate" : "idle");
      setAadhaarCheckMessage(message);
      return false;
    }
  };

  const pickDocument = async (kind: TenantDocumentKind) => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        toastShow("Allow photo library access to select an image.", "error");
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: false,
        quality: 0.85,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      const mimeType = asset.mimeType?.toLowerCase();
      if (mimeType && !["image/jpeg", "image/png", "image/webp"].includes(mimeType)) {
        toastShow("Choose a JPG, PNG, or WebP image.", "error");
        return;
      }
      if (asset.fileSize !== undefined && asset.fileSize > 10 * 1024 * 1024) {
        toastShow("Images must be 10 MB or smaller.", "error");
        return;
      }
      setDocuments((current) => ({ ...current, [kind]: asset }));
    } catch (error) {
      toastShow(error instanceof Error ? error.message : "Could not open the photo library.", "error");
    }
  };

  const uploadDocument = async (kind: TenantDocumentKind, asset: ImagePicker.ImagePickerAsset) => {
    const namedExtension = asset.fileName?.split(".").pop()?.toLowerCase();
    const extension = asset.mimeType?.toLowerCase() === "image/png" || namedExtension === "png"
      ? "png"
      : asset.mimeType?.toLowerCase() === "image/webp" || namedExtension === "webp"
        ? "webp"
        : "jpg";
    const fileName = asset.fileName || `tenant-${kind}.${extension}`;
    const mimeType = asset.mimeType || `image/${extension === "jpg" ? "jpeg" : extension}`;
    const path = `/owner/tenant-documents?hostel_id=${encodeURIComponent(activeId || "")}&kind=${kind}`;
    if (Platform.OS !== "web") {
      return api.uploadNativeFile<{ upload_id: string }>(path, asset.uri, fileName, mimeType);
    }
    const response = await fetch(asset.uri);
    if (!response.ok) throw new Error("Could not read the selected image.");
    const form = new FormData();
    form.append("file", await response.blob(), fileName);
    return api.upload<{ upload_id: string }>(path, form);
  };

  const save = async () => {
    if (savingRef.current) return;
    if (!name || !mobile || !roomId || !bed || !rent) {
      toastShow("Fill name, mobile, room, bed and rent", "error");
      return;
    }
    if (!/^\+?[\d\s()-]+$/.test(mobile.trim()) || mobile.replace(/\D/g, "").length !== 10) {
      toastShow("Enter a valid 10-digit mobile number.", "error");
      return;
    }
    if (aadhaarNumber && !/^(?:\d[\s-]?){11}\d$/.test(aadhaarNumber.trim())) {
      toastShow("Enter a valid 12-digit Aadhaar number or leave it blank.", "error");
      return;
    }
    if (aadhaarNumber && aadhaarCheckValue.current !== aadhaarNumber.replace(/[\s-]/g, "")) {
      const available = await checkAadhaar();
      if (!available) {
        toastShow("Aadhaar number is already registered or could not be checked.", "error");
        return;
      }
    }
    if (createLogin && (!email || loginPassword.length < 8 || loginPassword.length > 72)) {
      toastShow("Enter an email and a password between 8 and 72 characters.", "error");
      return;
    }
    savingRef.current = true;
    setSaving(true);
    const stagedUploads: string[] = [];
    try {
      let admissionGrantId = historyGrantId;
      if (!admissionGrantId && email.trim()) {
        setSavingStage("Checking verified, consented global history...");
        const history = await api.post<{ grant_id: string | null; reports: HistoryReport[] }>(
          `/owner/tenant-history/automatic-lookup?hostel_id=${encodeURIComponent(activeId || "")}`,
          { email: email.trim() },
        );
        if (history.grant_id) {
          admissionGrantId = history.grant_id;
          setHistoryGrantId(history.grant_id);
          setHistoryReports(Array.isArray(history.reports) ? history.reports : []);
          if (history.reports.length > 0) {
            toastShow("Previous hostel reports found. Review the alert before adding this tenant.", "error");
            return;
          }
        }
      }
      const documentRefs: Partial<Record<TenantDocumentKind, string>> = {};
      for (const kind of ["aadhaar_front", "aadhaar_back", "selfie"] as const) {
        const asset = documents[kind];
        if (!asset) continue;
        setSavingStage(`Uploading ${tenantDocumentLabels[kind].replace(" (optional)", "").toLowerCase()}...`);
        const uploaded = await uploadDocument(kind, asset);
        stagedUploads.push(uploaded.upload_id);
        documentRefs[kind] = uploaded.upload_id;
      }
      setSavingStage("Saving tenant details...");
      await api.post<{ tenant: unknown }>("/owner/tenants", {
        hostel_id: activeId,
        name, mobile, email: email || undefined, room_id: roomId, bed_number: bed,
        joining_date: joiningDate, aadhaar_number: aadhaarNumber || undefined, documents: documentRefs,
        monthly_rent: parseInt(rent) || 0,
        security_deposit: parseInt(deposit) || 0, advance_amount: parseInt(advance) || 0,
        create_login: createLogin, password: createLogin ? loginPassword : undefined,
        history_grant_id: admissionGrantId || undefined,
      });
      toastShow("Tenant added");
      setAddOpen(false);
      resetForm();
      await load();
    } catch (e: any) {
      const cleanup = await Promise.allSettled(stagedUploads.map((id) => api.del(`/owner/tenant-documents/${id}`)));
      const cleanupFailed = cleanup.some((result) => result.status === "rejected");
      const message = e instanceof Error ? e.message : "Could not add tenant.";
      if (message.toLowerCase().includes("already registered")) {
        setAadhaarCheckStatus("duplicate");
        setAadhaarCheckMessage(message);
      }
      toastShow(cleanupFailed ? `${message} Some temporary uploads could not be cleaned up.` : message, "error");
    } finally {
      savingRef.current = false;
      setSaving(false);
      setSavingStage("");
    }
  };

  const openManage = async (tenant: any) => {
    if (!tenant?.id || (openingTenantId.current === tenant.id && detailsLoadingRef.current)) return;
    if (openingTenantId.current === tenant.id && tenantDetails && !detailsLoading) return;
    const requestId = ++detailsRequestId.current;
    openingTenantId.current = tenant.id;
    detailsLoadingRef.current = true;
    setManage(tenant);
    setTenantDetails(null);
    setTenantReports([]);
    setDetailsLoading(true);
    try {
      const [detailsResult, reportsResult] = await Promise.allSettled([
        api.get<{ tenant: any; hostel: any; room: any; documents: Record<string, any> }>(`/owner/tenants/${tenant.id}`),
        api.get<{ reports: TenantReport[] }>(`/owner/tenants/${tenant.id}/reports`),
      ]);
      if (requestId !== detailsRequestId.current) return;
      let failed = false;
      if (detailsResult.status === "fulfilled") {
        setTenantDetails(detailsResult.value);
      } else {
        failed = true;
        toastShow(detailsResult.reason instanceof Error ? detailsResult.reason.message : "Could not load tenant details.", "error");
      }
      if (reportsResult.status === "fulfilled") {
        setTenantReports(reportsResult.value.reports || []);
      } else {
        failed = true;
        toastShow(reportsResult.reason instanceof Error ? reportsResult.reason.message : "Could not load tenant reports.", "error");
      }
      if (failed) openingTenantId.current = "";
    } finally {
      if (requestId === detailsRequestId.current) {
        detailsLoadingRef.current = false;
        setDetailsLoading(false);
      }
    }
  };

  const closeManage = () => {
    detailsRequestId.current += 1;
    detailsLoadingRef.current = false;
    openingTenantId.current = "";
    if (documentPreviewOpen) {
      closeDocumentPreview();
      return;
    }
    setManage(null);
    setTenantDetails(null);
    setTenantReports([]);
  };

  const openReportForm = () => {
    setReportCategory("");
    setReportAmount("");
    setReportDetails("");
    setReportEvidenceSummary("");
    setReportEvidenceAsset(null);
    setReportOpen(true);
  };

  const changeReportStatus = async (reportId: string, status: string) => {
    if (reportActionId) return;
    setReportActionId(reportId);
    try {
      await api.put(`/owner/tenant-reports/${encodeURIComponent(reportId)}/status`, { status });
      const response = await api.get<{ reports: TenantReport[] }>(`/owner/tenants/${manage.id}/reports`);
      setTenantReports(response.reports || []);
    } catch (error) {
      toastShow(error instanceof Error ? error.message : "Could not update report status.", "error");
    } finally {
      setReportActionId("");
    }
  };

  const settleReport = async (reportId: string) => {
    if (reportActionId) return;
    const amount = Number(reportSettlementAmounts[reportId]);
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      toastShow("Enter a valid settlement amount.", "error");
      return;
    }
    setReportActionId(reportId);
    try {
      await api.post(`/owner/tenant-reports/${encodeURIComponent(reportId)}/settlements`, { amount });
      setReportSettlementAmounts((current) => ({ ...current, [reportId]: "" }));
      const response = await api.get<{ reports: TenantReport[] }>(`/owner/tenants/${manage.id}/reports`);
      setTenantReports(response.reports || []);
    } catch (error) {
      toastShow(error instanceof Error ? error.message : "Could not record the settlement.", "error");
    } finally {
      setReportActionId("");
    }
  };

  const viewReportEvidence = async (report: TenantReport, evidence: NonNullable<TenantReport["evidence_documents"]>[number]) => {
    if (evidenceLoadingId) return;
    setEvidenceLoadingId(evidence.id);
    try {
      await openTenantReportEvidence(report.id, evidence);
    } catch (error) {
      toastShow(error instanceof Error ? error.message : "Could not open the private evidence document.", "error");
    } finally {
      setEvidenceLoadingId("");
    }
  };

  const openDocument = async (kind: TenantDocumentKind) => {
    if (!manage) return;
    const requestId = ++documentRequestId.current;
    if (documentImageTimeout.current) clearTimeout(documentImageTimeout.current);
    documentImageTimeout.current = null;
    setDocumentPreviewKind(kind);
    setDocumentPreview("");
    setDocumentPreviewError("");
    setDocumentImageLoading(false);
    setDocumentPreviewOpen(true);
    setDocumentPreviewLoading(true);
    try {
      const path = `/owner/tenants/${manage.id}/documents/${kind}`;
      const blob = await api.getBlob(path);
      if (requestId !== documentRequestId.current) return;
      const imageUri = await tenantDocumentImageUri(blob, Platform.OS === "web");
      if (requestId !== documentRequestId.current) {
        if (Platform.OS === "web") URL.revokeObjectURL(imageUri);
        return;
      }
      setDocumentPreview(imageUri);
      setDocumentImageLoading(true);
      documentImageTimeout.current = setTimeout(() => {
        documentImageTimeout.current = null;
        setDocumentImageLoading(false);
        setDocumentPreviewError("The image is taking too long to display. Try again.");
      }, 15000);
    } catch (error) {
      if (requestId !== documentRequestId.current) return;
      const message = error instanceof Error ? error.message : "Could not open tenant document.";
      setDocumentPreviewError(message);
      toastShow(message, "error");
    } finally {
      if (requestId === documentRequestId.current) setDocumentPreviewLoading(false);
    }
  };

  const closeDocumentPreview = () => {
    documentRequestId.current += 1;
    if (documentImageTimeout.current) clearTimeout(documentImageTimeout.current);
    documentImageTimeout.current = null;
    setDocumentImageLoading(false);
    setDocumentPreviewOpen(false);
    setDocumentPreview("");
    setDocumentPreviewError("");
    setDocumentPreviewKind(null);
  };

  useEffect(() => () => {
    if (Platform.OS === "web" && documentPreview) URL.revokeObjectURL(documentPreview);
  }, [documentPreview]);

  useEffect(() => () => {
    if (documentImageTimeout.current) clearTimeout(documentImageTimeout.current);
  }, []);

  const confirmAction = (title: string, message: string) => new Promise<boolean>((resolve) => {
    if (Platform.OS === "web") {
      resolve(typeof window !== "undefined" && window.confirm(`${title}\n\n${message}`));
      return;
    }
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
      { text: "Confirm", style: "destructive", onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) });
  });

  const updateTenantBed = (tenant: any, nextRoomId: string | null, nextBedNumber: string | null) => {
    setRooms((current) => current.map((room) => ({
      ...room,
      beds: room.beds.map((bed: any) => {
        if (room.id === tenant.room_id && bed.bed_number === tenant.bed_number && bed.tenant_id === tenant.id) {
          return { ...bed, status: "available", tenant_id: null };
        }
        if (nextRoomId && nextBedNumber && room.id === nextRoomId && bed.bed_number === nextBedNumber) {
          return { ...bed, status: "occupied", tenant_id: tenant.id };
        }
        return bed;
      }),
    })));
  };

  const beginTenantAction = (tenantId: string) => {
    if (tenantActionLocks.current.has(tenantId)) return false;
    tenantActionLocks.current.add(tenantId);
    setTenantActionIds(new Set(tenantActionLocks.current));
    return true;
  };

  const finishTenantAction = (tenantId: string) => {
    tenantActionLocks.current.delete(tenantId);
    setTenantActionIds(new Set(tenantActionLocks.current));
  };

  const checkout = async (tenant: any) => {
    if (!tenant?.id || !beginTenantAction(tenant.id)) return;
    try {
      if (!await confirmAction("Check out tenant", `Check out ${tenant.name}? Their membership and payment history will be preserved.`)) return;
      await api.post(`/owner/tenants/${tenant.id}/checkout`);
      updateTenantBed(tenant, null, null);
      setTenants((current) => current.map((item) => item.id === tenant.id
        ? { ...item, active: false, payment_status: item.payment_status }
        : item));
      toastShow("Tenant checked out");
      detailsRequestId.current += 1;
      openingTenantId.current = "";
      setManage(null);
    } catch (e: any) { toastShow(e.message || "Could not check out tenant.", "error"); }
    finally { finishTenantAction(tenant.id); }
  };
  const del = async (tenant: any) => {
    if (!tenant?.id || !beginTenantAction(tenant.id)) return;
    try {
      if (!await confirmAction("Archive tenant record", `Archive ${tenant.name}? This preserves their payments, reports, and membership history.`)) return;
      await api.del(`/owner/tenants/${tenant.id}`);
      if (tenant.active) updateTenantBed(tenant, null, null);
      setTenants((current) => current.filter((item) => item.id !== tenant.id));
      toastShow("Tenant record archived; history was preserved.");
      detailsRequestId.current += 1;
      openingTenantId.current = "";
      setManage(null);
    } catch (e: any) { toastShow(e.message || "Could not archive tenant record.", "error"); }
    finally { finishTenantAction(tenant.id); }
  };
  const doTransfer = async (rid: string, bn: string) => {
    const tenant = transferOpen;
    if (!tenant?.id || !beginTenantAction(tenant.id)) return;
    try {
      const result = await api.post<{ tenant: any }>(`/owner/tenants/${tenant.id}/transfer`, { room_id: rid, bed_number: bn });
      updateTenantBed(tenant, rid, bn);
      setTenants((current) => current.map((item) => item.id === tenant.id ? { ...item, ...result.tenant } : item));
      toastShow("Tenant transferred");
      setTransferOpen(null);
      setManage((current: any) => current?.id === tenant.id ? { ...current, ...result.tenant } : current);
      const destinationRoom = rooms.find((room) => room.id === rid);
      setTenantDetails((current: any) => current?.tenant?.id === tenant.id
        ? {
          ...current,
          tenant: result.tenant,
          room: {
            ...current.room,
            floor: destinationRoom?.floor ?? current.room?.floor,
            room_number: result.tenant.room_number,
          },
        }
        : current);
    } catch (e: any) { toastShow(e.message || "Could not transfer tenant.", "error"); }
    finally { finishTenantAction(tenant.id); }
  };

  const pickReportEvidence = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["application/pdf", "image/jpeg", "image/png", "image/webp"],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      const mimeType = asset.mimeType?.toLowerCase() || "";
      if (!["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(mimeType)) {
        toastShow("Choose a PDF, JPG, PNG, or WebP evidence document.", "error");
        return;
      }
      if (asset.size !== undefined && asset.size > 10 * 1024 * 1024) {
        toastShow("Evidence documents must be 10 MB or smaller.", "error");
        return;
      }
      setReportEvidenceAsset({
        uri: asset.uri,
        name: asset.name,
        mimeType,
        size: asset.size,
      });
    } catch (error) {
      toastShow(error instanceof Error ? error.message : "Could not select evidence.", "error");
    }
  };

  const submitReport = async () => {
    if (!manage?.id || reportSavingRef.current) return;
    const amount = reportAmount.trim() ? Number(reportAmount) : 0;
    const category = tenantReportCategories.find((item) => item.value === reportCategory);
    if (!category || !reportDetails.trim() || !Number.isSafeInteger(amount) || amount < 0) {
      toastShow("Choose a category, enter details, and provide a valid non-negative amount.", "error");
      return;
    }
    const tenantId = manage.id;
    reportSavingRef.current = true;
    setReportSaving(true);
    let createdReportId = "";
    try {
      const result = await api.post<{ report: { id: string } }>(`/owner/tenants/${encodeURIComponent(tenantId)}/reports`, {
        category: category.value,
        title: category.label,
        description: reportDetails.trim(),
        amount_claimed: amount,
        evidence_summary: reportEvidenceSummary.trim() || undefined,
      });
      createdReportId = result.report.id;
      if (reportEvidenceAsset) {
        const asset = reportEvidenceAsset;
        const path = `/owner/tenant-reports/${encodeURIComponent(createdReportId)}/evidence`;
        if (Platform.OS !== "web") {
          await api.uploadNativeFile(path, asset.uri, asset.name, asset.mimeType);
        } else {
          const response = await fetch(asset.uri);
          if (!response.ok) throw new Error("The report was saved, but the selected evidence could not be read.");
          const form = new FormData();
          form.append("file", await response.blob(), asset.name);
          await api.upload(path, form);
        }
      }
      const reportResponse = await api.get<{ reports: TenantReport[] }>(`/owner/tenants/${encodeURIComponent(tenantId)}/reports`);
      setTenantReports(reportResponse.reports || []);
      toastShow("Report submitted as an unverified allegation.");
      setReportOpen(false);
      setReportCategory("");
      setReportAmount("");
      setReportDetails("");
      setReportEvidenceSummary("");
      setReportEvidenceAsset(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not submit the report.";
      if (createdReportId) {
        setReportOpen(false);
        setReportCategory("");
        setReportAmount("");
        setReportDetails("");
        setReportEvidenceSummary("");
        setReportEvidenceAsset(null);
        try {
          const reportResponse = await api.get<{ reports: TenantReport[] }>(`/owner/tenants/${encodeURIComponent(tenantId)}/reports`);
          setTenantReports(reportResponse.reports || []);
        } catch {
          toastShow("The report was submitted, but the report list could not be refreshed. Reopen the tenant details to confirm it.", "error");
          return;
        }
        toastShow(`The report was submitted, but an additional step failed: ${message}`, "error");
        return;
      }
      toastShow(message, "error");
    } finally {
      reportSavingRef.current = false;
      setReportSaving(false);
    }
  };

  if (loading) return <Screen><LoadingView /></Screen>;

  return (
    <Screen edges={["top"]}>
      <AppHeader
        title="Tenants"
        subtitle={activeHostel?.name || `${activeTenantCount} active`}
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
        initialNumToRender={10}
        maxToRenderPerBatch={10}
        windowSize={7}
        updateCellsBatchingPeriod={50}
        removeClippedSubviews={Platform.OS === "android"}
        extraData={tenantActionIds}
        ListEmptyComponent={<View style={{ flex: 1 }}><EmptyState icon="people-outline" title="No tenants yet" subtitle="Add tenants and allocate them to beds." ctaLabel="Add Tenant" onCta={() => setAddOpen(true)} /></View>}
        renderItem={({ item }) => (
          <Card testID={`tenant-${item.id}`} style={{ gap: spacing.sm, opacity: item.active ? 1 : 0.6 }}>
            <Pressable
              testID={`open-tenant-${item.id}`}
              accessibilityRole="button"
              accessibilityLabel={`Open ${item.name} details`}
              disabled={tenantActionIds.has(item.id)}
              onPress={() => void openManage(item)}
              style={{ borderRadius: radius.sm }}
            >
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
            </Pressable>
            {item.active ? (
              <Btn title="More / Details" variant="secondary" icon="ellipsis-horizontal" onPress={() => void openManage(item)} disabled={tenantActionIds.has(item.id)} testID={`manage-tenant-${item.id}`} />
            ) : (
              <Btn title="Archive record" variant="danger" icon="archive-outline" onPress={() => void del(item)} loading={tenantActionIds.has(item.id)} disabled={tenantActionIds.has(item.id)} testID={`del-tenant-${item.id}`} />
            )}
          </Card>
        )}
      />

      {/* Add tenant */}
      <Sheet visible={addOpen} onClose={() => {
        historyLookupRequestId.current += 1;
        setHistoryLookupLoading(false);
        setAddOpen(false);
        setAadhaarNumber("");
        setAadhaarCheckStatus("idle");
        setAadhaarCheckMessage("");
        aadhaarCheckValue.current = "";
        setDocuments({ aadhaar_front: null, aadhaar_back: null, selfie: null });
        setHistoryCode("");
        setHistoryGrantId("");
        setHistoryReports([]);
        setHistoryLookupError("");
      }} title="Add Tenant">
        <Field label="Full name *" value={name} onChangeText={setName} placeholder="Tenant name" autoCapitalize="words" testID="t-name" />
        <Field label="Mobile *" value={mobile} onChangeText={setMobile} placeholder="10-digit mobile" keyboardType="phone-pad" testID="t-mobile" />
        <Field label="Email (for login or verified history lookup)" value={email} onChangeText={(value) => {
          setEmail(value);
          setHistoryGrantId("");
          setHistoryReports([]);
          setHistoryLookupError("");
        }} placeholder="tenant@email.com" keyboardType="email-address" testID="t-email" />

        <Pressable testID="t-joining-date" accessibilityRole="button" onPress={() => {
          setCalendarMonth(new Date(`${joiningDate}T00:00:00`));
          setCalendarOpen(true);
        }} style={formStyles.dateField}>
          <View style={{ flex: 1 }}>
            <T size={type.sm} color={colors.onSurfaceSecondary}>Joining date *</T>
            <T weight="semibold">{new Date(`${joiningDate}T00:00:00`).toLocaleDateString()}</T>
          </View>
          <Ionicons name="calendar-outline" size={20} color={colors.brand} />
        </Pressable>
        <Field label="Aadhaar number (optional)" value={aadhaarNumber} onChangeText={(value) => {
          setAadhaarNumber(value);
          setAadhaarCheckStatus("idle");
          setAadhaarCheckMessage("");
          aadhaarCheckValue.current = "";
        }} placeholder="12 digits" keyboardType="numeric" maxLength={14} testID="t-aadhaar" />
        <Btn
          title="Check Aadhaar"
          variant="secondary"
          icon="search"
          onPress={() => void checkAadhaar()}
          loading={aadhaarCheckStatus === "checking"}
          disabled={saving || aadhaarCheckStatus === "checking" || !aadhaarNumber.trim()}
          testID="t-aadhaar-check"
        />
        {aadhaarCheckMessage ? (
          <View testID="t-aadhaar-check-result">
            <T size={type.sm} color={aadhaarCheckStatus === "available" ? colors.success : aadhaarCheckStatus === "duplicate" ? colors.error : colors.onSurfaceSecondary}>
              {aadhaarCheckMessage}
            </T>
          </View>
        ) : null}
        <T size={type.sm} color={colors.onSurfaceSecondary}>
          Aadhaar images are optional. Hostel360 uses a protected identifier to check for platform-wide duplicates; the full Aadhaar number is not retained.
        </T>
        {(["aadhaar_front", "aadhaar_back", "selfie"] as const).map((kind) => {
          const asset = documents[kind];
          return (
            <View key={kind} style={formStyles.documentBlock}>
              <T size={type.sm} weight="semibold">{tenantDocumentLabels[kind]}</T>
              <Row style={{ gap: spacing.sm }}>
                {asset ? <Image source={{ uri: asset.uri }} style={formStyles.documentPreview} /> : null}
                <Pressable
                  testID={`t-document-${kind}`}
                  accessibilityRole="button"
                  disabled={saving}
                  onPress={() => pickDocument(kind)}
                  style={formStyles.documentButton}
                >
                  <Ionicons name={asset ? "checkmark-circle" : "cloud-upload-outline"} size={20} color={colors.brand} />
                  <T size={type.sm} color={colors.brand} weight="semibold">{asset ? "Change image" : "Choose image"}</T>
                </Pressable>
                {asset ? (
                  <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${tenantDocumentLabels[kind]}`} onPress={() => setDocuments((current) => ({ ...current, [kind]: null }))} hitSlop={10}>
                    <Ionicons name="close-circle" size={22} color={colors.error} />
                  </Pressable>
                ) : null}
              </Row>
              {asset ? <T size={type.sm} color={colors.onSurfaceSecondary}>{asset.fileName || "Image selected"}{asset.fileSize ? ` · ${(asset.fileSize / (1024 * 1024)).toFixed(1)} MB` : ""}</T> : null}
            </View>
          );
        })}

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
            <T style={{ flex: 1 }}>Create tenant login</T>
          </Row>
        </Pressable>
        {createLogin ? (
          <Field
            label="Temporary login password *"
            value={loginPassword}
            onChangeText={setLoginPassword}
            placeholder="At least 8 characters"
            secureTextEntry
            autoCapitalize="none"
            testID="t-login-password"
          />
        ) : null}

        <Card testID="tenant-history-lookup" style={{ gap: spacing.sm }}>
          <T weight="bold">Secure previous-hostel history check</T>
          <T size={type.sm} color={colors.onSurfaceSecondary}>
            Before adding the tenant, Hostel360 checks for a verified Google identity that separately opted into automatic history sharing. Email alone never returns reports. A one-time tenant-shared code remains available as an alternative.
          </T>
          {historyGrantId && historyReports.length === 0 ? (
            <T size={type.sm} color={colors.success}>No previous reports were returned for this authorized lookup.</T>
          ) : null}
          <Field
            label="Tenant share code"
            value={historyCode}
            onChangeText={(value) => {
              historyLookupRequestId.current += 1;
              setHistoryLookupLoading(false);
              setHistoryCode(value);
              setHistoryGrantId("");
              setHistoryReports([]);
              setHistoryLookupError("");
            }}
            placeholder="Paste the code provided by the tenant"
            maxLength={128}
            testID="tenant-history-code"
          />
          <Btn
            title="Look up shared history"
            variant="secondary"
            icon="search"
            onPress={lookupHistory}
            loading={historyLookupLoading}
            disabled={historyLookupLoading || !historyCode.trim()}
            testID="tenant-history-lookup-submit"
          />
          {historyLookupLoading ? <T size={type.sm} color={colors.onSurfaceSecondary}>Looking up the tenant-shared code…</T> : null}
          {historyLookupError ? <View testID="tenant-history-error"><T size={type.sm} color={colors.error}>{historyLookupError}</T></View> : null}
          {historyGrantId && historyReports.length === 0 ? (
            <View testID="tenant-history-empty"><T size={type.sm} color={colors.onSurfaceSecondary}>
              No shared reports were returned. The tenant’s permission was used for this lookup.
            </T></View>
          ) : null}
          {historyGrantId && historyReports.length > 0 ? (
            <View style={{ gap: spacing.sm }} testID="tenant-history-results">
              <T size={type.sm} color={colors.onSurfaceSecondary}>Shared using the tenant-provided code. This grant will be attached when you add the tenant.</T>
              <T size={type.sm} weight="bold">Shared reports · all allegations are unverified</T>
              {historyReports.map((report) => (
                <Card key={report.id} style={{ gap: spacing.xs, backgroundColor: colors.surfaceSecondary }}>
                  <Row style={{ justifyContent: "space-between", alignItems: "flex-start", gap: spacing.sm }}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <T weight="bold">{reportCategoryLabel(report.category)}</T>
                      <T size={type.sm} color={colors.onSurfaceSecondary}>{report.previous_hostel || "Previous hostel unavailable"} · {reportDate(report.reported_at)}</T>
                    </View>
                    <Badge label={reportStatusLabel(report.status)} tone={reportStatusTone(report.status)} />
                  </Row>
                  {report.amount !== undefined && report.amount !== null ? <T size={type.sm} weight="semibold">Reported amount: ₹{report.amount}</T> : null}
                  {report.evidence_summary ? <T size={type.sm} color={colors.onSurfaceSecondary}>Evidence summary: {report.evidence_summary}</T> : null}
                  {report.evidence_documents?.length ? <T size={type.sm} color={colors.onSurfaceSecondary}>Supporting documents: {report.evidence_documents.length} private attachment(s)</T> : null}
                  {report.details_available && report.details ? <T size={type.sm} color={colors.onSurfaceSecondary}>Details: {report.details}</T> : null}
                  {!report.details_available ? <T size={type.sm} color={colors.onSurfaceTertiary}>Additional details unavailable.</T> : null}
                  {report.stay_start_date || report.vacated_at ? (
                    <T size={type.sm} color={colors.onSurfaceSecondary}>
                      Stay: {report.stay_start_date || "Start unavailable"} – {report.vacated_at || "Vacating date unavailable"}
                    </T>
                  ) : null}
                  {report.tenant_response?.text ? <T size={type.sm} color={colors.brand}>Tenant response: {report.tenant_response.text}</T> : null}
                  {status === "reported_pending_verification" || status === "under_review" ? (
                    <T size={11} weight="semibold" color={colors.warning}>UNVERIFIED ALLEGATION</T>
                  ) : status === "verified_outstanding" ? (
                    <T size={11} weight="semibold" color={colors.error}>VERIFIED OUTSTANDING</T>
                  ) : null}
                </Card>
              ))}
            </View>
          ) : null}
        </Card>

        {savingStage ? <T size={type.sm} color={colors.onSurfaceSecondary}>{savingStage}</T> : null}
        <Btn title="Add Tenant" onPress={save} loading={saving} disabled={saving || historyLookupLoading} testID="t-save" />
      </Sheet>

      <Sheet visible={calendarOpen} onClose={() => setCalendarOpen(false)} title="Select joining date" centered>
        <Row style={{ justifyContent: "space-between" }}>
          <Pressable accessibilityLabel="Previous month" onPress={() => setCalendarMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))} style={formStyles.monthButton}>
            <Ionicons name="chevron-back" size={20} color={colors.brand} />
          </Pressable>
          <T weight="bold">{calendarMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</T>
          <Pressable accessibilityLabel="Next month" onPress={() => setCalendarMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))} style={formStyles.monthButton}>
            <Ionicons name="chevron-forward" size={20} color={colors.brand} />
          </Pressable>
        </Row>
        <View style={formStyles.calendarGrid}>
          {["S", "M", "T", "W", "T", "F", "S"].map((label, index) => (
            <T key={`${label}-${index}`} size={type.sm} weight="bold" color={colors.onSurfaceSecondary} style={formStyles.calendarCell}>{label}</T>
          ))}
          {Array.from({ length: new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1).getDay() }, (_, index) => (
            <View key={`blank-${index}`} style={formStyles.calendarCell} />
          ))}
          {Array.from({ length: new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 0).getDate() }, (_, index) => {
            const day = index + 1;
            const selected = joiningDate === dateOnly(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), day));
            return (
              <Pressable
                key={day}
                accessibilityRole="button"
                accessibilityLabel={`${calendarMonth.toLocaleDateString(undefined, { month: "long" })} ${day}`}
                onPress={() => {
                  setJoiningDate(dateOnly(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), day)));
                  setCalendarOpen(false);
                }}
                style={[formStyles.calendarCell, selected ? formStyles.selectedCalendarDay : null]}
              >
                <T size={type.sm} weight={selected ? "bold" : "regular"} color={selected ? colors.onBrandPrimary : colors.onSurface}>{day}</T>
              </Pressable>
            );
          })}
        </View>
      </Sheet>

      {/* Manage tenant */}
      <Sheet
        visible={!!manage && !reportOpen && !transferOpen}
        onClose={closeManage}
        title={documentPreviewOpen ? "Tenant document" : manage?.name}
      >
        {documentPreviewOpen ? (
          <>
            {documentPreviewLoading || documentImageLoading ? <LoadingView label={documentPreviewLoading ? "Retrieving secure document..." : "Displaying document..."} /> : null}
            {documentPreviewError ? (
              <View style={{ gap: spacing.sm }}>
                <T color={colors.error}>{documentPreviewError}</T>
                {documentPreviewKind ? (
                  <Btn title="Try again" variant="secondary" onPress={() => openDocument(documentPreviewKind)} />
                ) : null}
              </View>
            ) : null}
            {documentPreview ? (
              <Image
                source={{ uri: documentPreview }}
                style={formStyles.largeDocumentPreview}
                resizeMode="contain"
                onLoad={() => {
                  if (documentImageTimeout.current) clearTimeout(documentImageTimeout.current);
                  documentImageTimeout.current = null;
                  setDocumentImageLoading(false);
                  setDocumentPreviewError("");
                }}
                onError={() => {
                  if (documentImageTimeout.current) clearTimeout(documentImageTimeout.current);
                  documentImageTimeout.current = null;
                  setDocumentImageLoading(false);
                  const message = "The document image could not be displayed. Try again or ask an owner to re-upload it.";
                  setDocumentPreviewError(message);
                  toastShow(message, "error");
                }}
              />
            ) : null}
          </>
        ) : (
          <>
        {detailsLoading ? <LoadingView /> : null}
        {tenantDetails ? (
          <View style={{ gap: spacing.sm }}>
            <T weight="bold">Contact information</T>
            <T color={colors.onSurfaceSecondary}>{tenantDetails.tenant.mobile}{tenantDetails.tenant.email ? ` · ${tenantDetails.tenant.email}` : ""}</T>
            <T weight="bold">Stay details</T>
            <T color={colors.onSurfaceSecondary}>{tenantDetails.hostel?.name || activeHostel?.name || "Hostel"} · Floor {tenantDetails.room?.floor ?? "—"} · Room {tenantDetails.room?.room_number ?? tenantDetails.tenant.room_number} · Bed {tenantDetails.tenant.bed_number}</T>
            <T color={colors.onSurfaceSecondary}>Joining date: {tenantDetails.tenant.joining_date || "Not recorded"}</T>
            <T color={colors.onSurfaceSecondary}>Aadhaar on record: {tenantDetails.tenant.aadhaar_last4 ? `ending ${tenantDetails.tenant.aadhaar_last4}` : "No number stored"}</T>
            <T weight="bold">Rent and payments</T>
            <T color={colors.onSurfaceSecondary}>Monthly rent: ₹{tenantDetails.tenant.monthly_rent ?? "—"} · Payment status: {tenantDetails.tenant.payment_status || "—"}</T>
            <T color={colors.onSurfaceSecondary}>Security deposit: ₹{tenantDetails.tenant.security_deposit ?? 0} · Advance: ₹{tenantDetails.tenant.advance_amount ?? 0}</T>
            <T weight="bold">Tenant reports and dues</T>
            {tenantReports.length === 0 ? (
              <T size={type.sm} color={colors.onSurfaceSecondary}>No reports recorded for this membership.</T>
            ) : tenantReports.map((report) => {
              const status = report.status || "reported_pending_verification";
              const closed = status === "resolved_paid" || status === "rejected";
              const label = reportCategoryLabel(report.category);
              return (
                <Card key={report.id} style={{ gap: spacing.xs, backgroundColor: colors.surfaceSecondary }} testID={`tenant-report-${report.id}`}>
                  <Row style={{ justifyContent: "space-between", alignItems: "flex-start", gap: spacing.sm }}>
                    <T weight="bold" style={{ flex: 1 }}>{label}</T>
                    <Badge label={reportStatusLabel(status)} tone={reportStatusTone(status)} />
                  </Row>
                  <T size={type.sm} color={colors.onSurfaceSecondary}>Reported {reportDate(report.reported_at)}</T>
                  <T size={type.sm}>Claimed: ₹{report.amount_claimed ?? report.amount ?? 0} · Outstanding: ₹{report.outstanding_balance ?? report.amount_claimed ?? report.amount ?? 0}</T>
                  {report.details ? <T size={type.sm} color={colors.onSurfaceSecondary}>{report.details}</T> : null}
                  {report.status_note ? <T size={type.sm} color={colors.onSurfaceSecondary}>Owner update: {report.status_note}</T> : null}
                  {report.tenant_response?.text ? <T size={type.sm} color={colors.warning}>Tenant response: {report.tenant_response.text}</T> : null}
                  {report.evidence_documents?.map((evidence) => (
                    <Btn
                      key={evidence.id}
                      title={`View private evidence: ${evidence.filename}`}
                      variant="secondary"
                      icon="document-attach-outline"
                      onPress={() => viewReportEvidence(report, evidence)}
                      loading={evidenceLoadingId === evidence.id}
                      disabled={Boolean(evidenceLoadingId)}
                    />
                  ))}
                  {report.settlements?.map((entry, index) => (
                    <T key={`${report.id}-settlement-${index}`} size={type.sm} color={colors.onSurfaceSecondary}>
                      {entry.entry_type === "write_off" ? "Written off" : "Settlement"}: ₹{entry.amount} · {reportDate(entry.created_at)}
                    </T>
                  ))}
                  {!closed ? (
                    <>
                      <Field
                        label="Record settlement (₹)"
                        value={reportSettlementAmounts[report.id] || ""}
                        onChangeText={(value) => setReportSettlementAmounts((current) => ({ ...current, [report.id]: value }))}
                        keyboardType="numeric"
                        placeholder="Amount received"
                        testID={`tenant-report-settlement-${report.id}`}
                      />
                      <Btn
                        title="Record settlement"
                        variant="secondary"
                        onPress={() => settleReport(report.id)}
                        loading={reportActionId === report.id}
                        disabled={Boolean(reportActionId) || !reportSettlementAmounts[report.id]?.trim()}
                        testID={`tenant-report-settle-${report.id}`}
                      />
                      <Row style={{ gap: spacing.xs, flexWrap: "wrap" }}>
                        {status === "reported_pending_verification" || status === "disputed_by_tenant" || status === "partially_settled" ? (
                          <Chip label="Under review" active={false} onPress={() => changeReportStatus(report.id, "under_review")} testID={`tenant-report-review-${report.id}`} />
                        ) : null}
                        {status === "reported_pending_verification" || status === "under_review" || status === "disputed_by_tenant" || status === "partially_settled" ? (
                          <Chip label="Verify outstanding" onPress={() => changeReportStatus(report.id, "verified_outstanding")} testID={`tenant-report-verify-${report.id}`} />
                        ) : null}
                        <Chip label="Reject report" onPress={() => changeReportStatus(report.id, "rejected")} testID={`tenant-report-reject-${report.id}`} />
                      </Row>
                    </>
                  ) : null}
                </Card>
              );
            })}
            <T weight="bold">Documents</T>
            {(["aadhaar_front", "aadhaar_back", "selfie"] as const).map((kind) => {
              const available = tenantDetails.documents?.[kind]?.available;
              return available ? (
                <Btn key={kind} title={`View ${tenantDocumentLabels[kind].replace(" (optional)", "")}`} variant="secondary" icon="eye-outline" loading={documentPreviewLoading} onPress={() => openDocument(kind)} />
              ) : (
                <T key={kind} size={type.sm} color={colors.onSurfaceSecondary}>
                  {kind === "selfie" ? "Selfie not uploaded" : `${tenantDocumentLabels[kind].replace(" (optional)", "")}: Not uploaded`}
                </T>
              );
            })}
          </View>
        ) : null}
        <T color={colors.onSurfaceSecondary}>Room {manage?.room_number} · Bed {manage?.bed_number}</T>
        <Btn
          title="Report Tenant"
          variant="secondary"
          icon="flag-outline"
          onPress={openReportForm}
          disabled={!manage || tenantActionIds.has(manage.id)}
          testID="t-report-open"
        />
        {manage?.active ? (
          <>
            <Btn
              title="Transfer Room / Bed"
              variant="secondary"
              icon="swap-horizontal"
              onPress={() => setTransferOpen(manage)}
              disabled={tenantActionIds.has(manage.id)}
              testID="t-transfer-open"
            />
            <Btn
              title="Check Out Tenant"
              variant="secondary"
              icon="exit"
              onPress={() => void checkout(manage)}
              loading={tenantActionIds.has(manage.id)}
              disabled={tenantActionIds.has(manage.id)}
              testID="t-checkout"
            />
          </>
        ) : null}
        <Btn
          title="Archive Tenant Record"
          variant="danger"
          icon="archive-outline"
          onPress={() => void del(manage)}
          loading={Boolean(manage && tenantActionIds.has(manage.id))}
          disabled={!manage || tenantActionIds.has(manage.id)}
          testID="t-delete"
        />
          </>
        )}
      </Sheet>

      {/* Transfer */}
      <Sheet visible={!!transferOpen} onClose={() => setTransferOpen(null)} title="Transfer to">
        {transferOpen && tenantActionIds.has(transferOpen.id) ? (
          <LoadingView label="Transferring tenant to the selected bed..." />
        ) : (
          <>
            {rooms.filter((r) => r.beds.some((b: any) =>
              b.status === "available" && !(r.id === transferOpen?.room_id && b.bed_number === transferOpen?.bed_number),
            )).map((r) => (
              <View key={r.id} style={{ gap: spacing.sm }}>
                <T weight="bold">Room {r.room_number} · ₹{r.rent}</T>
                <Row style={{ gap: spacing.sm, flexWrap: "wrap" }}>
                  {r.beds.filter((b: any) =>
                    b.status === "available" && !(r.id === transferOpen?.room_id && b.bed_number === transferOpen?.bed_number),
                  ).map((b: any) => (
                    <Chip
                      key={`${r.id}-${b.bed_number}`}
                      label={b.bed_number}
                      onPress={() => void doTransfer(r.id, b.bed_number)}
                      testID={`transfer-${r.id}-${b.bed_number}`}
                    />
                  ))}
                </Row>
              </View>
            ))}
            {!rooms.some((r) => r.beds.some((b: any) =>
              b.status === "available" && !(r.id === transferOpen?.room_id && b.bed_number === transferOpen?.bed_number),
            )) ? (
              <T color={colors.onSurfaceSecondary}>No other available beds to transfer this tenant to.</T>
            ) : null}
          </>
        )}
      </Sheet>

      <Sheet visible={reportOpen} onClose={() => setReportOpen(false)} title="Report Tenant">
        <Card style={{ gap: spacing.sm }}>
          <T weight="bold">Submit an unverified allegation</T>
          <T size={type.sm} color={colors.onSurfaceSecondary}>
            Reports are allegations, not verified findings. Submit only accurate information; the tenant may be able to respond or settle through the available process.
          </T>
        </Card>
        <T weight="semibold">Category *</T>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.xs }} testID="tenant-report-category">
          {tenantReportCategories.map((category) => (
            <Chip
              key={category.value}
              label={category.label}
              active={reportCategory === category.value}
              onPress={() => setReportCategory(category.value)}
              testID={`tenant-report-category-${category.value}`}
            />
          ))}
        </View>
        <Field label="Reported amount (₹, if applicable)" value={reportAmount} onChangeText={setReportAmount} placeholder="0" keyboardType="numeric" testID="tenant-report-amount" />
        <Field label="Details *" value={reportDetails} onChangeText={setReportDetails} placeholder="Describe the issue factually" multiline maxLength={4000} testID="tenant-report-details" />
        <Field label="Evidence summary (optional)" value={reportEvidenceSummary} onChangeText={setReportEvidenceSummary} placeholder="Describe supporting documents or evidence" multiline maxLength={1000} testID="tenant-report-evidence-summary" />
        <Row style={{ gap: spacing.sm, alignItems: "center" }}>
          <Btn
            title={reportEvidenceAsset ? "Change evidence document" : "Attach evidence document"}
            variant="secondary"
            icon="cloud-upload-outline"
            onPress={pickReportEvidence}
          />
          {reportEvidenceAsset ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Remove report evidence"
              onPress={() => setReportEvidenceAsset(null)}
              hitSlop={10}
            >
              <Ionicons name="close-circle" size={22} color={colors.error} />
            </Pressable>
          ) : null}
        </Row>
        {reportEvidenceAsset ? (
          <T size={type.sm} color={colors.onSurfaceSecondary}>
            {reportEvidenceAsset.name} · {reportEvidenceAsset.mimeType}
            {reportEvidenceAsset.size ? ` · ${(reportEvidenceAsset.size / (1024 * 1024)).toFixed(1)} MB` : ""}
          </T>
        ) : null}
        <Btn title="Submit Report" onPress={submitReport} loading={reportSaving} disabled={reportSaving} testID="tenant-report-submit" />
      </Sheet>
    </Screen>
  );
}

const formStyles = StyleSheet.create({
  dateField: {
    minHeight: 56,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  documentBlock: { gap: spacing.xs },
  documentButton: {
    minHeight: 48,
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
  },
  documentPreview: { width: 48, height: 48, borderRadius: radius.sm, backgroundColor: colors.surfaceTertiary },
  largeDocumentPreview: { width: "100%", height: 420 },
  monthButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  calendarGrid: { flexDirection: "row", flexWrap: "wrap" },
  calendarCell: { width: "14.2857%", height: 42, alignItems: "center", justifyContent: "center", textAlign: "center" },
  selectedCalendarDay: { backgroundColor: colors.brand, borderRadius: radius.pill },
});
