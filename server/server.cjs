"use strict";

const http = require("node:http");
const crypto = require("node:crypto");
const path = require("node:path");
const { mkdir, readFile, rename, writeFile } = require("node:fs/promises");

const DEFAULT_MAX_BODY_BYTES = 15 * 1024 * 1024;

function json(res, status, value, headers = {}) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    ...headers
  });
  res.end(body);
}

function corsHeaders(origin) {
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-max-age": "86400",
    vary: "Origin"
  };
}

function authorized(req, token) {
  if (!token) return true;
  const supplied = req.headers.authorization || "";
  const expected = `Bearer ${token}`;
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function readJson(req, maxBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      const error = new Error("요청 본문이 너무 큽니다.");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("올바른 JSON이 아닙니다.");
    error.status = 400;
    throw error;
  }
}

function validatePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return "본문은 JSON 객체여야 합니다.";
  }
  if (!Array.isArray(payload.results)) return "results 배열이 필요합니다.";
  if (payload.results.length > 100) return "results는 최대 100명까지 허용됩니다.";
  if (payload.mappedResults != null && !Array.isArray(payload.mappedResults)) {
    return "mappedResults는 배열이어야 합니다.";
  }
  if (payload.errors != null && !Array.isArray(payload.errors)) {
    return "errors는 배열이어야 합니다.";
  }
  return null;
}

async function atomicWrite(filePath, contents) {
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, contents, { encoding: "utf8", flag: "wx" });
  await rename(temporary, filePath);
}

function createApp(options = {}) {
  const dataDir = path.resolve(options.dataDir || process.env.DATA_DIR || "cross-pvp-data");
  const token = options.token ?? process.env.INGEST_TOKEN ?? "";
  const allowedOrigin = options.allowedOrigin || process.env.CORS_ORIGIN || "*";
  const maxBodyBytes = Number(options.maxBodyBytes || process.env.MAX_BODY_BYTES) || DEFAULT_MAX_BODY_BYTES;

  return http.createServer(async (req, res) => {
    const origin = allowedOrigin === "*" ? "*" : allowedOrigin;
    const cors = corsHeaders(origin);
    const url = new URL(req.url, "http://localhost");

    if (req.method === "OPTIONS") {
      res.writeHead(204, cors);
      return res.end();
    }

    if (req.method === "GET" && url.pathname === "/health") {
      return json(res, 200, { ok: true }, cors);
    }

    if (url.pathname === "/api/cross-pvp/latest" && req.method === "GET") {
      if (!authorized(req, token)) return json(res, 401, { error: "인증에 실패했습니다." }, cors);
      try {
        const latest = await readFile(path.join(dataDir, "latest.json"), "utf8");
        res.writeHead(200, { "content-type": "application/json; charset=utf-8", ...cors });
        return res.end(latest);
      } catch (error) {
        if (error.code === "ENOENT") return json(res, 404, { error: "저장된 결과가 없습니다." }, cors);
        return json(res, 500, { error: "결과를 읽지 못했습니다." }, cors);
      }
    }

    if (url.pathname !== "/api/cross-pvp/latest" || req.method !== "POST") {
      return json(res, 404, { error: "경로를 찾을 수 없습니다." }, cors);
    }
    if (!authorized(req, token)) return json(res, 401, { error: "인증에 실패했습니다." }, cors);
    if (!(req.headers["content-type"] || "").toLowerCase().startsWith("application/json")) {
      return json(res, 415, { error: "Content-Type은 application/json이어야 합니다." }, cors);
    }

    try {
      const payload = await readJson(req, maxBodyBytes);
      const validationError = validatePayload(payload);
      if (validationError) return json(res, 422, { error: validationError }, cors);

      const receivedAt = new Date().toISOString();
      const id = crypto.randomUUID();
      const record = { id, receivedAt, ...payload };
      const contents = `${JSON.stringify(record, null, 2)}\n`;
      await mkdir(dataDir, { recursive: true });
      await atomicWrite(path.join(dataDir, "latest.json"), contents);

      return json(res, 201, {
        ok: true,
        id,
        receivedAt,
        completed: payload.completed ?? payload.results.length
      }, cors);
    } catch (error) {
      return json(res, error.status || 500, {
        error: error.status ? error.message : "결과 저장 중 오류가 발생했습니다."
      }, cors);
    }
  });
}

if (require.main === module) {
  const host = process.env.HOST || "127.0.0.1";
  const port = Number(process.env.PORT) || 8787;
  if (!process.env.INGEST_TOKEN) {
    console.warn("[경고] INGEST_TOKEN이 비어 있어 인증 없이 저장할 수 있습니다.");
  }
  createApp().listen(port, host, () => {
    console.log(`TOPWAR ingest server: http://${host}:${port}`);
  });
}

module.exports = { createApp, validatePayload };
