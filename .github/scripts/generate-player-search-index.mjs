import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const POWER_DIR = path.join(ROOT, "power");
const OUTPUT_DIR = path.join(ROOT, "generated", "player-search");
const NICKNAME_OUTPUT_DIR = path.join(OUTPUT_DIR, "nickname");
const UID_OUTPUT_DIR = path.join(OUTPUT_DIR, "uid");
const SHARD_COUNT = 256;

const CONFUSABLES = new Map(Object.entries({
    "А": "A", "В": "B", "С": "C", "Е": "E", "Н": "H", "І": "I",
    "Ј": "J", "К": "K", "М": "M", "О": "O", "Р": "P", "Ѕ": "S",
    "Т": "T", "Х": "X", "У": "Y", "Ӏ": "I", "Ԍ": "G",
    "а": "a", "в": "b", "с": "c", "е": "e", "і": "i", "ј": "j",
    "к": "k", "м": "m", "о": "o", "р": "p", "ѕ": "s", "т": "t",
    "х": "x", "у": "y", "ӏ": "l", "ԁ": "d", "ԛ": "q", "ԝ": "w",
    "Α": "A", "Β": "B", "Ε": "E", "Ζ": "Z", "Η": "H", "Ι": "I",
    "Κ": "K", "Μ": "M", "Ν": "N", "Ο": "O", "Ρ": "P", "Τ": "T",
    "Υ": "Y", "Χ": "X", "Ϲ": "C", "α": "a", "β": "b", "ε": "e",
    "ι": "i", "κ": "k", "ο": "o", "ρ": "p", "τ": "t", "υ": "y",
    "χ": "x", "ϲ": "c", "ϳ": "j",
}));

const DECIMAL_ZERO_CODE_POINTS = [
    0x0660, 0x06F0, 0x07C0, 0x0966, 0x09E6, 0x0A66, 0x0AE6, 0x0B66,
    0x0BE6, 0x0C66, 0x0CE6, 0x0D66, 0x0DE6, 0x0E50, 0x0ED0, 0x0F20,
    0x1040, 0x1090, 0x17E0, 0x1810, 0x1946, 0x19D0, 0x1A80, 0x1A90,
    0x1B50, 0x1BB0, 0x1C40, 0x1C50, 0xA620, 0xA8D0, 0xA900, 0xA9D0,
    0xA9F0, 0xAA50, 0xABF0, 0x104A0, 0x10D30, 0x10D40, 0x11066,
    0x110F0, 0x11136, 0x111D0, 0x112F0, 0x11450, 0x114D0, 0x11650,
    0x116C0, 0x11730, 0x118E0, 0x11950, 0x11BF0, 0x11C50, 0x11D50,
    0x11DA0, 0x11F50, 0x16130, 0x16A60, 0x16AC0, 0x16B50, 0x1CCF0,
    0x1D7CE, 0x1D7D8, 0x1D7E2, 0x1D7EC, 0x1D7F6, 0x1E140, 0x1E2F0,
    0x1E4F0, 0x1E5F1, 0x1E950, 0x1FBF0,
];

const INITIALS = ["ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];
const MEDIALS = ["ㅏ", "ㅐ", "ㅑ", "ㅒ", "ㅓ", "ㅔ", "ㅕ", "ㅖ", "ㅗ", "ㅘ", "ㅙ", "ㅚ", "ㅛ", "ㅜ", "ㅝ", "ㅞ", "ㅟ", "ㅠ", "ㅡ", "ㅢ", "ㅣ"];
const FINALS = ["", "ㄱ", "ㄲ", "ㄳ", "ㄴ", "ㄵ", "ㄶ", "ㄷ", "ㄹ", "ㄺ", "ㄻ", "ㄼ", "ㄽ", "ㄾ", "ㄿ", "ㅀ", "ㅁ", "ㅂ", "ㅄ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];

const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));
const asString = value => value == null ? "" : String(value);
const hasHangulSyllable = value => /[가-힣]/u.test(value);

function foldUnicodeDigit(character) {
    const codePoint = character.codePointAt(0);
    for (const zeroCodePoint of DECIMAL_ZERO_CODE_POINTS) {
        const digit = codePoint - zeroCodePoint;
        if (digit >= 0 && digit <= 9) return String(digit);
    }
    return character;
}

