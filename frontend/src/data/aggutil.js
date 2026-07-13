const SEV_KEYS = ["Slight Injury", "Serious Injury", "Fatal injury"];

// Exact percentage: adaptive precision so small-but-nonzero shares never render as "0%".
export const fmtPct = (v) => {
  if (!isFinite(v) || v <= 0) return "0";
  if (v >= 1) return String(+v.toFixed(1));
  if (v >= 0.1) return String(+v.toFixed(2));
  const s = +v.toFixed(3);
  return s ? String(s) : "<0.001";
};

export function foldAgg(rows, mapKey) {
  const acc = {};
  for (const r of rows) {
    const nk = mapKey(r.key);
    if (nk == null) continue;
    const g = acc[nk] || (acc[nk] = { key: nk, total: 0, "Slight Injury": 0, "Serious Injury": 0, "Fatal injury": 0 });
    g.total += r.total || 0;
    for (const s of SEV_KEYS) g[s] += r[s] || 0;
  }
  return Object.values(acc).map((g) => ({
    ...g,
    fatalRate: g.total ? g["Fatal injury"] / g.total : 0,
    seriousRate: g.total ? g["Serious Injury"] / g.total : 0,
    risk: g.total ? (g["Serious Injury"] + 3 * g["Fatal injury"]) / g.total : 0,
  }));
}

export function memberMap(rows, mapKey) {
  const m = {};
  for (const r of rows) {
    const b = mapKey(r.key);
    if (b == null) continue;
    (m[b] || (m[b] = [])).push(r.key);
  }
  return m;
}

export const OTHER_UNKNOWN = "Other";
export const mergeOtherUnknown = (label) =>
  /^(other|others|unknown|not known|unknown \(self reported\)|unknown vehicle type \(self rep only\)|rural village areasoffice areas)$/i
    .test(label)
    ? OTHER_UNKNOWN
    : label;

export const mergeLaneChange = (label) =>
  /^changing lane to the (left|right)$/i.test(label) ? "Lane change" : label;

export function sortOtherLast(rows, cmp) {
  return [...rows].sort((a, b) => {
    const aOther = a.key === OTHER_UNKNOWN, bOther = b.key === OTHER_UNKNOWN;
    if (aOther !== bOther) return aOther ? 1 : -1;
    return cmp(a, b);
  });
}

export function vehicleClass(label) {
  const s = String(label).toLowerCase();
  if (/motorcycle|bajaj|bicycle|pedal cycle|scooter/.test(s)) return "Two-wheeler";
  if (/automobile|taxi|stationwagen|pick up|public \(12|\bcar\b/.test(s)) return "Four-wheeler";
  if (/lorry|public \(1[3-9]|public \(> ?45|public \(45|\bbus\b|coach|goods|\bvan\b/.test(s)) return "Long chassis";
  return OTHER_UNKNOWN;
}
