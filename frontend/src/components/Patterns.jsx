import React, { useMemo } from "react";
import { Treemap, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, Cell,
         RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis } from "recharts";
import { useStore } from "../data/store.jsx";
import { useAgg, useAssociation, useConditions } from "../data/api.js";
import { SEVERITY_ORDER, meanDivergingColor, textColorFor } from "../theme.js";
import { foldAgg, mergeLaneChange, mergeOtherUnknown, memberMap, sortOtherLast } from "../data/aggutil.js";
import { axisProps, tipProps } from "./Overview.jsx";

const ASSOC_FACTORS = [
  ["Light_conditions", "Light"],
  ["Weather_conditions", "Weather"],
  ["Cause_of_accident", "Cause"],
  ["Type_of_collision", "Collision type"],
  ["Area_accident_occured", "Area"],
  ["Age_band_of_driver", "Driver age"],
  ["Driving_experience", "Experience"],
  ["Road_surface_conditions", "Road surface"],
  ["Sex_of_driver", "Driver sex"],
  ["Time_of_day", "Time of day"],
  ["Day_of_week", "Day of week"],
  ["Vehicle_movement", "Vehicle movement"],
  ["Type_of_vehicle", "Vehicle type"],
  ["Lanes_or_Medians", "Lanes / medians"],
  ["Educational_level", "Education"],
  ["Number_of_vehicles_involved", "Vehicles involved"],
  ["Number_of_casualties", "Casualties"],
];
const ASSOC_LABEL = Object.fromEntries(ASSOC_FACTORS);
const ASSOC_FIELDS = ASSOC_FACTORS.map(([f]) => f);

const ASSOC_LABEL_UK = { ...ASSOC_LABEL, Driving_experience: "Vehicle age", Educational_level: "Deprivation decile" };

