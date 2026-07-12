import React, { useMemo, useState, useEffect } from "react";
import { useStore } from "../data/store.jsx";
import { useAgg, fetchPredict } from "../data/api.js";
import { mergeOtherUnknown } from "../data/aggutil.js";

function prettify(s) { return s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()); }

const FIELD_REMAP = {
  Area_accident_occured: mergeOtherUnknown,
  Cause_of_accident: mergeOtherUnknown,
  Type_of_collision: mergeOtherUnknown,
  Weather_conditions: mergeOtherUnknown,
};

function dedupedLevels(field, levels) {
  const remap = FIELD_REMAP[field];
  if (!remap) return levels.map((lv) => ({ value: lv, label: lv }));
  const seen = new Set();
  const out = [];
  for (const lv of levels) {
    const label = remap(lv);
    if (seen.has(label)) continue;
    seen.add(label);
    out.push({ value: lv, label });
  }
  return out;
}

function bucketTimeOfDay(levels) {
  const h = new Date().getHours();
  const label = h < 6 || h >= 21 ? "Night (0-5)"
    : h < 12 ? "Morning (6-11)"
    : h < 17 ? "Afternoon (12-16)"
    : "Evening (17-20)";
  return levels.includes(label) ? label : levels[0];
}

function currentDayOfWeek(levels) {
  const day = new Date().toLocaleDateString("en-US", { weekday: "long" });
  return levels.includes(day) ? day : levels[0];
}

const singleFilterValue = (filters, field) =>
  (filters[field] && filters[field].length === 1) ? filters[field][0] : null;

const MULTI_VEHICLE_COLLISION = "Vehicle with vehicle collision";

const SYNCED_FIELDS = ["State", "Time_of_day", "Day_of_week", "Weather_conditions"];

export default function Predictor() {
  const { model, modelDataset, dataset } = useStore();
  if (!model) return null;
  return <PredictorInner key={modelDataset + dataset} />;
}

