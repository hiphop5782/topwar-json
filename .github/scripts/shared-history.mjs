// Reconcile both collectors before splitting history into server dates.
const time = row => Date.parse(row.detectedAt || "") || 0;
const value = (row, kind, side) => kind === "movement"
  ? row[`${side}Server`]
  : row[`${side}Nickname`]?.normalize("NFC");
const edge = (row, kind) => JSON.stringify([row.uid, value(row, kind, "from"), value(row, kind, "to")]);

function combine(first, next) {
  const explicit = first.inferred === true && next.inferred !== true ? next : first;
  const merged = {
    ...next, ...explicit,
    detectedAt: time(first) <= time(next) ? first.detectedAt : next.detectedAt,
    sources: [...new Set([...(first.sources || []), ...(next.sources || [])])].sort()
  };
  if (first.inferred === true && next.inferred === true) merged.inferred = true;
  else {
    delete merged.inferred;
    // Retain the original inferred observation when explicit source history
    // catches up, so later rebuilds preserve the first detection date too.
    const inferredTimes = [first, next].flatMap(row =>
      [row.inferred === true ? row.detectedAt : null, row.inferredDetectedAt].filter(Boolean));
    if (inferredTimes.length) merged.inferredDetectedAt = inferredTimes.sort((a, b) => Date.parse(a) - Date.parse(b))[0];
  }
  return merged;
}

export function reconcileHistory(input, kind) {
  const byUid = new Map();
  for (const row of input) {
    if (!row) continue;
    if (!byUid.has(row.uid)) byUid.set(row.uid, []);
    byUid.get(row.uid).push({ ...row });
  }
  const result = [];
  for (const rows of byUid.values()) {
    const explicit = rows.filter(row => row.inferred !== true);
    const remaining = [];
    for (const row of rows) {
      if (row.inferred !== true || !row.fromObservedAt) {
        remaining.push(row);
        continue;
      }
      // A stale source may span several real changes (A -> B -> C).
      // Its A -> C comparison confirms the last transition, not a new one.
      const start = Date.parse(row.fromObservedAt);
      const match = explicit.filter(candidate =>
        time(candidate) > start && time(candidate) <= time(row) &&
        value(candidate, kind, "to") === value(row, kind, "to")
      ).sort((a, b) => time(b) - time(a))[0];
      if (match) Object.assign(match, combine(match, row));
      else remaining.push(row);
    }
    remaining.sort((a, b) => time(a) - time(b) || Number(a.inferred === true) - Number(b.inferred === true));
    const merged = [];
    for (const row of remaining) {
      const previous = merged.at(-1);
      // Equal consecutive transitions are delayed confirmations, even across dates.
      // An intervening transition keeps A -> B -> A -> B as three changes.
      const confirmsCurrentState = previous &&
        (previous.inferred === true || row.inferred === true) &&
        value(previous, kind, "to") === value(row, kind, "to");
      if (previous && (edge(previous, kind) === edge(row, kind) || confirmsCurrentState)) {
        merged[merged.length - 1] = combine(previous, row);
      } else merged.push(row);
    }
    result.push(...merged);
  }
  return result.sort((a, b) => time(a) - time(b) || String(a.uid).localeCompare(String(b.uid)));
}