function foldLatinDiacritics(value) {
    return Array.from(value, character => {
        const base = character.normalize("NFD").charAt(0);
        return /^[A-Za-z]$/.test(base) ? base : character;
    }).join("");
}

function normalizeNickname(value) {
    const normalized = asString(value)
        .normalize("NFKC")
        .replace(/\p{Cf}/gu, "")
        .replace(/\p{Variation_Selector}/gu, "");

    return Array.from(foldLatinDiacritics(normalized), character => {
        const digit = foldUnicodeDigit(character);
        return CONFUSABLES.get(digit) ?? digit;
    }).join("").toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

function decomposeHangul(value, initialsOnly = false) {
    return Array.from(value, character => {
        const codePoint = character.codePointAt(0);
        if (codePoint < 0xAC00 || codePoint > 0xD7A3) return initialsOnly ? "" : character;
        const offset = codePoint - 0xAC00;
        const initial = INITIALS[Math.floor(offset / 588)];
        if (initialsOnly) return initial;
        const medial = MEDIALS[Math.floor((offset % 588) / 28)];
        const final = FINALS[offset % 28];
        return `${initial}${medial}${final}`;
    }).join("");
}

// 브라우저에서도 그대로 구현하기 쉬운 32-bit FNV-1a 해시이다.
function shardFor(value) {
    let hash = 0x811c9dc5;
    for (const character of asString(value)) {
        const codePoint = character.codePointAt(0);
        hash ^= codePoint;
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return (hash % SHARD_COUNT).toString(16).padStart(2, "0");
}

function nicknameShardFor(searchKey) {
    return shardFor(Array.from(searchKey)[0] ?? "");
}

function listDatedJson(directory) {
    if (!fs.existsSync(directory)) return [];
    return fs.readdirSync(directory)
        .filter(filename => /^\d{4}-\d{2}-\d{2}\.json$/.test(filename))
        .sort()
        .map(filename => path.join(directory, filename));
}

function writeJsonIfChanged(file, value) {
    const content = `${JSON.stringify(value)}\n`;
    if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === content) return false;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, "utf8");
    return true;
}

const rawPlayers = readJson(path.join(POWER_DIR, "playerData.json"));
const playersByUid = new Map();
for (const player of rawPlayers) {
    const uid = asString(player.uid);
    if (!uid) continue;
    const previous = playersByUid.get(uid);
    if (!previous || Number(player.lastRequest ?? 0) >= Number(previous.lastRequest ?? 0)) {
        playersByUid.set(uid, player);
    }
}

const nicknameEventsByUid = new Map();
const aliasesByUid = new Map();
for (const file of listDatedJson(path.join(POWER_DIR, "nickname"))) {
    const document = readJson(file);
    for (const row of document.rows ?? []) {
        const uid = asString(row.uid ?? row.to?.uid ?? row.from?.uid);
        if (!uid) continue;
        const event = {
            at: row.detectedAt ?? document.updatedAt ?? null,
            from: row.fromNickname ?? row.from?.nickname ?? null,
            to: row.toNickname ?? row.to?.nickname ?? null,
            server: row.server ?? row.toServer ?? row.to?.server ?? null,
        };
        if (!nicknameEventsByUid.has(uid)) nicknameEventsByUid.set(uid, []);
        nicknameEventsByUid.get(uid).push(event);
        if (!aliasesByUid.has(uid)) aliasesByUid.set(uid, new Set());
        if (event.from) aliasesByUid.get(uid).add(asString(event.from));
        if (event.to) aliasesByUid.get(uid).add(asString(event.to));
    }
}

const movementEventsByUid = new Map();
for (const file of listDatedJson(path.join(POWER_DIR, "movement"))) {
    const document = readJson(file);
    for (const row of document.rows ?? []) {
        const uid = asString(row.uid ?? row.to?.uid ?? row.from?.uid);
        if (!uid) continue;
        const event = {
            at: row.detectedAt ?? document.updatedAt ?? null,
            fromServer: row.fromServer ?? row.from?.server ?? null,
            toServer: row.toServer ?? row.to?.server ?? null,
            nickname: row.nickname ?? row.to?.nickname ?? row.from?.nickname ?? null,
        };
        if (!movementEventsByUid.has(uid)) movementEventsByUid.set(uid, []);
        movementEventsByUid.get(uid).push(event);
    }
}

