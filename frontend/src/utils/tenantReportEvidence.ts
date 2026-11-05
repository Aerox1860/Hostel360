import { Platform } from "react-native";
import { api } from "@/src/api/client";

type EvidenceReference = {
  id: string;
  filename: string;
  content_type: string;
};

export async function openTenantReportEvidence(
  reportId: string,
  evidence: EvidenceReference,
  grantId?: string | null,
) {
  const query = grantId ? `?grant_id=${encodeURIComponent(grantId)}` : "";
  const path = `/owner/tenant-reports/${encodeURIComponent(reportId)}/evidence/${encodeURIComponent(evidence.id)}${query}`;
  const blob = await api.getPrivateFileBlob(path);
  const safeName = evidence.filename.replace(/[^A-Za-z0-9._-]/g, "_") || "tenant-report-evidence";

  if (Platform.OS === "web") {
    if (typeof document === "undefined") throw new Error("Document download is unavailable in this browser.");
    const uri = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = uri;
    link.download = safeName;
    link.click();
    setTimeout(() => URL.revokeObjectURL(uri), 1000);
    return;
  }

  const [{ File, Paths }, Sharing] = await Promise.all([
    import("expo-file-system"),
    import("expo-sharing"),
  ]);
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error("Secure file sharing is unavailable on this device.");
  }
  const file = new File(Paths.cache, `tenant-report-${Date.now()}-${safeName}`);
  await file.write(new Uint8Array(await blob.arrayBuffer()));
  await Sharing.shareAsync(file.uri, {
    mimeType: evidence.content_type,
    dialogTitle: evidence.filename,
    ...(evidence.content_type === "application/pdf" ? { UTI: "com.adobe.pdf" } : {}),
  });
}

export async function openRentPaymentScreenshot(paymentId: string) {
  const blob = await api.getPrivateFileBlob(`/owner/rent/${encodeURIComponent(paymentId)}/evidence`);
  const extension = blob.type === "image/png" ? "png" : blob.type === "image/webp" ? "webp" : "jpg";
  const safeName = `rent-payment-${paymentId}.${extension}`;
  if (Platform.OS === "web") {
    if (typeof document === "undefined") throw new Error("Screenshot download is unavailable in this browser.");
    const uri = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = uri;
    link.download = safeName;
    link.click();
    setTimeout(() => URL.revokeObjectURL(uri), 1000);
    return;
  }

  const [{ File, Paths }, Sharing] = await Promise.all([
    import("expo-file-system"),
    import("expo-sharing"),
  ]);
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error("Secure screenshot sharing is unavailable on this device.");
  }
  const file = new File(Paths.cache, `rent-payment-${Date.now()}.${extension}`);
  await file.write(new Uint8Array(await blob.arrayBuffer()));
  await Sharing.shareAsync(file.uri, { mimeType: blob.type, dialogTitle: "UPI rent payment screenshot" });
}