function PredictorInner() {
  const { model, modelDataset, sevColor, dataset, filters, setFieldValues } = useStore();
  const modelIsFallback = modelDataset !== dataset;
  const { data: stateAgg } = useAgg("State", { ignoreFields: ["State"] });

  const catFields = Object.keys(model.cat_levels);
  const otherCatFields = catFields.filter((f) => f !== "State");
  const numFeatures = model.num_features || [];
  const numInputFields = numFeatures.filter((f) => f !== "Number_of_casualties");

  const filterState = filters.State && filters.State.length === 1 ? filters.State[0] : null;
  const liveStates = useMemo(
    () => [...stateAgg].sort((a, b) => b.total - a.total).map((s) => s.key),
    [stateAgg]);
  const stateOptions = modelIsFallback ? liveStates : model.cat_levels.State;

  const filterDefaults = () => ({
    State: filterState || (dataset === "india" ? "Uttar Pradesh" : (stateOptions[0] || "")),
    Time_of_day: singleFilterValue(filters, "Time_of_day") || bucketTimeOfDay(model.cat_levels.Time_of_day),
    Day_of_week: singleFilterValue(filters, "Day_of_week") || currentDayOfWeek(model.cat_levels.Day_of_week),
    Weather_conditions: singleFilterValue(filters, "Weather_conditions") || model.cat_levels.Weather_conditions[0],
  });

  const [sel, setSel] = useState(() => {
    const s = {};
    catFields.forEach((f) => { s[f] = model.cat_levels[f][0]; });
    numFeatures.forEach((f) => { s[f] = Math.round(model.num_means[f]); });
    return { ...s, ...filterDefaults() };
  });

  useEffect(() => {
    const next = filterDefaults();
    setSel((s) => {
      const merged = { ...s, ...next };
      const changed = Object.keys(next).some((k) => s[k] !== next[k]);
      return changed ? merged : s;
    });
  }, [JSON.stringify(filters), dataset, stateOptions]);

  const [result, setResult] = useState(null);
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      fetchPredict(modelDataset, sel)
        .then((r) => { if (!cancelled) setResult(r); })
        .catch(() => { if (!cancelled) setResult(null); });
    }, 120);
    return () => { cancelled = true; clearTimeout(t); };
  }, [JSON.stringify(sel)]);

  const ordered = result ? result.probabilities : [];
  const pred = ordered.length ? ordered.reduce((a, b) => (b.p > a.p ? b : a), ordered[0]) : null;
  const contributions = result ? result.contributions : [];
  const maxContrib = contributions.reduce((mx, c) => Math.max(mx, Math.abs(c.value)), 0) || 1;
  const m = model.metrics;

  return (
    <div className="view" style={{ gridTemplateColumns: "1.4fr 1fr", gridTemplateRows: "1fr" }}>
      <div className="card" style={{ overflow: "hidden" }}>
        <div className="card-head">
          <span className="card-title">Severity predictor · scenario input</span>
        </div>
        {modelIsFallback && (
          <div className="mb-3 rounded-md border border-[#2C3A4A] bg-[#0F151D] px-3 py-2 text-[11px] leading-snug text-[#8B98A8]">
            No trained model found for this dataset — predictions come from the India model. Force/city selection is for scenario framing only and doesn't influence the prediction.
          </div>
        )}
        <div className="form-grid">
          <div className="field" key="State">
            <label>{dataset === "uk" ? "Police force" : "State"}</label>
            <select value={sel.State} onChange={(e) => {
              const v = e.target.value;
              setSel({ ...sel, State: v });
              setFieldValues("State", [v]);
            }}>
              {stateOptions.length === 0 && <option value="">Loading…</option>}
              {stateOptions.map((lv) => <option key={lv} value={lv}>{lv}</option>)}
            </select>
          </div>
          {otherCatFields.map((f) => (
            <div className="field" key={f}>
              <label>{prettify(f)}</label>
              <select value={sel[f]} onChange={(e) => {
                const v = e.target.value;
                setSel((s) => {
                  const next = { ...s, [f]: v };
                  if (f === "Type_of_collision" && v === MULTI_VEHICLE_COLLISION
                      && next.Number_of_vehicles_involved < 2) {
                    next.Number_of_vehicles_involved = 2;
                  }
                  return next;
                });
                if (SYNCED_FIELDS.includes(f)) setFieldValues(f, [v]);
              }}>
                {dedupedLevels(f, model.cat_levels[f]).map(({ value, label }) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
          ))}
          {numInputFields.map((f) => {
            let lo = (model.num_min && model.num_min[f]) ?? 1;
            const hi = (model.num_max && model.num_max[f]) ?? 20;
            if (f === "Number_of_vehicles_involved" && sel.Type_of_collision === MULTI_VEHICLE_COLLISION) {
              lo = Math.max(lo, 2);
            }
            return (
              <div className="field" key={f}>
                <label>{prettify(f)}</label>
                <input type="number" min={lo} max={hi} value={sel[f]}
                       onChange={(e) => {
                         const v = Math.min(hi, Math.max(lo, Math.round(+e.target.value) || lo));
                         setSel({ ...sel, [f]: v });
                       }} />
              </div>
            );
          })}
        </div>

        <div style={{ marginTop: 20 }}>
          <div className="card-head"><span className="card-title">Predicted severity</span></div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {ordered.length === 0 && (
              <div style={{ fontSize: 12.5, color: "#5A6675" }}>Scoring scenario…</div>
            )}
            {ordered.map((o) => (
              <div key={o.cls} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ width: 110, fontSize: 12.5, color: "#8B98A8" }}>{o.cls}</span>
                <div style={{ flex: 1, background: "#0F151D", borderRadius: 6, overflow: "hidden" }}>
                  <div className="prob-bar" style={{ width: `${Math.max(o.p * 100, 4)}%`, background: sevColor(o.cls) }}>
                    {(o.p * 100).toFixed(1)}%
                  </div>
                </div>
              </div>
            ))}
          </div>
          {pred && (
            <div style={{ marginTop: 14, padding: "12px 14px", background: "#0F151D", borderRadius: 8, border: "1px solid #2C3A4A" }}>
              Most likely outcome: <b style={{ color: sevColor(pred.cls) }}>{pred.cls}</b> ({(pred.p * 100).toFixed(1)}% confidence)
            </div>
          )}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12, minHeight: 0, overflow: "hidden" }}>
        <div className="card" style={{ flex: "none" }}>
          <div className="card-head"><span className="card-title">Model performance</span></div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
            <Metric label="Accuracy" value={(m.accuracy * 100).toFixed(1) + "%"} />
            <Metric label="Weighted F1" value={m.weighted_f1.toFixed(3)} />
            <Metric label="Test rows" value={m.n_test.toLocaleString()} />
          </div>
          <table className="tbl">
            <thead><tr><th>Class</th><th className="num">Prec</th><th className="num">Recall</th><th className="num">F1</th><th className="num">N</th></tr></thead>
            <tbody>
              {model.severity_order.filter((s) => model.per_class[s]).map((s) => {
                const r = model.per_class[s];
                return (
                  <tr key={s}>
                    <td><span className="legend-dot" style={{ background: sevColor(s), display: "inline-block", marginRight: 6 }} />{s}</td>
                    <td className="num">{r.precision.toFixed(2)}</td>
                    <td className="num">{r.recall.toFixed(2)}</td>
                    <td className="num">{r.f1.toFixed(2)}</td>
                    <td className="num">{r.support.toLocaleString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="card">
          <div className="card-head"><span className="card-title">Why this prediction</span></div>
          {contributions.map((c) => (
            <div key={c.feature} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <span style={{ flex: 1, fontSize: 11.5, color: "#8B98A8" }}>
                {prettify(c.feature)}{sel[c.feature] !== undefined ? ` = ${sel[c.feature]}` : ""}
              </span>
              <div style={{ width: 120, display: "flex", justifyContent: "center" }}>
                <div style={{ width: "100%", height: 8, background: "#0F151D", borderRadius: 4, position: "relative" }}>
                  <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: "#2C3A4A" }} />
                  <div style={{ position: "absolute", height: 8, borderRadius: 4,
                                background: c.value > 0 ? "#D55E00" : "#56B4E9",
                                left: c.value > 0 ? "50%" : `${50 - (Math.abs(c.value) / maxContrib) * 48}%`,
                                width: `${(Math.abs(c.value) / maxContrib) * 48}%` }} />
                </div>
              </div>
            </div>
          ))}
          {contributions.length === 0 && (
            <div style={{ fontSize: 11.5, color: "#5A6675" }}>Adjust the scenario to see what drives the outcome.</div>
          )}
          <div style={{ fontSize: 11, color: "#5A6675", marginTop: 4 }}>
            <span style={{ color: "#D55E00" }}>■</span> pushes toward this outcome ·
            <span style={{ color: "#56B4E9" }}> ■</span> pushes away
          </div>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div style={{ background: "#0F151D", borderRadius: 8, padding: "10px 12px", border: "1px solid #1F2935" }}>
      <div style={{ fontSize: 10.5, color: "#8B98A8", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
      <div style={{ fontFamily: "JetBrains Mono", fontSize: 20, fontWeight: 700, marginTop: 3 }}>{value}</div>
    </div>
  );
}
