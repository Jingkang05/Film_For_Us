import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createApp } from "../server/index.mjs";

test("local owner setup requires the configured origin and can happen only once", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "roll-owner-test-"));
  const dbPath = join(directory, "album.sqlite");
  const password = randomUUID();
  const origin = "http://127.0.0.1";
  let server;
  let base;
  async function start() {
    server = createApp({ dbPath, origin, allowLocalSetup: true });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    base = `http://127.0.0.1:${server.address().port}`;
  }
  async function stop() {
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
  }
  t.after(async () => {
    await stop();
    await rm(directory, { recursive: true, force: true });
  });
  function request(path, { host = "127.0.0.1", from = origin, value, cookie } = {}) {
    const headers = { Host: host };
    if (cookie) headers.Cookie = cookie;
    if (value !== undefined) {
      headers.Origin = from;
      headers["Content-Type"] = "application/json";
    }
    return new Promise((resolve, reject) => {
      const req = httpRequest(base + path, { headers, method: value === undefined ? "GET" : "POST" }, async (res) => {
        try {
          const chunks = [];
          for await (const chunk of res) chunks.push(chunk);
          resolve({
            status: res.statusCode,
            cookie: res.headers["set-cookie"]?.[0]?.split(";")[0],
            body: JSON.parse(Buffer.concat(chunks)),
          });
        } catch (error) { reject(error); }
      });
      req.on("error", reject);
      req.end(value === undefined ? undefined : JSON.stringify(value));
    });
  }
  await start();
  const manage = "/api/manage";
  const setup = `${manage}/setup`;
  const value = { password };
  const unconfigured = await request(manage);
  assert.equal(unconfigured.status, 401);
  assert.equal(unconfigured.body.code, "setup-required");
  assert.equal((await request(setup, { value, from: "https://other.example" })).status, 403);
  assert.equal((await request(setup, { value, host: "other.example" })).status, 403);
  const results = await Promise.all([request(setup, { value }), request(setup, { value })]);
  const successful = results.filter((result) => result.status === 200);
  assert.equal(successful.length, 1);
  assert.equal((await request(setup, { value })).status, 403);
  const { cookie } = successful[0];
  assert.ok(cookie);
  assert.equal((await request(manage, { cookie })).status, 200);
  assert.equal((await request(manage)).status, 401);
  await stop();
  await start();
  assert.equal((await request(`${manage}/login`, { value: { password: randomUUID() } })).status, 401);
  assert.equal((await request(`${manage}/login`, { value })).status, 200);
});
