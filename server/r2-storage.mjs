import { S3Client, GetObjectCommand, PutObjectCommand, HeadObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { StorageConflict, StorageFailure } from "./object-storage.mjs";

export function r2Config(env = process.env) {
  for (const key of ["R2_ENDPOINT", "R2_BUCKET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"]) {
    if (!env[key]) throw new Error(`Missing server configuration: ${key}`);
  }
  const endpoint = new URL(env.R2_ENDPOINT);
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash
      || endpoint.pathname !== "/" || !endpoint.hostname.endsWith(".r2.cloudflarestorage.com")) throw new Error("R2_ENDPOINT must be the HTTPS R2 S3 endpoint.");
  if (!/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(env.R2_BUCKET)) throw new Error("Invalid R2 bucket configuration.");
  if (env.VERCEL_ENV && env.R2_ENVIRONMENT !== env.VERCEL_ENV) throw new Error("R2_ENVIRONMENT must match the Vercel deployment environment.");
  // Separate secrets/buckets are required; do not implicitly select production for previews.
  if (env.VERCEL_ENV === "preview" && (env.R2_BUCKET === env.R2_PRODUCTION_BUCKET || /(?:^|-)(?:prod|production)(?:-|$)/.test(env.R2_BUCKET))) throw new Error("Preview cannot use the production R2 bucket.");
  return { endpoint: endpoint.origin, bucket: env.R2_BUCKET, region: env.R2_REGION || "auto",
    credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      ...(env.R2_SESSION_TOKEN ? { sessionToken: env.R2_SESSION_TOKEN } : {}) } };
}
export function createR2Storage({ bucket, endpoint, credentials, region = "auto", client, signer = getSignedUrl }) {
  const s3 = client ?? new S3Client({ endpoint, credentials, region, maxAttempts: 2,
    requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED" });
  async function send(op, command, missing = false) {
    try { return await s3.send(command); }
    catch (error) {
      const status = error.$metadata?.httpStatusCode;
      if (status === 412 || error.name === "PreconditionFailed") throw new StorageConflict();
      if (missing && (status === 404 || error.name === "NoSuchKey" || error.name === "NotFound")) return null;
      throw new StorageFailure(op, status, error.name ?? error.Code);
    }
  }
  return {
    provider: "r2",
    async read(key, { ifNoneMatch } = {}) {
      const result = await send("read", new GetObjectCommand({ Bucket: bucket, Key: key, IfNoneMatch: ifNoneMatch }), true);
      return result && { body: result.Body, size: result.ContentLength, etag: result.ETag, contentType: result.ContentType,
        metadata: result.Metadata ?? {} };
    },
    async put(key, body, { contentType = "application/octet-stream", ifMatch, createOnly = false, metadata } = {}) {
      if (createOnly && ifMatch) throw new Error("Choose create-only or compare-and-swap.");
      const result = await send("write", new PutObjectCommand({ Bucket: bucket, Key: key, Body: body,
        ContentType: contentType, IfMatch: ifMatch, IfNoneMatch: createOnly ? "*" : undefined, Metadata: metadata }));
      return { etag: result.ETag };
    },
    async stat(key) { const r = await send("metadata", new HeadObjectCommand({ Bucket: bucket, Key: key }), true);
      return r && { size: r.ContentLength, contentType: r.ContentType, etag: r.ETag, metadata: r.Metadata ?? {} }; },
    async delete(key) { await send("delete", new DeleteObjectCommand({ Bucket: bucket, Key: key })); },
    async list({ prefix, cursor, limit = 1000 } = {}) {
      const r = await send("list", new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: cursor, MaxKeys: limit }));
      return { objects: (r.Contents ?? []).map(o => ({ key: o.Key, size: o.Size, etag: o.ETag })), cursor: r.NextContinuationToken };
    },
    async signUpload(key, { expiresIn = 120 } = {}) {
      if (!Number.isInteger(expiresIn) || expiresIn < 1 || expiresIn > 300) throw new Error("Upload expiry exceeds policy.");
      const headers = { "Content-Type": "application/octet-stream", "If-None-Match": "*" };
      const url = await signer(s3, new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: headers["Content-Type"], IfNoneMatch: "*" }),
        { expiresIn, signableHeaders: new Set(["content-type", "if-none-match"]) });
      return { url, headers };
    },
  };
}
