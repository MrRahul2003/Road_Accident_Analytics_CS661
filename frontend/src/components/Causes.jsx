import React, { useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
         ScatterChart, Scatter, Cell, ReferenceLine } from "recharts";
import { scaleSequential } from "d3-scale";
import { useStore } from "../data/store.jsx";
import { useAgg } from "../data/api.js";
import { SEVERITY_ORDER } from "../theme.js";
import { foldAgg, mergeLaneChange, mergeOtherUnknown, memberMap, sortOtherLast } from "../data/aggutil.js";
import { axisProps, tipProps } from "./Overview.jsx";

const DISP_KEY = { "Slight Injury": "_slightDisp", "Serious Injury": "_seriousDisp", "Fatal injury": "_fatalDisp" };
const sq = (v) => v * v;

export default function Causes() {
  const { sevColor, toggleFilterValues, isAnyActive, sequential, palette } = useStore();

  const causeRemap = (k) => mergeOtherUnknown(mergeLaneChange(k));

  const { data: causeAgg } = useAgg("Cause_of_accident", { minCount: 5, ignoreFields: ["Cause_of_accident"] });
  const causeMembers = useMemo(() => memberMap(causeAgg, causeRemap), [causeAgg]);
  const causes = useMemo(() =>
    sortOtherLast(foldAgg(causeAgg, causeRemap), (a, b) => b.total - a.total).slice(0, 10).map((r) => ({
      ...r,
      _slightDisp: Math.sqrt(r["Slight Injury"]),
      _seriousDisp: Math.sqrt(r["Serious Injury"]),
      _fatalDisp: Math.sqrt(r["Fatal injury"]),
    })), [causeAgg]);
  const causeActive = (key) => isAnyActive("Cause_of_accident", causeMembers[key] || [key]);
  const causeClick = (key) => toggleFilterValues("Cause_of_accident", causeMembers[key] || [key]);

  const { data: collisionAgg } = useAgg("Type_of_collision", { minCount: 5, ignoreFields: ["Type_of_collision"] });
  const collisionMembers = useMemo(() => memberMap(collisionAgg, mergeOtherUnknown), [collisionAgg]);
  const collisions = useMemo(() =>
    sortOtherLast(foldAgg(collisionAgg, mergeOtherUnknown), (a, b) => b.total - a.total).slice(0, 8), [collisionAgg]);
  const collisionActive = (key) => isAnyActive("Type_of_collision", collisionMembers[key] || [key]);
  const collisionClick = (key) => toggleFilterValues("Type_of_collision", collisionMembers[key] || [key]);
  const colMaxRisk = Math.max(0.01, ...collisions.map((c) => c.risk));
  const colMinRisk = collisions.length ? Math.min(...collisions.map((c) => c.risk)) : 0;
  const colColor = scaleSequential(palette.sequential).domain([colMinRisk, colMaxRisk]);
  const anyCollisionSel = collisions.some((c) => collisionActive(c.key));

  const { data: scatterAgg } = useAgg("Cause_of_accident", { minCount: 10, ignoreFields: ["Cause_of_accident"] });
  const scatter = useMemo(() =>
    foldAgg(scatterAgg, causeRemap).map((o) => ({ ...o, x: o.total, y: +(o.fatalRate * 100).toFixed(2), z: o.total })),
    [scatterAgg]);
  const maxRisk = Math.max(0.01, ...scatter.map((s) => s.risk));
  const color = sequential(maxRisk);
  const avgFatal = scatter.length ? scatter.reduce((a, s) => a + s.y, 0) / scatter.length : 0;

  return (
    <div className="view" style={{ gridTemplateRows: "1fr 1fr" }}>
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", minHeight: 0 }}>
        <div className="card">
          <div className="card-head">
            <span className="card-title">Leading accident causes</span>
          </div>
          <div className="fill">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={causes} layout="vertical" margin={{ left: 6, right: 14 }}>
              <XAxis type="number" tickFormatter={(v) => Math.round(sq(v)).toLocaleString()} {...axisProps} />
              <YAxis type="category" dataKey="key" width={155} stroke="#2C3A4A" tick={{ fontSize: 10.5, fill: "#B8C2CD" }} tickLine={false} />
              <Tooltip {...tipProps} formatter={(v, n) => [Math.round(sq(v)).toLocaleString(), n]} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {SEVERITY_ORDER.map((s) => (
                <Bar key={s} dataKey={DISP_KEY[s]} name={s} stackId="a" fill={sevColor(s)} activeBar={false}
                     onClick={(d) => causeClick(d.key)} cursor="pointer" />
              ))}
            </BarChart>
          </ResponsiveContainer>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <span className="card-title">Collision types</span>
          </div>
          <div className="fill">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={collisions} layout="vertical" margin={{ left: 6, right: 14 }}>
                <XAxis type="number" tickFormatter={(v) => v.toLocaleString()} {...axisProps} />
                <YAxis type="category" dataKey="key" width={155} stroke="#2C3A4A" tick={{ fontSize: 10.5, fill: "#B8C2CD" }} tickLine={false} />
                <Tooltip {...tipProps} content={<CollisionTip />} />
                <Bar dataKey="total" onClick={(d) => collisionClick(d.key)} cursor="pointer">
                  {collisions.map((c) => (
                    <Cell key={c.key} fill={colColor(c.risk)}
                          fillOpacity={anyCollisionSel && !collisionActive(c.key) ? 0.35 : 1}
                          stroke={collisionActive(c.key) ? "#FFFFFF" : "none"}
                          strokeWidth={collisionActive(c.key) ? 1.5 : 0} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <SequentialLegend min={colMinRisk} max={colMaxRisk} scale={colColor} />
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <span className="card-title">Rare but deadly — frequency vs fatality</span>
        </div>
        <div className="fill">
          <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ left: 6, right: 20, top: 10, bottom: 14 }}>
            <XAxis type="number" dataKey="x" name="Accidents" scale="log" domain={["auto", "auto"]} allowDataOverflow
                   {...axisProps} tickFormatter={(v) => v.toLocaleString()}
                   label={{ value: "accidents (volume, log scale)", position: "insideBottom", offset: -6, fontSize: 11, fill: "#5A6675" }} />
            <YAxis type="number" dataKey="y" name="Fatal %" unit="%" {...axisProps}
                   label={{ value: "fatal rate", angle: -90, position: "insideLeft", fontSize: 11, fill: "#5A6675" }} />
            <ReferenceLine y={avgFatal} stroke="#5A6675" strokeDasharray="4 4" />
            <Tooltip {...tipProps} cursor={{ strokeDasharray: "3 3" }}
                     formatter={(v, n) => n === "Fatal %" ? [`${v}%`, n] : [v.toLocaleString(), n]}
                     labelFormatter={() => ""} content={<CauseTip />} />
            <Scatter data={scatter} onClick={(d) => causeClick(d.key)} cursor="pointer"
                     shape={(p) => <circle cx={p.cx} cy={p.cy} r={7} fill={p.fill} stroke={p.stroke} strokeWidth={p.strokeWidth} />}>
              {scatter.map((s) => (
                <Cell key={s.key} fill={color(s.risk)} stroke={causeActive(s.key) ? "#E69F00" : "#0A0E14"} strokeWidth={causeActive(s.key) ? 2.5 : 1} />
              ))}
            </Scatter>
          </ScatterChart>
          </ResponsiveContainer>
        </div>
        <SequentialLegend max={maxRisk} scale={color} />
      </div>
    </div>
  );
}

function SequentialLegend({ min = 0, max, scale }) {
  const stops = Array.from({ length: 24 }, (_, i) => min + (i / 23) * (max - min));
  return (
    <div className="flex items-center gap-2.5 mt-3 text-xs text-[#A6B2C0]">
      <span>low risk</span>
      <div className="flex flex-1 h-2.75 rounded-[5px] overflow-hidden">
        {stops.map((s, i) => <div key={i} className="flex-1" style={{ background: scale(s) }} />)}
      </div>
      <span>high risk</span>
    </div>
  );
}

function CauseTip({ payload }) {
  if (!payload || !payload.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{ background: "#0A0E14", border: "1px solid #2C3A4A", borderRadius: 8, padding: "9px 12px", fontSize: 12 }}>
      <div style={{ fontWeight: 600, marginBottom: 3 }}>{d.key}</div>
      <div style={{ color: "#8B98A8" }}>{d.total.toLocaleString()} accidents</div>
      <div style={{ color: "#8B98A8" }}>Fatal {d.y}% · Serious {(d.seriousRate * 100).toFixed(1)}%</div>
    </div>
  );
}

function CollisionTip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{ background: "#0A0E14", border: "1px solid #2C3A4A", borderRadius: 8, padding: "9px 12px", fontSize: 12 }}>
      <div style={{ fontWeight: 600, marginBottom: 3 }}>{d.key}</div>
      <div style={{ color: "#8B98A8" }}>{d.total.toLocaleString()} accidents</div>
      <div style={{ color: "#8B98A8" }}>Fatal {(d.fatalRate * 100).toFixed(1)}%</div>
      <div style={{ color: "#E69F00", fontFamily: "JetBrains Mono", marginTop: 2 }}>risk {d.risk.toFixed(3)}</div>
    </div>
  );
}
