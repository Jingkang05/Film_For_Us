import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import sharp from "sharp";
import { openAlbum, Problem } from "./album.mjs";
import { demo } from "./demo.mjs";

const publicDir = fileURLToPath(new URL("../public/", import.meta.url));
const maxBytes = 20 * 1024 * 1024;
const maxPixels = 50_000_000;
const sessionLifetime = 12 * 60 * 60;
const loginWindow = 15 * 60 * 1000;
const mimeTypes = { html: "text/html; charset=utf-8", css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8", svg: "image/svg+xml", webp: "image/webp", woff2: "font/woff2" };
const hash = (value) => createHash("sha256").update(value).digest("hex");
const derivePassword = promisify(scrypt);
const photoId = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const photoIdPattern = new RegExp(`^${photoId}$`);
const shareId = "[a-zA-Z0-9_-]{16}";
const publishedRoute = new RegExp(`^/api/a/(${shareId})(?:/media/(${photoId})/(thumb|full))?$`);
const draftMedia = new RegExp(`^/api/draft-media/(${photoId})/(thumb|full)$`);
const pageRoute = new RegExp(`^/(?:demo/?|manage(?:/preview)?/?|a/${shareId}/?)?$`);
const staticRoute = /^\/(?:(?:darkroom|envelope|manage|polaroid|typography)\.css|ui\/[a-z-]+\.js|assets\/[a-z0-9.-]+\.(?:svg|webp|woff2)|samples\/[a-z0-9-]+\.webp)$/;
const soundtrack = "/assets/who-knows.m4a";

async function body(req, limit) {
  if (Number(req.headers["content-length"]) > limit) {
    req.resume();
    throw new Problem(413, "The file exceeds the size limit.");
  }
  const buffers = [];
  let size = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > limit) {
      req.resume();
      throw new Problem(413, "The file exceeds the size limit.");
    }
    buffers.push(chunk);
  }
  return Buffer.concat(buffers, size);
}

async function jsonBody(req) {
  if (req.headers["content-type"]?.split(";")[0] !== "application/json") {
    throw new Problem(415, "The request format is invalid.");
  }
  const raw = await body(req, 512 * 1024);
  try {
    return JSON.parse(raw);
  } catch {
    throw new Problem(400, "The request format is invalid.");
  }
}

async function processPhoto(source) {
  const jpeg = source.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
  const png = source.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const webp = source.toString("ascii", 0, 4) === "RIFF" && source.toString("ascii", 8, 12) === "WEBP";
  if (!jpeg && !png && !webp) throw new Problem(415, "Export the photo as JPEG, PNG, or WebP, then try again.");
  try {
    const image = sharp(source, { limitInputPixels: maxPixels, failOn: "error" });
    const { format, width, height, pages } = await image.metadata();
    if (!["jpeg", "png", "webp"].includes(format)) {
      throw new Problem(415, "Export the photo as JPEG, PNG, or WebP, then try again.");
    }
    if (pages > 1) throw new Problem(415, "Choose a still image.");
    if (!width || !height || width * height > maxPixels) throw new Problem(413, "Photos must be 50 megapixels or smaller.");
    const render = (size, quality) => image.clone().autoOrient()
      .resize({ width: size, height: size, fit: "inside", withoutEnlargement: true }).webp({ quality }).toBuffer();
    const full = await render(1800, 88);
    const thumb = await render(480, 80);
    return { source, thumb, full };
  } catch (error) {
    if (error instanceof Problem) throw error;
    if (String(error.message).includes("pixel limit")) throw new Problem(413, "Photos must be 50 megapixels or smaller.");
    throw new Problem(422, "The photo could not be read. Check the file or save it again as JPEG or PNG.");
  }
}

function send(res, status, content, type = "application/json; charset=utf-8", cache = "no-store") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": cache });
  res.end(type.startsWith("application/json") ? JSON.stringify(content) : content);
}

function sendAudio(req, res, audio) {
  const headers = { "Content-Type": "audio/mp4", "Cache-Control": "no-cache", "Accept-Ranges": "bytes" };
  const range = req.method === "GET" && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, audio.length - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(audio.length - 1, Number(range[2])) : audio.length - 1;
    if (start > end) {
      res.writeHead(416, { ...headers, "Content-Range": `bytes */${audio.length}` });
      return res.end();
    }
    res.writeHead(206, { ...headers, "Content-Range": `bytes ${start}-${end}/${audio.length}`,
      "Content-Length": end - start + 1 });
    return res.end(audio.subarray(start, end + 1));
  }
  res.writeHead(200, { ...headers, "Content-Length": audio.length });
  return res.end(req.method === "HEAD" ? undefined : audio);
}

