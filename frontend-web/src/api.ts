export const API_ORIGIN = (import.meta.env.VITE_API_ORIGIN || "").replace(/\/+$/, "");
const TOKEN_KEY = "hostel360.token";

export class ApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly code?: string) {
    super(message);
    this.name = "ApiError";
  }
}

export const tokenStore = {
  get: () => window.localStorage.getItem(TOKEN_KEY),
  set: (token: string | null) => {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  },
};

async function request<T>(
  path: string,
  init: RequestInit = {},
  options: { public?: boolean; raw?: boolean; timeoutMs?: number } = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData) && init.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  const token = options.public ? null : tokenStore.get();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 30_000;
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(`${API_ORIGIN}/api${path}`, {
      ...init,
      headers,
      credentials: "omit",
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiError(`Request timed out after ${Math.round(timeoutMs / 1000)} seconds. Please retry.`, 0);
    }
    throw new ApiError(error instanceof Error ? error.message : "Could not connect to Hostel360.", 0);
  } finally {
    window.clearTimeout(timeout);
  }
  if (options.raw && response.ok) return response.blob() as Promise<T>;

  let data: any = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok) {
    const detail = data?.detail;
    const message = Array.isArray(detail)
      ? detail.map((item: any) => item?.msg).filter(Boolean).join("; ") || "Request failed"
      : typeof detail === "string"
        ? detail
        : detail?.message || data?.message || `Request failed (${response.status})`;
    throw new ApiError(message, response.status, typeof detail?.code === "string" ? detail.code : undefined);
  }
  return data as T;
}

export const api = {
  get: <T,>(path: string, timeoutMs?: number) => request<T>(path, {}, { timeoutMs }),
  getPublic: <T,>(path: string, timeoutMs?: number) => request<T>(path, {}, { public: true, timeoutMs }),
  getBlob: (path: string, timeoutMs?: number) => request<Blob>(path, {}, { raw: true, timeoutMs }),
  post: <T,>(path: string, body?: unknown, timeoutMs?: number) =>
    request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) }, { timeoutMs }),
  postPublic: <T,>(path: string, body?: unknown, timeoutMs?: number) =>
    request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) }, { public: true, timeoutMs }),
  put: <T,>(path: string, body?: unknown, timeoutMs?: number) =>
    request<T>(path, { method: "PUT", body: body === undefined ? undefined : JSON.stringify(body) }, { timeoutMs }),
  delete: <T,>(path: string, timeoutMs?: number) => request<T>(path, { method: "DELETE" }, { timeoutMs }),
  upload: <T,>(path: string, file: File | FormData, timeoutMs = 120_000) => {
    const body = file instanceof FormData ? file : new FormData();
    if (!(file instanceof FormData)) body.append("file", file, file.name);
    return request<T>(path, { method: "POST", body }, { timeoutMs });
  },
};
