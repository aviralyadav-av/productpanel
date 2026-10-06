import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import { env } from "@/lib/env";
import {
  assertSafeStorageKey,
  IMMUTABLE_CACHE_CONTROL,
  type PutObjectInput,
  type PutObjectResult,
  type StorageAdapter,
  type StorageStat,
  type StorageVisibility,
} from "@/lib/storage/types";

/**
 * S3-compatible adapter (AWS S3, Cloudflare R2, MinIO) for multi-instance
 * deployments where a local disk is not shared (D6).
 *
 * Visibility is expressed as a key prefix - `public/<key>` and
 * `private/<key>` - rather than per-object ACLs, because R2 has no ACLs and
 * AWS disables them on new buckets. Grant anonymous `s3:GetObject` on
 * `public/*` via bucket policy (or put a CDN in front and set S3_PUBLIC_URL);
 * everything else is read only through this adapter with our credentials.
 */
export class S3Adapter implements StorageAdapter {
  readonly driver = "s3" as const;
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor() {
    const bucket = env.S3_BUCKET;
    const region = env.S3_REGION;
    if (!bucket || !region) {
      throw new Error("STORAGE_DRIVER=s3 requires S3_BUCKET and S3_REGION.");
    }
    this.bucket = bucket;
    this.client = new S3Client({
      region,
      endpoint: env.S3_ENDPOINT,
      // Custom endpoints (MinIO, R2) rarely support virtual-host buckets.
      forcePathStyle: Boolean(env.S3_ENDPOINT),
      credentials:
        env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
          ? { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY }
          : undefined,
    });
  }

  private objectKey(key: string, visibility: StorageVisibility): string {
    assertSafeStorageKey(key);
    return `${visibility.toLowerCase()}/${key}`;
  }

  async put({ key, body, contentType, visibility, cacheControl }: PutObjectInput): Promise<PutObjectResult> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.objectKey(key, visibility),
        Body: body,
        ContentType: contentType,
        CacheControl:
          cacheControl ?? (visibility === "PUBLIC" ? IMMUTABLE_CACHE_CONTROL : "private, no-store"),
        // Documents download instead of rendering, mirroring /media behaviour.
        ContentDisposition:
          contentType.startsWith("image/") || contentType.startsWith("video/") ? undefined : "attachment",
      }),
    );
    return { key, url: visibility === "PUBLIC" ? this.publicUrl(key) : null };
  }

  async delete(key: string, visibility: StorageVisibility = "PUBLIC"): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key, visibility) }),
    );
  }

  publicUrl(key: string): string {
    const objectKey = this.objectKey(key, "PUBLIC");
    if (env.S3_PUBLIC_URL) return `${env.S3_PUBLIC_URL}/${objectKey}`;
    if (env.S3_ENDPOINT) {
      return `${env.S3_ENDPOINT.replace(/\/+$/, "")}/${this.bucket}/${objectKey}`;
    }
    return `https://${this.bucket}.s3.${env.S3_REGION}.amazonaws.com/${objectKey}`;
  }

  async read(key: string, visibility: StorageVisibility = "PUBLIC"): Promise<Buffer> {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key, visibility) }),
    );
    if (!result.Body) throw new Error("Empty S3 response body.");
    return Buffer.from(await result.Body.transformToByteArray());
  }

  async readStream(
    key: string,
    visibility: StorageVisibility = "PUBLIC",
    range?: { start: number; end: number },
  ): Promise<ReadableStream<Uint8Array>> {
    const result = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: this.objectKey(key, visibility),
        Range: range ? `bytes=${range.start}-${range.end}` : undefined,
      }),
    );
    if (!result.Body) throw new Error("Empty S3 response body.");
    return result.Body.transformToWebStream() as ReadableStream<Uint8Array>;
  }

  async exists(key: string, visibility: StorageVisibility = "PUBLIC"): Promise<boolean> {
    return (await this.stat(key, visibility)) !== null;
  }

  async stat(key: string, visibility: StorageVisibility = "PUBLIC"): Promise<StorageStat | null> {
    try {
      const head = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key, visibility) }),
      );
      return { size: head.ContentLength ?? 0, lastModified: head.LastModified ?? null };
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      const name = (error as { name?: string }).name;
      if (status === 404 || name === "NotFound" || name === "NoSuchKey") return null;
      throw error;
    }
  }
}
