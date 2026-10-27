import { storage } from "@/src/utils/storage";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;
export const TOKEN_KEY = "hostel360.token";

let memToken: string | null = null;

export async function setToken(token: string | null) {
  memToken = token;
  if (token === null) await storage.secureRemove(TOKEN_KEY);
  else await storage.secureSet(TOKEN_KEY, token);
}

export async function getToken(): Promise<string | null> {
  if (memToken) return memToken;
  const t = await storage.secureGet<string>(TOKEN_KEY, "");
  memToken = t || null;
  return memToken;
}

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function requestWithTimeout<T>(
  path: string,
  options: RequestInit,
  timeoutMs: number,
  timeoutMessage: string,
  multipart = false,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await request<T>(path, { ...options, signal: controller.signal }, multipart);
  } catch (error) {
    if (controller.signal.aborted) throw new ApiError(timeoutMessage, 408);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function request<T = any>(path: string, options: RequestInit = {}, multipart = false): Promise<T> {
  const token = await getToken();
  const headers: Record<string, string> = {
    ...(multipart ? {} : { "Content-Type": "application/json" }),
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  if (multipart) {
    console.info("[api] multipart request", {
      path,
      authorizationPresent: Boolean(token),
      bodyConstructor: options.body && typeof options.body === "object"
        ? options.body.constructor?.name || "Object"
        : typeof options.body,
      isFormData: typeof FormData !== "undefined" && options.body instanceof FormData,
    });
  }

  let res: Response;
  try {
    res = await fetch(`${BASE}/api${path}`, { ...options, headers });
  } catch (error) {
    if (multipart) {
      console.error("[api] multipart request failed", {
        path,
        status: "network_error",
        errorName: error instanceof Error ? error.name : "UnknownError",
        errorMessage: error instanceof Error ? error.message : "Unknown network error",
      });
    }
    throw error;
  }
  if (multipart) {
    console.info("[api] multipart response", { path, status: res.status, ok: res.ok });
  }
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const detail = data?.detail;
    const msg = Array.isArray(detail)
      ? detail.map((item: any) => item?.msg).filter(Boolean).join("; ") || "Request failed"
      : typeof detail === "string"
        ? detail
        : detail?.message || data?.message || "Something went wrong";
    throw new ApiError(
      typeof msg === "string" ? msg : "Request failed",
      res.status,
      typeof detail?.code === "string" ? detail.code : undefined,
    );
  }
  return data as T;
}

async function requestBlob(path: string, allowPdf = false): Promise<Blob> {
  const token = await getToken();
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 20000);

  try {
    return await fetchDocumentBlob(path, token, controller.signal, allowPdf);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (timedOut) {
      throw new ApiError("The document request timed out. Check your connection and try again.", 408);
    }
    throw new ApiError("Could not connect to the server to retrieve this document.", 0);
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchDocumentBlob(
  path: string,
  token: string | null,
  signal: AbortSignal,
  allowPdf = false,
): Promise<Blob> {
  let response: Response;
  response = await fetch(`${BASE}/api${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    signal,
  });

  if (!response.ok) {
    let data: any = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    const detail = data?.detail;
    const message = typeof detail === "string"
      ? detail
      : detail?.message || data?.message || `Could not retrieve document (${response.status}).`;
    throw new ApiError(message, response.status, typeof detail?.code === "string" ? detail.code : undefined);
  }

  const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (!contentType?.startsWith("image/") && !(allowPdf && contentType === "application/pdf")) {
    throw new ApiError(
      allowPdf ? "The server response is not an allowed private document." : "The server response is not an image.",
      response.status,
    );
  }
  const blob = await response.blob();
  if (!blob.size) {
    throw new ApiError("The server returned an empty document.", response.status);
  }
  return blob;
}

export const api = {
  get: <T = any>(p: string) => request<T>(p),
  getWithTimeout: <T = any>(p: string, timeoutMs: number, timeoutMessage: string) =>
    requestWithTimeout<T>(p, {}, timeoutMs, timeoutMessage),
  getBlob: (p: string) => requestBlob(p),
  getPrivateFileBlob: (p: string) => requestBlob(p, true),
  post: <T = any>(p: string, body?: any) =>
    request<T>(p, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  postWithTimeout: <T = any>(p: string, body: any, timeoutMs: number, timeoutMessage: string) =>
    requestWithTimeout<T>(
      p,
      { method: "POST", body: JSON.stringify(body) },
      timeoutMs,
      timeoutMessage,
    ),
  put: <T = any>(p: string, body?: any) =>
    request<T>(p, { method: "PUT", body: body ? JSON.stringify(body) : undefined }),
  delete: <T = any>(p: string) => request<T>(p, { method: "DELETE" }),
  upload: <T = any>(p: string, body: FormData) =>
    request<T>(p, { method: "POST", body }, true),
  uploadWithTimeout: <T = any>(p: string, body: FormData, timeoutMs: number, timeoutMessage: string) =>
    requestWithTimeout<T>(p, { method: "POST", body }, timeoutMs, timeoutMessage, true),
  uploadNativeFile: async <T = any>(p: string, uri: string, fileName: string, mimeType: string) => {
    const token = await getToken();
    const { File, Paths, UploadType } = await import("expo-file-system");
    const sourceFile = new File(uri);
    const expectedExtension = `.${fileName.split(".").pop()?.toLowerCase() || ""}`;
    const needsExtensionCopy = sourceFile.extension.toLowerCase() !== expectedExtension;
    const uploadFile = needsExtensionCopy
      ? new File(
          Paths.cache,
          `advertisement-upload-${Date.now()}-${Math.random().toString(36).slice(2)}${expectedExtension}`,
        )
      : sourceFile;

    try {
      if (needsExtensionCopy) await sourceFile.copy(uploadFile);
      const result = await uploadFile.upload(`${BASE}/api${p}`, {
        uploadType: UploadType.MULTIPART,
        fieldName: "file",
        mimeType,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        sessionType: "foreground",
      });
      console.info("[api] native multipart response", { path: p, status: result.status });
      let data: any = null;
      try {
        data = JSON.parse(result.body);
      } catch {
        data = null;
      }
      if (result.status < 200 || result.status >= 300) {
        const detail = data?.detail;
        const message = typeof detail === "string" ? detail : data?.message || "Something went wrong";
        throw new ApiError(message, result.status);
      }
      return data as T;
    } finally {
      if (needsExtensionCopy && uploadFile.exists) {
        try {
          uploadFile.delete();
        } catch (error) {
          console.warn("[api] could not remove temporary advertisement upload file", {
            errorName: error instanceof Error ? error.name : "UnknownError",
            errorMessage: error instanceof Error ? error.message : "Unknown cleanup error",
          });
        }
      }
    }
  },
  del: <T = any>(p: string) => request<T>(p, { method: "DELETE" }),
};

export const BACKEND_URL = BASE;
