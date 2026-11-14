import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { reconcileHistory } from "./shared-history.mjs";

const move = (day, fromServer, toServer, source = "power") => ({ uid: "42", detectedAt: `2026-11-${day}T08:00:00Z`, fromServer, toServer, sources: [source] });
const name = (day, fromNickname, toNickname, source = "power") => ({ uid: "42", detectedAt: `2026-11-${day}T08:00:00Z`, fromNickname, toNickname, sources: [source] });

test("both collectors confirm one move across server dates, in either order", () => {
  for (const sources of [["power", "realpower"], ["realpower", "power"]]) {
    const rows = reconcileHistory([move("13", 1, 2, sources[0]), move("14", 1, 2, sources[1])], "movement");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].detectedAt, "2026-11-13T08:00:00Z");
    assert.deepEqual(rows[0].sources, ["power", "realpower"]);
  }
});

test("return trips and repeated nickname changes remain separate events", () => {
  assert.equal(reconcileHistory([move("12", 1, 2), move("13", 2, 1), move("14", 1, 2)], "movement").length, 3);
  assert.equal(reconcileHistory([name("12", "A", "B"), name("13", "B", "A"), name("14", "A", "B")], "nickname").length, 3);
});

test("a stale nickname comparison confirms the explicit chain instead of adding A -> C", () => {
  const rows = reconcileHistory([
    name("12", "A", "B"), name("13", "B", "C"),
    { ...name("14", "A", "C", "realpower"), inferred: true, fromObservedAt: "2026-11-11T08:00:00Z" }
  ], "nickname");
  assert.equal(rows.length, 2);
  assert.equal(rows[1].fromNickname, "B");
  assert.deepEqual(rows[1].sources, ["power", "realpower"]);
  assert.equal(rows[1].inferred, undefined);
});

test("an inferred change merges with a later explicit confirmation", () => {
  const rows = reconcileHistory([{ ...name("12", "A", "B", "realpower"), inferred: true }, name("14", "A", "B")], "nickname");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].detectedAt, "2026-11-12T08:00:00Z");
  assert.equal(rows[0].inferred, undefined);
});

test("legacy inferred rows with an obsolete origin confirm the known destination", () => {
  const rows = reconcileHistory([
    name("12", "Scotty", "Olsen"),
    { ...name("13", "SevenOf9", "Olsen", "realpower"), inferred: true }
  ], "nickname");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].fromNickname, "Scotty");
  assert.deepEqual(rows[0].sources, ["power", "realpower"]);
  const cycle = reconcileHistory([
    name("12", "A", "B"),
    { ...name("13", "B", "A", "realpower"), inferred: true },
    { ...name("14", "A", "B", "realpower"), inferred: true }
  ], "nickname");
  assert.equal(cycle.length, 3);
});

test("generator shares the baseline across runs, retains inferred history, and clears old duplicate dates", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "topwar-history-"));
  const write = (file, data) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), JSON.stringify(data));
  };
  const read = file => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
  const run = () => execFileSync(process.execPath, [fileURLToPath(new URL("./generate-overall.mjs", import.meta.url))], { cwd: root });
  try {
    write("power/playerData.json", [{ uid: "42", nickname: "A", server: 1, lastRequest: Date.parse("2026-11-12T08:00:00Z") / 1000 }]);
    write("realpower/1.json", { serverId: 1, exportedAt: "2026-11-13T08:00:00Z", players: [{ uid: "42", nickname: "B" }] });
    write("power/movement/2026-11-12.json", { rows: [move("12", 1, 2)] });
    write("power/movement/2026-11-14.json", { rows: [move("14", 1, 2, "realpower")] });
    write("overall/movement/2026-11-14.json", { rows: [move("14", 1, 2)] });
    run();
    assert.equal(read("overall/movement/2026-11-12.json").rows.length, 1);
    assert.deepEqual(read("overall/movement/2026-11-14.json").rows, []);
    assert.equal(read("overall/nickname/2026-11-13.json").rows.length, 1);
    // A subsequent map observation of B must not infer A -> B again tomorrow.
    write("realpower/1.json", { serverId: 1, exportedAt: "2026-11-14T08:00:00Z", players: [{ uid: "42", nickname: "B" }] });
    run();
    assert.equal(fs.existsSync(path.join(root, "overall/nickname/2026-11-14.json")), false);
    assert.equal(read("overall/nickname/2026-11-13.json").rows.length, 1);
    // Top100 catches up: promote the retained inferred row, preserving its first date.
    write("power/nickname/2026-11-14.json", { rows: [name("14", "A", "B")] });
    write("power/playerData.json", [{ uid: "42", nickname: "B", server: 1, lastRequest: Date.parse("2026-11-14T09:00:00Z") / 1000 }]);
    run();
    const confirmed = read("overall/nickname/2026-11-13.json").rows;
    assert.equal(confirmed.length, 1);
    assert.equal(confirmed[0].inferred, undefined);
    assert.deepEqual(confirmed[0].sources, ["power", "realpower"]);
    run();
    assert.deepEqual(read("overall/nickname/2026-11-13.json").rows, confirmed);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
