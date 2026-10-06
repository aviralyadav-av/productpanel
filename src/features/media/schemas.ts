import { z } from "zod";

import {
  MEDIA_KINDS,
  MEDIA_VISIBILITIES,
  mediaKindSchema,
  mediaVisibilitySchema,
  type MediaKind,
  type MediaVisibility,
} from "@/lib/enums";
import { extensionForMime } from "@/lib/storage/mime";
import { optionalTextSchema, textSchema } from "@/lib/validation";

/**
 * Every write into the media library and every list query passes through
 * here (blueprint §14.F). Two things are decided once in this file rather
 * than in each route:
 *
 *  - ids are opaque strings, not cuids: the seed creates folders and assets
 *    with readable ids ("demo_folder_demo-categories") that the admin must be
 *    able to address, so `idSchema` from src/lib/validation is too strict.
 *  - the operator's filename is display metadata only. It is trimmed of
 *    paths and control characters and forced to carry the extension of the
 *    type we actually detected, so "invoice.pdf.exe" is stored as
 *    "invoice.pdf.pdf" and never as something a download could execute.
 */

export { MEDIA_KINDS, MEDIA_VISIBILITIES, mediaKindSchema, mediaVisibilitySchema };
export type { MediaKind, MediaVisibility };

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export const mediaIdSchema = z
  .string()
  .trim()
  .min(1, "Missing id.")
  .max(64, "Invalid id.")
  .regex(/^[A-Za-z0-9_-]+$/, "Invalid id.");

/** "" | "root" | null | undefined -> null (library root). */
export const nullableFolderIdSchema = z.preprocess(
  (value) => (value === "" || value === "root" || value === undefined ? null : value),
  mediaIdSchema.nullable(),
);

export const altSchema = optionalTextSchema(300);

export const folderNameSchema = textSchema(80, "Folder name").regex(
  /^[^/\\]+$/,
  "Folder names cannot contain slashes.",
);

export const MEDIA_SORTS = ["createdAt", "updatedAt", "filename", "sizeBytes"] as const;
export type MediaSort = (typeof MEDIA_SORTS)[number];
export const mediaSortSchema = z.enum(MEDIA_SORTS);

export const MEDIA_VIEWS = ["grid", "list"] as const;
export type MediaView = (typeof MEDIA_VIEWS)[number];

/** Size caps per kind (§11.20). Enforced before any decoding happens. */
export const MAX_UPLOAD_BYTES: Record<MediaKind, number> = {
  image: 10 * 1024 * 1024,
  video: 100 * 1024 * 1024,
  document: 20 * 1024 * 1024,
};

export const MAX_FILES_PER_UPLOAD = 20;

// ---------------------------------------------------------------------------
// Uploads
// ---------------------------------------------------------------------------

const isFile = (value: unknown): value is File =>
  typeof File !== "undefined" && value instanceof File;

const fileSchema = z.custom<File>(isFile, "Attach a file.");

/** One or many files under either field name; the route flattens them. */
export const uploadFormSchema = z
  .object({
    file: z.union([fileSchema, z.array(fileSchema)]).optional(),
    files: z.union([fileSchema, z.array(fileSchema)]).optional(),
    "files[]": z.union([fileSchema, z.array(fileSchema)]).optional(),
    folderId: nullableFolderIdSchema.optional(),
    visibility: mediaVisibilitySchema.optional(),
    alt: altSchema.optional(),
  })
  .transform((value) => {
    const files: File[] = [];
    for (const field of [value.file, value.files, value["files[]"]]) {
      if (!field) continue;
      if (Array.isArray(field)) files.push(...field);
      else files.push(field);
    }
    return {
      files,
      folderId: value.folderId ?? null,
      visibility: value.visibility ?? "PUBLIC",
      alt: value.alt ?? null,
    };
  })
  .refine((value) => value.files.length > 0, { message: "Attach at least one file.", path: ["file"] })
  .refine((value) => value.files.length <= MAX_FILES_PER_UPLOAD, {
    message: `Upload at most ${MAX_FILES_PER_UPLOAD} files at a time.`,
    path: ["file"],
  });

export type UploadFormInput = z.output<typeof uploadFormSchema>;

export const replaceFormSchema = z
  .object({
    file: z.union([fileSchema, z.array(fileSchema)]),
  })
  .transform((value) => ({ file: Array.isArray(value.file) ? value.file[0] : value.file }))
  .refine((value) => Boolean(value.file), { message: "Attach a file.", path: ["file"] });

/** What the service takes: bytes plus what the browser claimed about them. */
export type UploadFile = {
  buffer: Buffer;
  filename: string;
  mimeType: string | null;
};

// ---------------------------------------------------------------------------
// Asset metadata
// ---------------------------------------------------------------------------

export const updateMediaSchema = z
  .object({
    alt: altSchema.optional(),
    folderId: nullableFolderIdSchema.optional(),
    filename: textSchema(200, "Filename").optional(),
  })
  .refine((value) => Object.values(value).some((entry) => entry !== undefined), {
    message: "Nothing to update.",
  });

