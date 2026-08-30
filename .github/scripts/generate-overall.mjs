import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const POWER_DIR = path.join(ROOT, "power");
const REALPOWER_DIR = path.join(ROOT, "realpower");
const KARTZ_HISTORY_DIR = path.join(ROOT, "kartz", "history");
const OUTPUT_DIR = path.join(ROOT, "overall");
const MOVEMENT_DIR = path.join(OUTPUT_DIR, "movement");
const NICKNAME_DIR = path.join(OUTPUT_DIR, "nickname");
const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));
const text = value => value == null ? null : (String(value).trim() || null);
const number = value => { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; };
const uidOf = row => text(row?.uid ?? row?.pid ?? row?.userId ?? row?.playerId);
const clean = value => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== null && item !== undefined && item !== ""));

function datedFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory).filter(filename => /^\d{4}-\d{2}-\d{2}\.json$/.test(filename)).sort().map(filename => path.join(directory, filename));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const content = `${JSON.stringify(value)}\n`;
  if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === content) return false;
  fs.writeFileSync(file, content, "utf8");
  return true;
}

function serverDate(instant) {
  const timestamp = Date.parse(instant || "");
  return new Date((Number.isFinite(timestamp) ? timestamp : Date.now()) + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function normalizePowerPlayer(row) {
  const uid = uidOf(row);
  if (!uid) return null;
  const observedUnix = number(row.lastRequest);
  return clean({
    uid, nickname: text(row.nickname), server: number(row.server ?? row.serverId), power: number(row.cp ?? row.score ?? row.power),
    level: number(row.level), allianceId: text(row.allianceId), allianceTag: text(row.allianceTag), allianceName: text(row.allianceName),
    isOnline: row.isOnline === true || row.online === true, lastLogin: number(row.lastLogin), language: text(row.lang ?? row.language),
    nationalflag: number(row.countryFlag ?? row.nationalflag), profile: text(row.profile),
    observedAt: observedUnix ? new Date(observedUnix * 1000).toISOString() : null
  });
}

function normalizeRealPlayer(row, document) {
  const uid = uidOf(row);
  if (!uid) return null;
  return clean({
    uid, nickname: text(row.nickname ?? row.username), server: number(row.serverId ?? document.serverId), power: number(row.power),
    level: number(row.level), allianceId: text(row.allianceId), allianceTag: text(row.allianceTag), allianceName: text(row.allianceName),
    allianceRole: number(row.allianceRole), isOnline: row.isOnline === 1 || row.isOnline === true, lastLogin: number(row.lastLogin),
    language: text(row.language), nationalflag: number(row.nationalflag), headFrameId: number(row.headFrameId), x: number(row.x), y: number(row.y),
    pointId: number(row.pointId), pointType: number(row.pointType), armyPower: text(row.armyPower), armyPowerText: text(row.armyPowerText),
    activityGrade: text(row.activityGrade), userStatus: text(row.userStatus), observedAt: text(document.exportedAt)
  });
}

function normalizeKartzPlayer(row, document) {
  const uid = uidOf(row);
  if (!uid) return null;
  return clean({
    observedAt: text(document.time), rank: number(row.rank), round: number(row.round), damage: text(row.damage),
    server: number(row.server), nickname: text(row.nickname), nation: number(row.nation), gender: number(row.gender),
    profile: text(row.profile)
  });
}

function latestKartzSnapshot() {
  if (!fs.existsSync(KARTZ_HISTORY_DIR)) return null;
  const snapshots = [];
  for (const filename of fs.readdirSync(KARTZ_HISTORY_DIR).filter(name => /^\d{4}-\d{2}\.json$/.test(name)).sort()) {
    const document = readJson(path.join(KARTZ_HISTORY_DIR, filename));
    for (const snapshot of Array.isArray(document) ? document : [document]) {
      if (snapshot?.playerRankList?.some(row => uidOf(row))) snapshots.push(snapshot);
    }
  }
  return snapshots.sort((left, right) => observedMs({ observedAt: left.time }) - observedMs({ observedAt: right.time })).at(-1) ?? null;
}

function observedMs(row) { const value = Date.parse(row?.observedAt || ""); return Number.isFinite(value) ? value : 0; }
function sourceSnapshot(row, source) { return row ? clean({ source, server: row.server, nickname: row.nickname, power: row.power, observedAt: row.observedAt }) : null; }
function observationsDiffer(left, right) {
  return left && right && (
    left.server !== right.server ||
    left.nickname?.normalize("NFC") !== right.nickname?.normalize("NFC") ||
    left.power !== right.power
  );
}
function normalizeMovement(row, source, document) {
  const uid = uidOf(row ?? row?.to ?? row?.from);
  const fromServer = number(row?.fromServer ?? row?.from?.server ?? row?.from?.serverId);
  const toServer = number(row?.toServer ?? row?.to?.server ?? row?.to?.serverId);
  if (!uid || fromServer == null || toServer == null || fromServer === toServer) return null;
  return clean({
    detectedAt: text(row.detectedAt ?? row.t ?? document.updatedAt), uid,
    nickname: text(row.nickname ?? row.name ?? row.to?.nickname ?? row.from?.nickname), fromServer, toServer,
    from: row.from && typeof row.from === "object" ? row.from : null,
    to: row.to && typeof row.to === "object" ? row.to : null, sources: [source]
  });
}

function normalizeNickname(row, source, document) {
  const uid = uidOf(row ?? row?.to ?? row?.from);
  const fromNickname = text(row?.fromNickname ?? row?.from?.nickname);
  const toNickname = text(row?.toNickname ?? row?.to?.nickname);
  if (!uid || !fromNickname || !toNickname || fromNickname.normalize("NFC") === toNickname.normalize("NFC")) return null;
  return clean({
    detectedAt: text(row.detectedAt ?? row.t ?? document.updatedAt), uid, fromNickname, toNickname,
    server: number(row.server ?? row.toServer ?? row.to?.server ?? row.to?.serverId),
    fromServer: number(row.fromServer ?? row.from?.server ?? row.from?.serverId),
    toServer: number(row.toServer ?? row.to?.server ?? row.to?.serverId), serverChanged: row.serverChanged === true, sources: [source]
  });
}

function mergeEvent(groups, date, event, key) {
  if (!event) return;
  groups.set(date, groups.get(date) ?? new Map());
  const previous = groups.get(date).get(key);
  groups.get(date).set(key, previous ? clean({
    ...previous, ...event,
    detectedAt: [previous.detectedAt, event.detectedAt].filter(Boolean).sort()[0] ?? null,
    sources: [...new Set([...(previous.sources ?? []), ...(event.sources ?? [])])].sort(),
    inferred: previous.inferred === true && event.inferred === true ? true : null
  }) : event);
}

const powerByUid = new Map();
for (const raw of readJson(path.join(POWER_DIR, "playerData.json"))) {
  const player = normalizePowerPlayer(raw);
  if (player && (!powerByUid.has(player.uid) || observedMs(player) >= observedMs(powerByUid.get(player.uid)))) powerByUid.set(player.uid, player);
}

const realByUid = new Map();
for (const filename of fs.readdirSync(REALPOWER_DIR).filter(name => /^\d+\.json$/.test(name)).sort()) {
  const document = readJson(path.join(REALPOWER_DIR, filename));
  for (const raw of document.players ?? []) {
    const player = normalizeRealPlayer(raw, document);
    if (player && (!realByUid.has(player.uid) || observedMs(player) >= observedMs(realByUid.get(player.uid)))) realByUid.set(player.uid, player);
  }
}

const kartzSnapshot = latestKartzSnapshot();
const kartzByUid = new Map();
for (const raw of kartzSnapshot?.playerRankList ?? []) {
  const player = normalizeKartzPlayer(raw, kartzSnapshot);
  if (player) kartzByUid.set(uidOf(raw), player);
}

const allUids = [...new Set([...powerByUid.keys(), ...realByUid.keys()])].sort((a, b) => a.localeCompare(b));
const players = allUids.map(uid => {
  const power = powerByUid.get(uid) ?? null;
  const realpower = realByUid.get(uid) ?? null;
  const realpowerIsLatest = observedMs(realpower) >= observedMs(power) && !!realpower;
  const latest = realpowerIsLatest ? realpower : (power ?? realpower);
  const fallback = realpowerIsLatest ? power : realpower;
  const location = realpower?.x != null && realpower?.y != null
    ? realpower
    : null;
  const source = power && realpower ? "both" : (realpower ? "realpower" : "power");
  const previousObservation = observationsDiffer(power, realpower)
    ? sourceSnapshot(realpowerIsLatest ? power : realpower, realpowerIsLatest ? "power" : "realpower")
    : null;
  return clean({
    uid, nickname: latest.nickname, server: latest.server, power: latest.power, level: latest.level,
    allianceId: latest.allianceId ?? fallback?.allianceId,
    allianceTag: latest.allianceTag ?? fallback?.allianceTag,
    allianceName: latest.allianceName ?? fallback?.allianceName,
    isOnline: latest.isOnline, lastLogin: latest.lastLogin,
    x: location?.x, y: location?.y, pointId: location?.pointId, pointType: location?.pointType,
    locationObservedAt: location?.observedAt,
    armyPowerText: latest.armyPowerText, observedAt: latest.observedAt,
    source, previousObservation, kartz: kartzByUid.get(uid)
  });
});
const newestObservedAt = [...powerByUid.values(), ...realByUid.values()]
  .map(player => player.observedAt)
  .filter(Boolean)
  .sort()
  .at(-1) ?? new Date().toISOString();

const movementGroups = new Map();
for (const [directory, source] of [[path.join(POWER_DIR, "movement"), "power"], [path.join(REALPOWER_DIR, "movement"), "realpower"]]) {
  for (const file of datedFiles(directory)) {
    const document = readJson(file);
    for (const row of document.rows ?? []) {
      const event = normalizeMovement(row, source, document);
      if (!event) continue;
      const date = serverDate(event.detectedAt ?? document.date);
      mergeEvent(movementGroups, date, event, `${event.uid}|${event.fromServer}|${event.toServer}`);
    }
  }
}

const nicknameGroups = new Map();
for (const file of datedFiles(path.join(POWER_DIR, "nickname"))) {
  const document = readJson(file);
  for (const row of document.rows ?? []) {
    const event = normalizeNickname(row, "power", document);
    if (!event) continue;
    const date = serverDate(event.detectedAt ?? document.date);
    mergeEvent(nicknameGroups, date, event, `${event.uid}|${event.fromNickname.normalize("NFC")}|${event.toNickname.normalize("NFC")}`);
  }
}

// 양쪽 최신 관측의 닉네임이 다르면 관측 순서가 명확한 경우에만 변경 후보로 보강한다.
for (const uid of allUids) {
  const power = powerByUid.get(uid);
  const realpower = realByUid.get(uid);
  if (!power?.nickname || !realpower?.nickname || power.nickname.normalize("NFC") === realpower.nickname.normalize("NFC")) continue;
  const earlier = observedMs(power) <= observedMs(realpower) ? power : realpower;
  const later = earlier === power ? realpower : power;
  if (!earlier.observedAt || !later.observedAt || observedMs(earlier) === observedMs(later)) continue;
  const event = clean({
    detectedAt: later.observedAt, uid, fromNickname: earlier.nickname, toNickname: later.nickname,
    server: later.server, sources: [earlier === realpower || later === realpower ? "realpower" : "power"], inferred: true
  });
  const date = serverDate(event.detectedAt);
  mergeEvent(nicknameGroups, date, event, `${uid}|${event.fromNickname.normalize("NFC")}|${event.toNickname.normalize("NFC")}`);
}

let changedFiles = 0;
if (writeJson(path.join(OUTPUT_DIR, "latest.json"), {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  sourceUpdatedAt: newestObservedAt,
  kartzObservedAt: text(kartzSnapshot?.time),
  playerCount: players.length,
  sourceCounts: {
    power: powerByUid.size,
    realpower: realByUid.size,
    overlap: allUids.filter(uid => powerByUid.has(uid) && realByUid.has(uid)).length,
    kartz: kartzByUid.size,
    kartzMatches: allUids.filter(uid => kartzByUid.has(uid)).length
  },
  players
})) changedFiles++;

for (const [date, events] of [...movementGroups.entries()].sort()) {
  const rows = [...events.values()].sort((a, b) => String(a.detectedAt ?? "").localeCompare(String(b.detectedAt ?? "")) || String(a.uid).localeCompare(String(b.uid)));
  const updatedAt = rows.map(row => row.detectedAt).filter(Boolean).sort().at(-1) ?? `${date}T00:00:00Z`;
  if (writeJson(path.join(MOVEMENT_DIR, `${date}.json`), { schemaVersion: 1, date, updatedAt, rows })) changedFiles++;
}
for (const [date, events] of [...nicknameGroups.entries()].sort()) {
  const rows = [...events.values()].sort((a, b) => String(a.detectedAt ?? "").localeCompare(String(b.detectedAt ?? "")) || String(a.uid).localeCompare(String(b.uid)));
  const updatedAt = rows.map(row => row.detectedAt).filter(Boolean).sort().at(-1) ?? `${date}T00:00:00Z`;
  if (writeJson(path.join(NICKNAME_DIR, `${date}.json`), { schemaVersion: 1, date, updatedAt, rows })) changedFiles++;
}

console.log(`[Overall History] comparedPlayers=${allUids.length}, movementDates=${movementGroups.size}, nicknameDates=${nicknameGroups.size}, changedFiles=${changedFiles}`);
