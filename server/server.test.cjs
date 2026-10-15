"use strict";

const assert = require("node:assert/strict");
const { mkdtemp, readFile, rm } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createApp } = require("./server.cjs");

test("인증된 조사 결과를 latest에 저장하고 조회한다", async t => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "topwar-ingest-"));
  const server = createApp({ dataDir, token: "test-secret" });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  });

  const base = `http://127.0.0.1:${server.address().port}`;
  const unauthorized = await fetch(`${base}/api/cross-pvp/latest`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ results: [] })
  });
  assert.equal(unauthorized.status, 401);

  const created = await fetch(`${base}/api/cross-pvp/latest`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer test-secret"
    },
    body: JSON.stringify({ completed: 1, results: [{ rank: 1, uid: "123" }], errors: [] })
  });
  assert.equal(created.status, 201);
  const receipt = await created.json();
  assert.equal(receipt.ok, true);

  const latest = JSON.parse(await readFile(path.join(dataDir, "latest.json"), "utf8"));
  assert.equal(latest.id, receipt.id);
  assert.equal(latest.results[0].uid, "123");

  const replaced = await fetch(`${base}/api/cross-pvp/latest`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer test-secret"
    },
    body: JSON.stringify({ completed: 1, results: [{ rank: 1, uid: "456" }], errors: [] })
  });
  assert.equal(replaced.status, 201);

  const fetched = await fetch(`${base}/api/cross-pvp/latest`, {
    headers: { authorization: "Bearer test-secret" }
  });
  assert.equal(fetched.status, 200);
  const current = await fetched.json();
  assert.notEqual(current.id, receipt.id);
  assert.equal(current.results[0].uid, "456");
});

test("잘못된 payload를 거절한다", async t => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "topwar-ingest-"));
  const server = createApp({ dataDir });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  });
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/cross-pvp/latest`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ results: "not-an-array" })
  });
  assert.equal(response.status, 422);
});

