import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";

import { env } from "@/lib/env";
import {
  assertSafeStorageKey,
  type PutObjectInput,
  type PutObjectResult,
  type StorageAdapter,
  type StorageStat,
  type StorageVisibility,
} from "@/lib/storage/types";

/**
 * Disk-backed adapter for development and single-server deployments (D6).
 *
 * Files live under `<STORAGE_LOCAL_DIR>/public/**` and `/private/**` -
 * deliberately NOT under Next's `public/` folder, because anything there is
 * served by the framework without our headers, our visibility check or our
 * MIME allowlist. Public files reach the browser only through
 * `GET /media/[...key]`.
 */
export class LocalDiskAdapter implements StorageAdapter {
  readonly driver = "local" as const;
  private readonly root: string;

  constructor(rootDir = env.STORAGE_LOCAL_DIR) {
    // The bundler's static analysis sees a runtime-computed path here and, to be
    // safe, traces the ENTIRE project into the server output (every source file
    // and all of public/). The directory is an operator-configured storage root,
    // never an imported module, so the trace is pure deadweight - it inflates the
    // deploy and can trip platform size limits. Opting out keeps the output lean.
    this.root = path.resolve(/* turbopackIgnore: true */ process.cwd(), rootDir);
  }

  /**
   * Resolve a key to an absolute path and prove the result is still inside
   * the visibility root. `assertSafeStorageKey` already forbids "..", but the
   * prefix check is a second, independent guard against a future grammar bug.
   */
  private resolve(key: string, visibility: StorageVisibility): string {
    assertSafeStorageKey(key);
    const base = path.join(this.root, visibility.toLowerCase());
    const target = path.resolve(base, ...key.split("/"));
    if (!target.startsWith(base + path.sep)) {
      throw new Error("Storage key resolves outside its root.");
    }
    return target;
  }

  async put({ key, body, visibility }: PutObjectInput): Promise<PutObjectResult> {
    const target = this.resolve(key, visibility);
    await mkdir(path.dirname(target), { recursive: true });

    // Write to a sibling temp file and rename: a crash mid-write leaves no
    // half-written object at the final key.
    const temp = `${target}.${randomBytes(6).toString("hex")}.tmp`;
    try {
      await writeFile(temp, body, { flag: "wx" });
      await rename(temp, target);
    } catch (error) {
      await rm(temp, { force: true }).catch(() => undefined);
      throw error;
    }

    return { key, url: visibility === "PUBLIC" ? this.publicUrl(key) : null };
  }

  async delete(key: string, visibility: StorageVisibility = "PUBLIC"): Promise<void> {
    await rm(this.resolve(key, visibility), { force: true });
  }

  publicUrl(key: string): string {
    assertSafeStorageKey(key);
    return `/media/${key}`;
  }

  async read(key: string, visibility: StorageVisibility = "PUBLIC"): Promise<Buffer> {
    return readFile(this.resolve(key, visibility));
  }

  async readStream(
    key: string,
    visibility: StorageVisibility = "PUBLIC",
    range?: { start: number; end: number },
  ): Promise<ReadableStream<Uint8Array>> {
    const target = this.resolve(key, visibility);
    const nodeStream = createReadStream(target, range ? { start: range.start, end: range.end } : {});
    return Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;
  }

  async exists(key: string, visibility: StorageVisibility = "PUBLIC"): Promise<boolean> {
    return (await this.stat(key, visibility)) !== null;
  }

  async stat(key: string, visibility: StorageVisibility = "PUBLIC"): Promise<StorageStat | null> {
    try {
      const info = await stat(this.resolve(key, visibility));
      if (!info.isFile()) return null;
      return { size: info.size, lastModified: info.mtime };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
}