export default function Patterns() {
  const { dataset, sevColor, toggleFilter, toggleFilterValues, isAnyActive, diverging, palette } = useStore();
  const assocLabel = dataset === "india" ? ASSOC_LABEL : ASSOC_LABEL_UK;
  const causeRemap = (k) => mergeOtherUnknown(mergeLaneChange(k));

  const { data: assocRaw } = useAssociation(ASSOC_FIELDS);
  const assoc = useMemo(() =>
    assocRaw.map((a) => ({ ...a, label: assocLabel[a.field] })), [assocRaw, assocLabel]);
  const maxV = Math.max(0.01, ...assoc.map((a) => a.v));
  const { color: assocColor } = meanDivergingColor(diverging, assoc.map((a) => a.v));

  const { data: causeAgg } = useAgg("Cause_of_accident", { minCount: 5, ignoreFields: ["Cause_of_accident"] });
  const causeMembers = useMemo(() => memberMap(causeAgg, causeRemap), [causeAgg]);
  const tree = useMemo(() =>
    sortOtherLast(foldAgg(causeAgg, causeRemap), (a, b) => b.total - a.total)
      .map((o) => ({ name: o.key, size: o.total, fatalRate: o.fatalRate, total: o.total })),
    [causeAgg]);
  const { color: treeColor, domain: treeDomain } = meanDivergingColor(diverging, tree.map((t) => t.fatalRate));
  const treeLookup = useMemo(() => Object.fromEntries(tree.map((t) => [t.name, t])), [tree]);

  const { data: radar } = useConditions();
  const radarMax = Math.max(10, ...radar.map((d) => Math.max(d.value, d.baseline)));

  const { data: casualtyAgg } = useAgg("Number_of_casualties", { ignoreFields: ["Number_of_casualties"] });
  const casualties = useMemo(() =>
    casualtyAgg.map((o) => ({
      ...o, cas: Number(o.key),
      _slightDisp: Math.sqrt(o["Slight Injury"]),
      _seriousDisp: Math.sqrt(o["Serious Injury"]),
      _fatalDisp: Math.sqrt(o["Fatal injury"]),
    })).sort((a, b) => a.cas - b.cas),
    [casualtyAgg]);
  const CAS_DISP_KEY = { "Slight Injury": "_slightDisp", "Serious Injury": "_seriousDisp", "Fatal injury": "_fatalDisp" };
  const sqBack = (v) => Math.round(v * v).toLocaleString();

  return (
    <div className="view" style={{ gridTemplateRows: "1fr 1fr" }}>
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", minHeight: 0 }}>
        <div className="card">
          <div className="card-head">
            <span className="card-title">What drives severity · factor association</span>
          </div>
          <div className="fill">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={assoc} layout="vertical" margin={{ left: 6, right: 40 }} barCategoryGap={2}>
                <XAxis type="number" domain={[0, Math.ceil(maxV * 20) / 20]} {...axisProps}
                       tickFormatter={(v) => v.toFixed(2)} />
                <YAxis type="category" dataKey="label" width={110} {...axisProps}
                       tick={{ fontSize: 10, fill: "#B8C2CD" }} />
                <Tooltip {...tipProps} formatter={(v) => [v.toFixed(3), "Cramér's V"]} />
                <Bar dataKey="v" radius={[0, 3, 3, 0]} activeBar={false}
                     label={{ position: "right", fontSize: 9.5, fill: "#B8C2CD", formatter: (v) => v.toFixed(2) }}>
                  {assoc.map((a) => <Cell key={a.field} fill={assocColor(a.v)} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <span className="card-title">Risk fingerprint · danger conditions</span>
          </div>
          <div className="fill">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radar} outerRadius="70%">
                <PolarGrid stroke="#2C3A4A" />
                <PolarAngleAxis dataKey="axis" tick={{ fontSize: 10.5, fill: "#B8C2CD" }} />
                <PolarRadiusAxis angle={90} domain={[0, radarMax]} tick={{ fontSize: 9, fill: "#8B98A8" }} />
                <Radar name="Baseline (all)" dataKey="baseline" stroke="#5A6675" fill="#5A6675" fillOpacity={0.12} />
                <Radar name="Under condition" dataKey="value" stroke="#E69F00" fill="#E69F00" fillOpacity={0.32} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Tooltip {...tipProps} formatter={(v, n) => [`${v}%`, n]} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", minHeight: 0 }}>
        <div className="card">
          <div className="card-head">
            <span className="card-title">Cause landscape · volume × lethality</span>
          </div>
          <div className="fill">
            <ResponsiveContainer width="100%" height="100%">
              <Treemap data={tree} dataKey="size" stroke="#0A0E14" isAnimationActive={false}
                       content={<TreeCell lookup={treeLookup} color={treeColor}
                                          onPick={(name) => toggleFilterValues("Cause_of_accident", causeMembers[name] || [name])}
                                          isActive={(name) => isAnyActive("Cause_of_accident", causeMembers[name] || [name])} />}>
                <Tooltip {...tipProps} content={<TreeTip lookup={treeLookup} />} />
              </Treemap>
            </ResponsiveContainer>
          </div>
          <div style={{ flex: "none" }}><DivergingBar domain={treeDomain} left="below avg fatal rate" right="above avg fatal rate" pct
                                                        color={treeColor} label={palette.divergingLabel} /></div>
        </div>

        <div className="card">
          <div className="card-head">
            <span className="card-title">Severity by casualties per crash</span>
          </div>
          <div className="fill">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={casualties} margin={{ left: 0, right: 10 }}>
                <XAxis dataKey="cas" {...axisProps} />
                <YAxis {...axisProps} tickFormatter={sqBack} />
                <Tooltip {...tipProps} labelFormatter={(v) => `${v} casualties`} formatter={(v, n) => [sqBack(v), n]} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {SEVERITY_ORDER.map((s) => (
                  <Bar key={s} dataKey={CAS_DISP_KEY[s]} name={s} stackId="a" fill={sevColor(s)} activeBar={false}
                       onClick={(d) => toggleFilter("Number_of_casualties", d.key)} cursor="pointer" />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}

function TreeCell(props) {
  const { x, y, width, height, name, lookup, color, onPick, isActive } = props;
  if (width <= 0 || height <= 0 || !name) return null;
  const node = lookup[name];
  if (!node) return null;
  const sel = isActive(name);
  const fill = color(node.fatalRate);
  const textFill = textColorFor(fill);
  const subFill = textFill === "#0A0E14" ? "#2B2110" : "#C7CDD6";
  return (
    <g style={{ cursor: "pointer" }} onClick={() => onPick(name)}>
      <rect x={x} y={y} width={width} height={height} rx={2}
            fill={fill}
            stroke={sel ? "#E69F00" : "#0A0E14"} strokeWidth={sel ? 2.5 : 1} />
      {width > 70 && height > 30 && (
        <text x={x + 7} y={y + 18} fontSize={11} fontWeight={700}
              fill={textFill} stroke="none" pointerEvents="none">
          {name.length > Math.floor(width / 8) ? name.slice(0, Math.floor(width / 8)) + "…" : name}
        </text>
      )}
      {width > 70 && height > 46 && (
        <text x={x + 7} y={y + 34} fontSize={10} fontWeight={600} fontFamily="JetBrains Mono"
              fill={subFill} stroke="none" pointerEvents="none">
          {node.total.toLocaleString()} · {(node.fatalRate * 100).toFixed(1)}% fatal
        </text>
      )}
    </g>
  );
}

function TreeTip({ active, payload, lookup }) {
  if (!active || !payload || !payload.length) return null;
  const name = payload[0].payload?.name;
  const node = lookup[name];
  if (!node) return null;
  return (
    <div style={{ background: "#0A0E14", border: "1px solid #2C3A4A", borderRadius: 8, padding: "9px 12px", fontSize: 12 }}>
      <div style={{ fontWeight: 600, marginBottom: 3 }}>{name}</div>
      <div style={{ color: "#8B98A8" }}>{node.total.toLocaleString()} crashes</div>
      <div style={{ color: "#8B98A8" }}>Fatal rate {(node.fatalRate * 100).toFixed(1)}%</div>
    </div>
  );
}

function DivergingBar({ domain, left, right, pct, color, label }) {
  const [lo, mid, hi] = domain;
  const stops = Array.from({ length: 24 }, (_, i) => lo + (i / 23) * (hi - lo));
  const midPct = hi > lo ? ((mid - lo) / (hi - lo)) * 100 : 50;
  const fmt = (v) => (pct ? `${(v * 100).toFixed(0)}%` : v.toFixed(2));
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12, fontSize: 11, color: "#8B98A8" }}>
      <span>{left}</span>
      <div style={{ position: "relative", display: "flex", flex: 1, height: 9, borderRadius: 5, overflow: "hidden" }}>
        {stops.map((s, i) => <div key={i} style={{ flex: 1, background: color(s) }} />)}
        <div title={`average ${fmt(mid)}`}
             style={{ position: "absolute", left: `${midPct}%`, top: 0, bottom: 0, width: 2, background: "#0A0E14", opacity: 0.6 }} />
      </div>
      <span>{right}</span>
      <span className="tag">{label}</span>
    </div>
  );
}
