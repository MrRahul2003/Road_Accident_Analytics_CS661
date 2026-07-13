import React, { useMemo } from "react";
import {
  BarChart, Bar, LineChart, Line,
  FunnelChart, Funnel, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, LabelList,
} from "recharts";
import { useStore } from "../data/store.jsx";
import { useAgg } from "../data/api.js";
import { SEVERITY_ORDER } from "../theme.js";
import { fmtPct, sortUnknownOtherLast } from "../data/aggutil.js";
import { axisProps, tipProps } from "./Overview.jsx";
import SeverityFactorBars from "./SeverityFactorBars.jsx";

const AGE_ORDER = ["Under 18", "18-30", "31-50", "Over 51", "Unknown"];

const EXP_ORDER_BY_DATASET = {
  india: ["No Licence", "Below 1yr", "1-2yr", "2-5yr", "5-10yr", "Above 10yr", "Unknown"],
  uk: ["0-2 yrs", "3-5 yrs", "6-10 yrs", "11-15 yrs", "Over 15 yrs", "Unknown"],
};

// Distinct from the injury triadic (teal / olive / magenta): the dominant categories get
// blue and amber, which no injury colour resembles.
const CATEGORY_COLORS = ["#3B82F6", "#F59E0B", "#8B5CF6", "#94A3B8", "#E11D48", "#0D9488"];

// Tooltip: category name + share + per-category injury-severity breakdown.
function InjuryTooltip({ active, payload, sevColor }) {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0].payload;
  const rate = (k) => fmtPct(d.total ? ((d[k] || 0) / d.total) * 100 : 0);
  return (
    <div style={{ ...tipProps.contentStyle, padding: "8px 10px", color: "#E6EDF3" }}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>
        {d.key} · {d.total.toLocaleString()} ({fmtPct(d.pct)}%)
      </div>
      {SEVERITY_ORDER.map((s) => (
        <div key={s} style={{ display: "flex", alignItems: "center", gap: 6, lineHeight: "18px" }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: sevColor(s), flex: "none" }} />
          {s} : {rate(s)}%
        </div>
      ))}
    </div>
  );
}

const RAD = Math.PI / 180;
// Label each pie slice with its exact share of total (slices are drawn on a sqrt scale
// for visibility, so the label carries the real percentage). Only slices too thin to
// hold a label are skipped — their exact share is still in the tooltip.
function renderSlicePct({ cx, cy, midAngle, outerRadius, percent, payload }) {
  if (!payload.pct || percent < 0.045) return null;
  const r = outerRadius * 0.62;
  const x = cx + r * Math.cos(-midAngle * RAD);
  const y = cy + r * Math.sin(-midAngle * RAD);
  return (
    <text x={x} y={y} fill="#fff" fontSize={11} fontWeight={600} style={{ pointerEvents: "none" }}
          textAnchor="middle" dominantBaseline="central">{fmtPct(payload.pct)}%</text>
  );
}

function ordered(rows, order) {
  const map = Object.fromEntries(rows.map((o) => [o.key, o]));
  const head = order.filter((k) => map[k]).map((k) => map[k]);
  const tail = rows.filter((o) => !order.includes(o.key));
  return [...head, ...tail];
}

