import React, { useMemo } from "react";
import {
  BarChart, Bar, LineChart, Line,
  RadialBarChart, RadialBar, PolarRadiusAxis, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { useStore } from "../data/store.jsx";
import { useAgg } from "../data/api.js";
import { SEVERITY_ORDER } from "../theme.js";
import { axisProps, tipProps } from "./Overview.jsx";
import SeverityFactorBars from "./SeverityFactorBars.jsx";

const AGE_ORDER = ["Under 18", "18-30", "31-50", "Over 51", "Unknown"];

const EXP_ORDER_BY_DATASET = {
  india: ["No Licence", "Below 1yr", "1-2yr", "2-5yr", "5-10yr", "Above 10yr", "Unknown"],
  uk: ["Unknown", "0-2 yrs", "3-5 yrs", "6-10 yrs", "11-15 yrs", "Over 15 yrs"],
};

function ordered(rows, order) {
  const map = Object.fromEntries(rows.map((o) => [o.key, o]));
  const head = order.filter((k) => map[k]).map((k) => map[k]);
  const tail = rows.filter((o) => !order.includes(o.key));
  return [...head, ...tail];
}

export default function Insights() {
  const { dataset, sevColor, toggleFilter, palette } = useStore();
  const expTitle = dataset === "india" ? "Driving experience" : "Vehicle age";

  const { data: ageAgg } = useAgg("Age_band_of_driver", { ignoreFields: ["Age_band_of_driver"] });
  const age = useMemo(() =>
    ordered(ageAgg, AGE_ORDER).map((o) => ({
      ...o,
      _slightDisp: Math.sqrt(o["Slight Injury"] || 0),
      _seriousDisp: Math.sqrt(o["Serious Injury"] || 0),
      _fatalDisp: Math.sqrt(o["Fatal injury"] || 0),
    })),
    [ageAgg]);
  const AGE_DISP_KEY = { "Slight Injury": "_slightDisp", "Serious Injury": "_seriousDisp", "Fatal injury": "_fatalDisp" };
  const sqAge = (v) => Math.round(v * v);

  const { data: expAgg } = useAgg("Driving_experience");
  const exp = useMemo(() =>
    ordered(expAgg, EXP_ORDER_BY_DATASET[dataset] || [])
      .map((o) => ({ key: o.key, Fatal: +(o.fatalRate * 100).toFixed(1), Serious: +(o.seriousRate * 100).toFixed(1) })),
    [expAgg, dataset]);

  const { data: lightAgg } = useAgg("Light_conditions", { ignoreFields: ["Light_conditions"] });
  const light = useMemo(() =>
    [...lightAgg].sort((a, b) => b.risk - a.risk)
      .map((o, i) => ({ name: o.key, value: +(o.fatalRate * 100).toFixed(1), risk: o.risk,
                         color: palette.categorical[i % palette.categorical.length] })),
    [lightAgg, palette]);

  const { data: surfaceRaw } = useAgg("Road_surface_conditions", { minCount: 1, ignoreFields: ["Road_surface_conditions"] });
  const surface = useMemo(() =>
    surfaceRaw.map((o, i) => ({ ...o, color: palette.categorical[i % palette.categorical.length] })),
    [surfaceRaw, palette]);

  const { data: sexAgg } = useAgg("Sex_of_driver", { minCount: 1, ignoreFields: ["Sex_of_driver"] });
  const sex = useMemo(() => {
    const t = sexAgg.reduce((a, o) => a + o.total, 0);
    return sexAgg
      .map((o) => ({ key: o.key, pct: t ? +((o.total / t) * 100).toFixed(1) : 0 }))
      .sort((a, b) => b.pct - a.pct);
  }, [sexAgg]);

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
              <BarChart data={age} margin={{ left: 0, right: 8 }}>
                <XAxis dataKey="key" {...axisProps} tick={{ fontSize: 10, fill: "#B8C2CD" }} />
                <YAxis {...axisProps} tickFormatter={sqAge} />
                <Tooltip {...tipProps} formatter={(v, n) => [sqAge(v).toLocaleString(), n]} />
                {SEVERITY_ORDER.map((s) => (
                  <Bar key={s} dataKey={AGE_DISP_KEY[s]} name={s} stackId="a" fill={sevColor(s)} activeBar={false}
                       onClick={(d) => toggleFilter("Age_band_of_driver", d.key)} cursor="pointer" />
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
                <YAxis {...axisProps} unit="%" />
                <Tooltip {...tipProps} formatter={(v, n) => [`${v}%`, n]} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="Serious" stroke={sevColor("Serious Injury")} strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="Fatal" stroke={sevColor("Fatal injury")} strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <SeverityFactorBars field="Weather_conditions" title="Weather"  top={7} minCount={10}
                            totalBasis="all" scale="sqrt" />

        <div className="card">
          <div className="card-head"><span className="card-title">Light conditions</span></div>
          <div className="fill">
            <ResponsiveContainer width="100%" height="100%">
              <RadialBarChart data={light} innerRadius="18%" outerRadius="80%" startAngle={90} endAngle={-270}
                              margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                <RadialBar dataKey="value" background={{ fill: "#0F151D" }} cornerRadius={3}
                           onClick={(d) => toggleFilter("Light_conditions", d.name)} cursor="pointer">
                  {light.map((d) => <Cell key={d.name} fill={d.color} />)}
                </RadialBar>
                <PolarRadiusAxis type="number" domain={[0, "dataMax"]} angle={90} tickCount={4}
                                 axisLine={false} tick={{ fontSize: 9, fill: "#E6EDF3" }}
                                 tickFormatter={(v) => `${(v ?? 0).toFixed(0)}%`} />
                <Legend iconSize={8} layout="vertical" verticalAlign="middle" align="right"
                        wrapperStyle={{ fontSize: 9.5, lineHeight: "16px", paddingLeft: 18 }} />
                <Tooltip {...tipProps} formatter={(v, n, p) => [`${v}% fatal (risk ${p.payload.risk.toFixed(2)})`, ""]} />
              </RadialBarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card">
          <div className="card-head"><span className="card-title">Road surface</span>
          </div>
          <div className="fill">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={surface} dataKey="total" nameKey="key" outerRadius="82%" innerRadius="42%" paddingAngle={2}
                     stroke="#0A0E14" strokeWidth={2}
                     onClick={(d) => toggleFilter("Road_surface_conditions", d.key)} cursor="pointer">
                  {surface.map((d) => <Cell key={d.key} fill={d.color} />)}
                </Pie>
                <Legend iconSize={8} wrapperStyle={{ fontSize: 10 }} />
                <Tooltip {...tipProps} formatter={(v, n, p) => [`${v.toLocaleString()} (risk ${p.payload.risk.toFixed(2)})`, p.payload.key]} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card">
          <div className="card-head"><span className="card-title">Driver sex</span></div>
          <div className="fill">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={sex} layout="vertical" margin={{ left: 6, right: 40 }}>
                <XAxis type="number" domain={[0, 100]} tickFormatter={(v) => `${v}%`} {...axisProps} />
                <YAxis type="category" dataKey="key" width={80} {...axisProps} />
                <Tooltip {...tipProps} formatter={(v) => [`${v}%`, "Share"]} />
                <Bar dataKey="pct" radius={[0, 3, 3, 0]} activeBar={false}
                     onClick={(d) => toggleFilter("Sex_of_driver", d.key)} cursor="pointer"
                     label={{ position: "right", fontSize: 11, fill: "#8B98A8", formatter: (v) => `${v}%` }}>
                  {sex.map((d, i) => <Cell key={d.key} fill={palette.categorical[i % palette.categorical.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
