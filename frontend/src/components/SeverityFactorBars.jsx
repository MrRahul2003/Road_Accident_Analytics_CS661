import React, { useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { useStore } from "../data/store.jsx";
import { useAgg } from "../data/api.js";
import { SEVERITY_ORDER } from "../theme.js";
import { foldAgg, memberMap } from "../data/aggutil.js";
import { tipProps } from "./Overview.jsx";

export default function SeverityFactorBars({ field, title, sub, top = 8, sortByRisk = true, legend = false, minCount = 5, remap, className = "", totalBasis = "category", scale = "linear" }) {
  const { sevColor, toggleFilter, toggleFilterValues } = useStore();
  const { data: agg } = useAgg(field, { minCount, ignoreFields: [field] });

  const members = useMemo(() => (remap ? memberMap(agg, remap) : null), [agg, remap]);
  const onBar = (key) => (members ? toggleFilterValues(field, members[key] || []) : toggleFilter(field, key));

  const data = useMemo(() => {
    const rows = remap ? foldAgg(agg, remap) : agg;
    const grandTotal = rows.reduce((sum, o) => sum + o.total, 0);
    let g = [...rows].sort((a, b) => (sortByRisk ? b.risk - a.risk : b.total - a.total)).slice(0, top);
    return g.map((o) => {
      const denom = totalBasis === "all" ? grandTotal : o.total;
      return {
        key: o.key,
        total: o.total,
        _slight: denom ? (o["Slight Injury"] / denom) * 100 : 0,
        _serious: denom ? (o["Serious Injury"] / denom) * 100 : 0,
        _fatal: denom ? (o["Fatal injury"] / denom) * 100 : 0,
      };
    });
  }, [agg, sortByRisk, top, remap, totalBasis]);

  const keyMap = { "Slight Injury": "_slight", "Serious Injury": "_serious", "Fatal injury": "_fatal" };

  return (
    <div className={`card ${className}`}>
      <div className="card-head">
        <span className="card-title">{title}</span>
        {sub && <span className="card-sub">{sub}</span>}
      </div>
      <div className="fill">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ left: 6, right: 30 }} barCategoryGap={3}>
            <XAxis type="number" scale={scale} domain={totalBasis === "all" ? [0, "dataMax"] : [0, 100]}
                   ticks={totalBasis === "all" || scale !== "linear" ? undefined : [0, 25, 50, 75, 100]}
                   tickFormatter={(v) => `${v.toFixed(0)}%`}
                   stroke="#2C3A4A" tick={{ fontSize: 9.5, fill: "#B8C2CD" }} tickLine={false} />
            <YAxis type="category" dataKey="key" width={118} stroke="#2C3A4A" tick={{ fontSize: 10, fill: "#B8C2CD" }} tickLine={false} />
            <Tooltip {...tipProps} formatter={(v, n) => [`${v.toFixed(1)}%`, n]} />
            {legend && <Legend wrapperStyle={{ fontSize: 11 }} />}
            {SEVERITY_ORDER.map((s) => (
              <Bar key={s} dataKey={keyMap[s]} name={s} stackId="a" fill={sevColor(s)} activeBar={false}
                   onClick={(d) => onBar(d.key)} cursor="pointer"
                   label={s === "Fatal injury" ? { position: "right", fontSize: 9.5, fill: sevColor("Fatal injury"),
                            formatter: (v) => (v > 0 ? `${v.toFixed(0)}%` : "") } : false} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