export type UpdateMediaInput = z.output<typeof updateMediaSchema>;

export const mediaIdsSchema = z
  .array(mediaIdSchema)
  .min(1, "Select at least one file.")
  .max(100, "Select at most 100 files at a time.");

export const bulkDeleteSchema = z.object({ ids: mediaIdsSchema });
export const bulkMoveSchema = z.object({ ids: mediaIdsSchema, folderId: nullableFolderIdSchema });

// ---------------------------------------------------------------------------
// Folders
// ---------------------------------------------------------------------------

export const createFolderSchema = z.object({
  name: folderNameSchema,
  parentId: nullableFolderIdSchema.optional().transform((value) => value ?? null),
});
export type CreateFolderInput = z.output<typeof createFolderSchema>;

export const renameFolderSchema = z.object({ name: folderNameSchema });
export const moveFolderSchema = z.object({ parentId: nullableFolderIdSchema });

/** PUT /folders/:id accepts either or both. */
export const updateFolderSchema = z
  .object({
    name: folderNameSchema.optional(),
    parentId: nullableFolderIdSchema.optional(),
  })
  .refine((value) => value.name !== undefined || value.parentId !== undefined, {
    message: "Nothing to update.",
  });
export type UpdateFolderInput = z.output<typeof updateFolderSchema>;

// ---------------------------------------------------------------------------
// List filters (URL state; every field optional and tolerant of junk)
// ---------------------------------------------------------------------------

const isoDayOrDateTime = z
  .string()
  .trim()
  .refine((value) => !Number.isNaN(new Date(value).getTime()), "Invalid date.");

/**
 * `folderId` semantics: undefined = everywhere; "root" = assets without a
 * folder; any other id = that folder only (direct children, not the subtree -
 * the tree shows counts per folder so operators navigate, not search-by-tree).
 */
export const mediaListFiltersSchema = z.object({
  kind: mediaKindSchema.optional().catch(undefined),
  folderId: z
    .string()
    .trim()
    .min(1)
    .refine((value) => value === "root" || /^[A-Za-z0-9_-]{1,64}$/.test(value))
    .optional()
    .catch(undefined),
  visibility: mediaVisibilitySchema.optional().catch(undefined),
  q: z.string().trim().max(200).optional().catch(undefined),
  from: isoDayOrDateTime.optional().catch(undefined),
  to: isoDayOrDateTime.optional().catch(undefined),
  uploadedById: mediaIdSchema.optional().catch(undefined),
});

export type MediaListFilters = z.output<typeof mediaListFiltersSchema>;

/** Read filters straight off a page's searchParams / URLSearchParams. */
export function parseMediaListFilters(
  source: URLSearchParams | Record<string, string | string[] | undefined>,
): MediaListFilters {
  const get = (key: string): string | undefined => {
    if (source instanceof URLSearchParams) return source.get(key) ?? undefined;
    const value = source[key];
    return Array.isArray(value) ? value[0] : value;
  };
  return mediaListFiltersSchema.parse({
    kind: get("kind") || undefined,
    folderId: get("folder") || get("folderId") || undefined,
    visibility: get("visibility") || undefined,
    q: get("q") || undefined,
    from: get("from") || undefined,
    to: get("to") || undefined,
    uploadedById: get("uploadedBy") || undefined,
  });
}

export function resolveMediaSort(raw: string | undefined): MediaSort {
  return (MEDIA_SORTS as readonly string[]).includes(raw ?? "") ? (raw as MediaSort) : "createdAt";
}

export function resolveMediaView(raw: string | undefined): MediaView {
  return raw === "list" ? "list" : "grid";
}

// ---------------------------------------------------------------------------
// Filenames
// ---------------------------------------------------------------------------

const FILENAME_MAX = 120;

/**
 * Display-safe filename carrying the extension of the DETECTED type.
 * Path separators, control characters and leading dots are removed; the
 * original extension is dropped when it disagrees with reality.
 */
export function sanitizeFilename(original: string | null | undefined, mimeType: string): string {
  const ext = extensionForMime(mimeType) ?? "bin";
  const base = (original ?? "")
    .split(/[/\\]/)
    .pop()!
    .replace(/[\u0000-\u001f"<>|:*?]/g, "")
    .trim()
    .replace(/^\.+/, "");

  const dot = base.lastIndexOf(".");
  let stem = dot > 0 ? base.slice(0, dot) : base;
  const givenExt = dot > 0 ? base.slice(dot + 1).toLowerCase() : "";

  stem = stem.replace(/\s+/g, " ").trim();
  if (!stem) stem = "file";
  if (stem.length > FILENAME_MAX - ext.length - 1) stem = stem.slice(0, FILENAME_MAX - ext.length - 1).trim();

  // jpeg/jpg are the same type; anything else that disagrees gets the real extension appended.
  const sameExt = givenExt === ext || (ext === "jpg" && givenExt === "jpeg");
  return sameExt ? `${stem}.${givenExt}` : `${stem}.${ext}`;
}
