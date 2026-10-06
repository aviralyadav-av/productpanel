import type { MediaAssetDto } from "@/features/media/dto";

/**
 * Browser-side upload transport shared by the /admin/media drop zone and the
 * MediaPicker's Upload tab.
 *
 * XMLHttpRequest rather than fetch, on purpose: fetch cannot report upload
 * progress, and a 60 MB video with no progress bar looks broken after ten
 * seconds. One request per file so a single bad file fails alone and the
 * queue keeps moving.
 *
 * No React, no server imports - just the wire protocol of
 * `POST /api/admin/media/upload` and `POST /api/admin/media/:id/replace`.
 */

export const UPLOAD_ENDPOINT = "/api/admin/media/upload";

export type UploadStatus = "queued" | "uploading" | "processing" | "done" | "error";

export type UploadItem = {
  /** Client-side key for React lists; not the asset id. */
  key: string;
  file: File;
  status: UploadStatus;
  /** 0-100 for the transfer phase. */
  progress: number;
  error: string | null;
  asset: MediaAssetDto | null;
};

export type UploadOptions = {
  folderId?: string | null;
  visibility?: "PUBLIC" | "PRIVATE";
  alt?: string | null;
  onProgress?(percent: number): void;
  signal?: AbortSignal;
};

export class UploadError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly details: Record<string, string> | null;
  constructor(status: number, message: string, code: string | null = null, details: Record<string, string> | null = null) {
    super(message);
    this.name = "UploadError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** MIME prefixes the <input accept> should offer for a picker `accept` value. */
export const ACCEPT_ATTRIBUTE: Record<"image" | "video" | "document" | "all", string> = {
  image: "image/jpeg,image/png,image/webp,image/gif,image/avif,image/svg+xml,image/x-icon,.jpg,.jpeg,.png,.webp,.gif,.avif,.svg,.ico",
  video: "video/mp4,video/webm,.mp4,.webm",
  document: "application/pdf,.pdf",
  all: "image/*,video/mp4,video/webm,application/pdf",
};

let keyCounter = 0;
export function nextUploadKey(): string {
  keyCounter += 1;
  return `u${Date.now().toString(36)}${keyCounter}`;
}

function parseError(xhr: XMLHttpRequest): UploadError {
  let message = `Upload failed (${xhr.status || "network error"}).`;
  let code: string | null = null;
  let details: Record<string, string> | null = null;
  try {
    const body = JSON.parse(xhr.responseText) as { error?: { code?: string; message?: string; details?: Record<string, string> } };
    if (body.error?.message) message = body.error.message;
    code = body.error?.code ?? null;
    details = body.error?.details ?? null;
    // The per-file detail is more useful than the envelope sentence.
    if (details?.file) message = details.file;
  } catch {
    if (xhr.status === 413) message = "The file is too large for the server to accept.";
  }
  return new UploadError(xhr.status, message, code, details);
}

function send<T>(url: string, form: FormData, options: UploadOptions, pick: (body: unknown) => T): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.responseType = "text";

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      options.onProgress?.(Math.min(100, Math.round((event.loaded / event.total) * 100)));
    };
    xhr.onerror = () => reject(new UploadError(0, "Network error while uploading."));
    xhr.onabort = () => reject(new UploadError(0, "Upload cancelled."));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(pick(JSON.parse(xhr.responseText)));
        } catch {
          reject(new UploadError(xhr.status, "The server returned an unreadable response."));
        }
      } else {
        reject(parseError(xhr));
      }
    };

    if (options.signal) {
      if (options.signal.aborted) {
        reject(new UploadError(0, "Upload cancelled."));
        return;
      }
      options.signal.addEventListener("abort", () => xhr.abort(), { once: true });
    }

    xhr.send(form);
  });
}

/** Upload one file; resolves with the created asset. */
export function uploadFile(file: File, options: UploadOptions = {}): Promise<MediaAssetDto> {
  const form = new FormData();
  form.append("file", file, file.name);
  if (options.folderId) form.append("folderId", options.folderId);
  if (options.visibility) form.append("visibility", options.visibility);
  if (options.alt) form.append("alt", options.alt);

  return send(UPLOAD_ENDPOINT, form, options, (body) => {
    const data = (body as { data?: MediaAssetDto[] | MediaAssetDto }).data;
    const asset = Array.isArray(data) ? data[0] : data;
    if (!asset) throw new Error("No asset in response.");
    return asset;
  });
}

/** Replace the bytes behind an existing asset. */
export function replaceFile(assetId: string, file: File, options: UploadOptions = {}): Promise<MediaAssetDto> {
  const form = new FormData();
  form.append("file", file, file.name);
  return send(`/api/admin/media/${encodeURIComponent(assetId)}/replace`, form, options, (body) => {
    const asset = (body as { data?: MediaAssetDto }).data;
    if (!asset) throw new Error("No asset in response.");
    return asset;
  });
}

/**
 * Client-side pre-check so an obviously wrong file never leaves the browser.
 * The server re-validates by magic bytes; this only saves a round trip.
 */
export function precheckFile(file: File, accept: "image" | "video" | "document" | "all" = "all"): string | null {
  const type = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  const isImage = type.startsWith("image/") || /\.(jpe?g|png|webp|gif|avif|svg|ico)$/.test(name);
  const isVideo = type.startsWith("video/") || /\.(mp4|webm)$/.test(name);
  const isDocument = type === "application/pdf" || /\.pdf$/.test(name);

  if (!isImage && !isVideo && !isDocument) return "Unsupported file type.";
  if (accept === "image" && !isImage) return "Only images are accepted here.";
  if (accept === "video" && !isVideo) return "Only videos are accepted here.";
  if (accept === "document" && !isDocument) return "Only PDF documents are accepted here.";

  const cap = isVideo ? 100 : isDocument ? 20 : 10;
  if (file.size > cap * 1024 * 1024) return `Too large: the limit for this type is ${cap} MB.`;
  if (file.size === 0) return "The file is empty.";
  return null;
}