const nicknameShards = new Map();
const uidShards = new Map();
let aliasCount = 0;

function addNicknameRecord(record) {
    const keys = [record.k, record.j, record.i].filter(Boolean);
    const destinations = new Set(keys.map(nicknameShardFor));
    for (const shard of destinations) {
        if (!nicknameShards.has(shard)) nicknameShards.set(shard, []);
        nicknameShards.get(shard).push(record);
    }
}

function createSearchRecord(player, searchedNickname, matchedNickname = null) {
    const k = normalizeNickname(searchedNickname);
    if (!k) return null;
    const record = {
        u: asString(player.uid),
        n: asString(player.nickname),
        k,
        s: player.server ?? null,
        a: player.allianceName ?? null,
        t: player.allianceTag ?? null,
        p: Number(player.cp ?? player.score ?? 0),
    };
    if (hasHangulSyllable(searchedNickname)) {
        // k를 만든 뒤 분해해야 영문/숫자/유사문자 정규화는 유지하면서
        // 호환 자모(ㄱㅣㅁ)가 NFKC에 의해 다시 음절(김)로 합쳐지지 않는다.
        record.j = decomposeHangul(k);
        record.i = decomposeHangul(k, true);
    }
    if (matchedNickname != null) {
        record.m = matchedNickname;
        record.x = true;
    }
    return record;
}

for (const [uid, player] of playersByUid) {
    const currentNickname = asString(player.nickname);
    const currentRecord = createSearchRecord(player, currentNickname);
    if (currentRecord) addNicknameRecord(currentRecord);

    const seenAliasKeys = new Set();
    for (const alias of aliasesByUid.get(uid) ?? []) {
        const aliasKey = normalizeNickname(alias);
        if (!aliasKey || aliasKey === currentRecord?.k || seenAliasKeys.has(aliasKey)) continue;
        seenAliasKeys.add(aliasKey);
        const aliasRecord = createSearchRecord(player, alias, alias);
        if (aliasRecord) {
            addNicknameRecord(aliasRecord);
            aliasCount++;
        }
    }

    const shard = shardFor(uid);
    if (!uidShards.has(shard)) uidShards.set(shard, {});
    uidShards.get(shard)[uid] = {
        player,
        nicknameHistory: nicknameEventsByUid.get(uid) ?? [],
        movementHistory: movementEventsByUid.get(uid) ?? [],
    };
}

let changedFiles = 0;
for (let index = 0; index < SHARD_COUNT; index++) {
    const shard = index.toString(16).padStart(2, "0");
    const nicknameRecords = nicknameShards.get(shard) ?? [];
    nicknameRecords.sort((left, right) =>
        left.k.localeCompare(right.k) || Number(Boolean(left.x)) - Number(Boolean(right.x)) || left.u.localeCompare(right.u)
    );
    const uidRecords = uidShards.get(shard) ?? {};
    const sortedUidRecords = Object.fromEntries(Object.entries(uidRecords).sort(([left], [right]) => left.localeCompare(right)));
    if (writeJsonIfChanged(path.join(NICKNAME_OUTPUT_DIR, `${shard}.json`), nicknameRecords)) changedFiles++;
    if (writeJsonIfChanged(path.join(UID_OUTPUT_DIR, `${shard}.json`), sortedUidRecords)) changedFiles++;
}

const snapshotUnix = Math.max(0, ...Array.from(playersByUid.values(), player => Number(player.lastRequest ?? 0)).filter(Number.isFinite));
const manifest = {
    schemaVersion: 1,
    sourceUpdatedAt: snapshotUnix ? new Date(snapshotUnix * 1000).toISOString() : null,
    shardCount: SHARD_COUNT,
    hashAlgorithm: "fnv1a-32-codepoint",
    nicknamePattern: "generated/player-search/nickname/{shard}.json",
    uidPattern: "generated/player-search/uid/{shard}.json",
    normalization: "nfkc-confusable-digit-casefold-v1",
    playerCount: playersByUid.size,
    aliasCount,
};
if (writeJsonIfChanged(path.join(OUTPUT_DIR, "manifest.json"), manifest)) changedFiles++;

console.log(`[Player Search Index] players=${playersByUid.size}, aliases=${aliasCount}, changedFiles=${changedFiles}`);