export function createHandler({ data, password = "", origin, allowLocalSetup = false, allowStoredOwner = false }) {
  const originUrl = new URL(origin);
  const secure = originUrl.protocol === "https:" ? "; Secure" : "";
  let uploads = 0;
  const attempts = new Map();
  const cookie = (token, seconds) => `roll_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${seconds}${secure}`;
  const readToken = (req) => req.headers.cookie?.match(/(?:^|;\s*)roll_session=([a-f0-9]{64})(?:;|$)/)?.[1];
  const localMode = allowLocalSetup && !password && ["127.0.0.1", "localhost"].includes(originUrl.hostname);
  const localRequest = (req) => localMode && req.headers.host === originUrl.host
    && req.socket.localAddress === "127.0.0.1" && req.socket.remoteAddress === "127.0.0.1";
  const canSetUp = async (req) => localRequest(req) && !await data.localOwner();
  async function signIn(res) {
    const token = randomBytes(32).toString("hex");
    await data.addSession(hash(token), Date.now() + sessionLifetime * 1000);
    res.setHeader("Set-Cookie", cookie(token, sessionLifetime));
    return send(res, 200, await data.manage());
  }

  async function requireOwner(req) {
    const token = readToken(req);
    const storedOwner = allowStoredOwner || localRequest(req);
    if (!token || !(password.length >= 12 || storedOwner && await data.localOwner())
        || !await data.sessionValid(hash(token))) throw new Problem(401, "Sign in to manage the album.");
    return token;
  }

  async function route(req, res) {
    const url = new URL(req.url, origin);
    const path = url.pathname;
    if (path === soundtrack && (req.method === "GET" || req.method === "HEAD")) {
      return sendAudio(req, res, await readFile(resolve(publicDir, soundtrack.slice(1))));
    }
    if (req.method === "GET") {
      if (path === "/api/demo") return send(res, 200, demo);
      if (path === "/api/manage" || path === "/api/preview") {
        if (path === "/api/manage" && await canSetUp(req)) {
          throw new Problem(401, "Create an owner password to get started.", "setup-required");
        }
        await requireOwner(req);
        return send(res, 200, await (path === "/api/manage" ? data.manage() : data.preview()));
      }
      const published = path.match(publishedRoute);
      if (published) {
        const [, share, id, variant] = published;
        return id ? send(res, 200, await data.media(id, variant, share), "image/webp")
          : send(res, 200, await data.published(share));
      }
      const media = path.match(draftMedia);
      if (media) {
        await requireOwner(req);
        return send(res, 200, await data.media(media[1], media[2]), "image/webp");
      }
      const page = pageRoute.test(path);
      if (page || staticRoute.test(path)) {
        const file = page ? "index.html" : path.slice(1);
        const content = await readFile(resolve(publicDir, file)).catch((error) => {
          if (error.code === "ENOENT") throw new Problem(404, "This file could not be found.");
          throw error;
        });
        return send(res, 200, content, mimeTypes[file.split(".").at(-1)],
          file.startsWith("samples/") ? "public, max-age=86400" : "no-cache");
      }
    }

    if (req.method !== "POST" || !path.startsWith("/api/manage/")) throw new Problem(404, "This page could not be found.");
    if (req.headers.origin !== origin) throw new Problem(403, "Submit this request from the album editor.");

    if (path === "/api/manage/setup") {
      if (!await canSetUp(req)) throw new Problem(403, "Owner setup is unavailable. Sign in to manage the album.");
      const input = await jsonBody(req);
      const supplied = input?.password;
      if (typeof supplied !== "string" || supplied.length < 12 || supplied.length > 1024 || !supplied.trim()) {
        throw new Problem(422, "Choose a password between 12 and 1,024 characters.");
      }
      const salt = randomBytes(16).toString("hex");
      const digest = await derivePassword(supplied, salt, 64);
      await data.createLocalOwner(salt, digest.toString("hex"));
      return signIn(res);
    }

    if (path === "/api/manage/login") {
      const owner = password.length < 12 && (allowStoredOwner || localRequest(req)) ? await data.localOwner() : undefined;
      if (password.length < 12 && !owner) throw new Problem(503, "Set an owner password of at least 12 characters on the server.");
      const key = data.recordLoginAttempt
        ? `ip:${req.headers["x-vercel-forwarded-for"] ?? req.socket.remoteAddress}`
        : req.socket.remoteAddress;
      const now = Date.now();
      let attempt;
      if (data.recordLoginAttempt) {
        await data.recordLoginAttempt(key);
      } else {
        for (const [address, entry] of attempts) if (entry.until <= now) attempts.delete(address);
        attempt = attempts.get(key) ?? { count: 0, until: now + loginWindow };
        if (attempt.count >= 8 || attempts.size >= 1000) {
          throw new Problem(429, "Too many attempts. Try again in 15 minutes.");
        }
      }
      const input = await jsonBody(req);
      const supplied = input?.password;
      const expected = Buffer.from(owner?.password_hash ?? hash(password), "hex");
      const candidate = typeof supplied !== "string" || supplied.length > 1024 ? null
        : owner ? await derivePassword(supplied, owner.salt, 64) : Buffer.from(hash(supplied), "hex");
      if (!candidate || !timingSafeEqual(candidate, expected)) {
        if (!data.recordLoginAttempt) {
          const current = attempts.get(key) ?? attempt;
          current.count++;
          attempts.set(key, current);
        }
        throw new Problem(401, "Incorrect password. Try again.");
      }
      if (data.clearLoginAttempts) await data.clearLoginAttempts(key);
      else attempts.delete(key);
      return signIn(res);
    }

    const token = await requireOwner(req);
    if (path === "/api/manage/logout") {
      await data.deleteSession(hash(token));
      res.setHeader("Set-Cookie", cookie("", 0));
      return send(res, 200, { ok: true });
    }
    if (path === "/api/manage/save" || path === "/api/manage/publish") {
      const input = await jsonBody(req);
      const result = await (path.endsWith("/save") ? data.save(input?.revision, input?.album) : data.publish(input?.revision));
      return send(res, 200, result);
    }
    if (path === "/api/manage/upload" || (path === "/api/manage/upload-target" && data.uploadTarget)) {
      const id = url.searchParams.get("id");
      const roll = url.searchParams.get("roll");
      const revision = url.searchParams.get("revision");
      if (!id || !photoIdPattern.test(id) || !roll || !/^roll-[1-3]$/.test(roll)
          || !revision || !/^\d+$/.test(revision)) throw new Problem(422, "This upload could not start. Choose the photo again.");
      if (path.endsWith("/upload-target")) {
        return send(res, 200, await data.uploadTarget(id, Number(revision), maxBytes));
      }
      if (await data.hasUpload(id)) {
        req.resume();
        return send(res, 200, await data.manage());
      }
      if (uploads >= 2) throw new Problem(429, "Other photos are being processed. Try again in a moment.");
      uploads++;
      try {
        const source = data.uploadSource ? await data.uploadSource(id, maxBytes) : await body(req, maxBytes);
        const files = await processPhoto(source);
        await requireOwner(req);
        return send(res, 200, await data.addPhoto(Number(revision), roll, id, files));
      } finally {
        uploads--;
      }
    }
    throw new Problem(404, "This page could not be found.");
  }

  return (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    return route(req, res).catch((error) => {
      if (res.destroyed || res.headersSent) return;
      req.resume();
      if (!(error instanceof Problem)) console.error(error);
      send(res, error instanceof Problem ? error.status : 500, {
        error: error instanceof Problem ? error.message : "The server could not complete the request. Try again.",
        code: error instanceof Problem ? error.code : undefined,
      });
    });
  };
}

export function createApp({ dbPath, ...options }) {
  const data = openAlbum(dbPath);
  const server = createServer(createHandler({ data, ...options }));
  server.once("close", () => data.close());
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.umask(0o077);
  const port = Number(process.env.PORT ?? 4173);
  const host = process.env.HOST ?? "127.0.0.1";
  const origin = new URL(process.env.APP_ORIGIN ?? `http://127.0.0.1:${port}`).origin;
  const dbPath = resolve(process.env.ROLL_DATA_DIR ?? ".data", "album.sqlite");
  const server = createApp({ dbPath, origin, password: process.env.OWNER_PASSWORD, allowLocalSetup: host === "127.0.0.1" });
  server.listen(port, host, () => console.log(`Film for us · ${origin}`));
}