export default function Insights() {
  const { dataset, sevColor, toggleFilter } = useStore();
  const expTitle = dataset === "india" ? "Driving experience" : "Vehicle age";

  const { data: ageAgg } = useAgg("Age_band_of_driver", { ignoreFields: ["Age_band_of_driver"] });
  const age = useMemo(() => {
    const ordAge = ordered(ageAgg, AGE_ORDER);
    const grand = ordAge.reduce((a, o) => a + (o.total || 0), 0);
    return ordAge.map((o) => ({
      ...o,
      pct: grand ? (o.total / grand) * 100 : 0,
      _slightDisp: grand ? Math.sqrt(((o["Slight Injury"] || 0) / grand) * 100) : 0,
      _seriousDisp: grand ? Math.sqrt(((o["Serious Injury"] || 0) / grand) * 100) : 0,
      _fatalDisp: grand ? Math.sqrt(((o["Fatal injury"] || 0) / grand) * 100) : 0,
    }));
  }, [ageAgg]);
  const AGE_DISP_KEY = { "Slight Injury": "_slightDisp", "Serious Injury": "_seriousDisp", "Fatal injury": "_fatalDisp" };
  const sqAge = (v) => v * v;

  const { data: expAgg } = useAgg("Driving_experience");
  const exp = useMemo(() =>
    ordered(expAgg, EXP_ORDER_BY_DATASET[dataset] || [])
      .map((o) => ({
        key: o.key,
        Fatal: o.fatalRate * 100,
        Serious: o.seriousRate * 100,
      })),
    [expAgg, dataset]);

  const { data: lightAgg } = useAgg("Light_conditions", { ignoreFields: ["Light_conditions"] });
  // Funnel/pyramid: order largest → smallest so it tapers; sqrt scale keeps small
  // conditions visible, and distinct colours avoid the injury triadic.
  const light = useMemo(() => {
    const grand = lightAgg.reduce((a, o) => a + o.total, 0);
    return sortUnknownOtherLast(lightAgg, (a, b) => b.total - a.total)
      .map((o, i) => ({
        ...o,
        name: o.key,
        _disp: Math.sqrt(o.total),
        pct: grand ? (o.total / grand) * 100 : 0,
        color: CATEGORY_COLORS[i % CATEGORY_COLORS.length],
      }));
  }, [lightAgg]);

  const { data: surfaceRaw } = useAgg("Road_surface_conditions", { minCount: 1, ignoreFields: ["Road_surface_conditions"] });
  const surface = useMemo(() => {
    const grand = surfaceRaw.reduce((a, o) => a + o.total, 0);
    return sortUnknownOtherLast(surfaceRaw, () => 0).map((o, i) => ({
      ...o,
      _disp: Math.sqrt(o.total),
      pct: grand ? (o.total / grand) * 100 : 0,
      color: CATEGORY_COLORS[i % CATEGORY_COLORS.length],
    }));
  }, [surfaceRaw]);

  const { data: sexAgg } = useAgg("Sex_of_driver", { minCount: 1, ignoreFields: ["Sex_of_driver"] });
  const sex = useMemo(() => {
    const t = sexAgg.reduce((a, o) => a + o.total, 0);
    return sexAgg
      .map((o) => ({
        key: o.key,
        pct: t ? (o.total / t) * 100 : 0,
        _slightDisp: t ? Math.sqrt(((o["Slight Injury"] || 0) / t) * 100) : 0,
        _seriousDisp: t ? Math.sqrt(((o["Serious Injury"] || 0) / t) * 100) : 0,
        _fatalDisp: t ? Math.sqrt(((o["Fatal injury"] || 0) / t) * 100) : 0,
      }))
      .sort((a, b) => b.pct - a.pct);
  }, [sexAgg]);
  const SEX_DISP_KEY = { "Slight Injury": "_slightDisp", "Serious Injury": "_seriousDisp", "Fatal injury": "_fatalDisp" };
  const sqSex = (v) => v * v;

  return (
    <div className="view insights-view" style={{ gridTemplateRows: "auto 1fr" }}>
      <div className="legend" style={{ flex: "none" }}>
        <span className="spacer" style={{ flex: 1 }} />
        {SEVERITY_ORDER.map((s) => (
          <span key={s} className="legend-item"><span className="legend-dot" style={{ background: sevColor(s) }} /> {s}</span>
        ))}
      </div>

      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr 1fr", gridTemplateRows: "1fr 1fr", minHeight: 0 }}>

        <div className="card">
          <div className="card-head"><span className="card-title">Driver age band</span></div>
          <div className="fill">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={age} margin={{ left: 0, right: 8, top: 18 }}>
                <XAxis dataKey="key" {...axisProps} tick={{ fontSize: 10, fill: "#B8C2CD" }} />
                <YAxis {...axisProps} unit="%" tickFormatter={(v) => fmtPct(sqAge(v))} />
                <Tooltip {...tipProps} formatter={(v, n) => [`${fmtPct(sqAge(v))}%`, n]} />
                {SEVERITY_ORDER.map((s, i) => (
                  <Bar key={s} dataKey={AGE_DISP_KEY[s]} name={s} stackId="a" fill={sevColor(s)} activeBar={false}
                       onClick={(d) => toggleFilter("Age_band_of_driver", d.key)} cursor="pointer">
                    {i === SEVERITY_ORDER.length - 1 && (
                      <LabelList dataKey="pct" position="top" fontSize={11} fill="#8B98A8" formatter={(v) => `${fmtPct(v)}%`} />
                    )}
                  </Bar>
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card">
          <div className="card-head"><span className="card-title">{expTitle}</span>
          </div>
          <div className="fill">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={exp} margin={{ left: 0, right: 12, top: 6 }}>
                <XAxis dataKey="key" {...axisProps} tick={{ fontSize: 9.5, fill: "#B8C2CD" }} />
                <YAxis {...axisProps} scale="sqrt" domain={[0, "dataMax"]} unit="%"
                       tickFormatter={(v) => fmtPct(v)} />
                <Tooltip {...tipProps} formatter={(v, n) => [`${fmtPct(v)}%`, n]} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="Serious" stroke={sevColor("Serious Injury")} strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="Fatal" stroke={sevColor("Fatal injury")} strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card">
          <div className="card-head"><span className="card-title">Driver sex</span></div>
          <div className="fill">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={sex} layout="vertical" margin={{ left: 6, right: 40 }}>
                <XAxis type="number" domain={[0, "dataMax"]} tickFormatter={(v) => `${fmtPct(sqSex(v))}%`} {...axisProps} />
                <YAxis type="category" dataKey="key" width={80} {...axisProps} />
                <Tooltip {...tipProps} formatter={(v, n) => [`${fmtPct(sqSex(v))}%`, n]} />
                {SEVERITY_ORDER.map((s, i) => (
                  <Bar key={s} dataKey={SEX_DISP_KEY[s]} name={s} stackId="a" fill={sevColor(s)} activeBar={false}
                       radius={i === SEVERITY_ORDER.length - 1 ? [0, 3, 3, 0] : 0}
                       onClick={(d) => toggleFilter("Sex_of_driver", d.key)} cursor="pointer">
                    {i === SEVERITY_ORDER.length - 1 && (
                      <LabelList dataKey="pct" position="right" fontSize={11} fill="#8B98A8" formatter={(v) => `${fmtPct(v)}%`} />
                    )}
                  </Bar>
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <SeverityFactorBars field="Weather_conditions" title="Weather"  top={7} minCount={10}
                            totalBasis="all" scale="sqrt" />

        <div className="card">
          <div className="card-head"><span className="card-title">Road surface</span>
          </div>
          <div className="fill">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={surface} dataKey="_disp" nameKey="key" outerRadius="82%" innerRadius={0} paddingAngle={2}
                     stroke="#0A0E14" strokeWidth={2} labelLine={false} label={renderSlicePct}
                     onClick={(d) => toggleFilter("Road_surface_conditions", d.key)} cursor="pointer">
                  {surface.map((d) => <Cell key={d.key} fill={d.color} />)}
                </Pie>
                <Legend iconSize={8} wrapperStyle={{ fontSize: 10 }} />
                <Tooltip cursor={false} content={<InjuryTooltip sevColor={sevColor} />} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card">
          <div className="card-head"><span className="card-title">Light conditions</span></div>
          <div className="fill">
            <ResponsiveContainer width="100%" height="100%">
              <FunnelChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                <Tooltip cursor={false} content={<InjuryTooltip sevColor={sevColor} />} />
                <Funnel dataKey="_disp" data={light} nameKey="key" isAnimationActive={false}
                        lastShapeType="triangle" stroke="#0A0E14" strokeWidth={2}
                        onClick={(d) => toggleFilter("Light_conditions", d.key ?? d.payload?.key)} cursor="pointer">
                  {light.map((d) => <Cell key={d.key} fill={d.color} />)}
                  <LabelList position="center" dataKey="pct" fill="#fff" stroke="none"
                             fontSize={11} fontWeight={600} formatter={(v) => `${fmtPct(v)}%`}
                             style={{ pointerEvents: "none" }} />
                </Funnel>
                <Legend iconSize={8} wrapperStyle={{ fontSize: 10 }}
                        payload={light.map((d) => ({ value: d.key, type: "square", color: d.color, id: d.key }))} />
              </FunnelChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
