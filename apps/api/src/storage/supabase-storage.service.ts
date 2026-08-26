import { Injectable, Logger } from "@nestjs/common";
import { z } from "zod";
import { ConfigService } from "../config/config.service";
import { StorageService, type ObjectStat, type SignedUrl } from "./storage.service";

/**
 * Supabase Storage over its REST API, using the platform `fetch`.
 *
 * The `@supabase/supabase-js` client is deliberately not a dependency. Five calls are needed,
 * each is one request, and the SDK would pull in a Postgres client, a realtime socket and an
 * auth module that this process must never use with a service-role key. The endpoints below
 * are the same ones the SDK posts to.
 */

/** `POST /object/upload/sign/...` answers a path plus a token, not an absolute URL. */
const signedUploadSchema = z.object({ url: z.string().min(1) });

/** `POST /object/sign/...` answers `signedURL`, spelled with that capitalisation. */
const signedDownloadSchema = z.object({ signedURL: z.string().min(1) });

/** Range reads and stats go through the authenticated route, never the public one. */
const STORAGE_API_PREFIX = "/storage/v1";

@Injectable()
export class SupabaseStorageService extends StorageService {
  private readonly logger = new Logger(SupabaseStorageService.name);
  private readonly projectUrl: string;
  private readonly secretKey: string;
  private readonly bucket: string;

  constructor(config: ConfigService) {
    super();
    this.projectUrl = config.get("SUPABASE_URL");
    this.secretKey = config.get("SUPABASE_SECRET_KEY");
    this.bucket = config.get("SUPABASE_STORAGE_BUCKET");
  }

  /**
   * A one-shot upload URL. `expiresIn` binds the token; the returned expiry is computed from
   * the same number rather than parsed back out of the token, because the client uses it to
   * decide when to take a fresh reservation and a token's own claim is not more truthful.
   */
  async createUploadUrl(key: string, contentType: string, ttlSeconds: number): Promise<SignedUrl> {
    const body = await this.call(
      "POST",
      `/object/upload/sign/${this.objectPath(key)}`,
      signedUploadSchema,
      { expiresIn: ttlSeconds },
    );

    // The content type is not part of this request: Supabase takes it from the PUT's own
    // `Content-Type` header, which is why the browser must send exactly what the intent
    // declared. Named here so the parameter is not mistaken for something being dropped.
    void contentType;

    return { url: this.absolute(body.url), expiresAt: this.expiryFor(ttlSeconds) };
  }

  async createDownloadUrl(key: string, ttlSeconds: number): Promise<SignedUrl> {
    const body = await this.call(
      "POST",
      `/object/sign/${this.objectPath(key)}`,
      signedDownloadSchema,
      { expiresIn: ttlSeconds },
    );

    return { url: this.absolute(body.signedURL), expiresAt: this.expiryFor(ttlSeconds) };
  }

  /**
   * A 404 is success. The caller is always removing an object whose metadata has already
   * gone, and "it was not there" is the state it wanted — treating it as a failure would put
   * a key on the retry queue that no number of retries can ever drain.
   */
  async deleteObject(key: string): Promise<void> {
    const response = await this.send("DELETE", `/object/${this.objectPath(key)}`);

    if (response.ok || response.status === 404) return;

    throw new Error(`Supabase Storage refused to delete ${key}: ${String(response.status)}.`);
  }

  /**
   * HEAD rather than a listing: a listing is a prefix query whose answer has to be searched,
   * and it reports a stale size for an object written moments ago.
   */
  async statObject(key: string): Promise<ObjectStat | null> {
    const response = await this.send("HEAD", `/object/authenticated/${this.objectPath(key)}`);

    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`Supabase Storage refused to stat ${key}: ${String(response.status)}.`);
    }

    const length = Number(response.headers.get("content-length"));

    if (!Number.isFinite(length)) {
      // Every provider sends it on a HEAD, so its absence means something upstream rewrote
      // the response. Failing is right: commit records this number as the file's real size.
      throw new Error(`Supabase Storage reported no size for ${key}.`);
    }

    return { sizeBytes: length, contentType: response.headers.get("content-type") };
  }

  /**
   * The first bytes, over a Range request, so validating a 50 MB PDF costs five bytes of
   * transfer. A provider that ignores the header answers 200 with the whole object; slicing
   * afterwards keeps that correct rather than merely slow.
   */
  async readRange(key: string, length: number): Promise<Uint8Array> {
    if (length <= 0) return new Uint8Array(0);

    const response = await this.send("GET", `/object/authenticated/${this.objectPath(key)}`, {
      Range: `bytes=0-${String(length - 1)}`,
    });

    // 416 means the object is shorter than the range asked for — an object too small to hold
    // a PDF signature. That is a rejection for the caller to make, not an error here.
    if (response.status === 404 || response.status === 416) return new Uint8Array(0);

    if (!response.ok) {
      throw new Error(`Supabase Storage refused to read ${key}: ${String(response.status)}.`);
    }

    const buffer = await response.arrayBuffer();

    return new Uint8Array(buffer).slice(0, length);
  }

  private async call<T>(
    method: "POST",
    path: string,
    schema: z.ZodType<T>,
    body: unknown,
  ): Promise<T> {
    const response = await this.send(method, path, { "Content-Type": "application/json" }, body);

    if (!response.ok) {
      throw new Error(`Supabase Storage answered ${String(response.status)} for ${path}.`);
    }

    const parsed = schema.safeParse(await response.json());

    if (!parsed.success) {
      // A shape change at the provider must not surface as `undefined` inside a URL the
      // browser is then told to PUT to.
      this.logger.error(`Unexpected Supabase Storage response for ${path}.`);
      throw new Error(`Supabase Storage answered an unexpected shape for ${path}.`);
    }

    return parsed.data;
  }

  private send(
    method: "GET" | "POST" | "DELETE" | "HEAD",
    path: string,
    headers: Record<string, string> = {},
    body?: unknown,
  ): Promise<Response> {
    return fetch(`${this.projectUrl}${STORAGE_API_PREFIX}${path}`, {
      method,
      headers: {
        // Supabase's gateway wants the key in both places; sending only one is a 401 whose
        // message does not say which was missing.
        apikey: this.secretKey,
        Authorization: `Bearer ${this.secretKey}`,
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  /**
   * `dataRoomId/nodeId` is two UUIDs, so nothing here needs escaping today. Encoding each
   * segment anyway is what keeps that true if a key layout ever gains a segment that is not
   * a UUID — and `encodeURIComponent` on the whole key would escape the separator itself.
   */
  private objectPath(key: string): string {
    const segments = key.split("/").map((segment) => encodeURIComponent(segment));

    return `${this.bucket}/${segments.join("/")}`;
  }

  /** Signing endpoints answer a path relative to the storage API, not an absolute URL. */
  private absolute(path: string): string {
    if (path.startsWith("http://") || path.startsWith("https://")) return path;

    return `${this.projectUrl}${STORAGE_API_PREFIX}/${path.replace(/^\/+/, "")}`;
  }

  private expiryFor(ttlSeconds: number): Date {
    return new Date(Date.now() + ttlSeconds * 1000);
  }
}
