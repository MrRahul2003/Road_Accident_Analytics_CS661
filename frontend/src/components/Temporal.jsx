import React, { useMemo, useState } from "react";
import { BarChart, Bar, Cell, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { useStore } from "../data/store.jsx";
import { useAgg, useMatrix } from "../data/api.js";
import { SEVERITY_ORDER } from "../theme.js";
import { axisProps, tipProps } from "./Overview.jsx";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function RateDot({ cx, cy, payload, fill, onSelect, hourRange }) {
  if (cx == null || cy == null) return null;
  const h = +payload.key;
  const dimmed = hourRange && (h < hourRange[0] || h > hourRange[1]);
  const focused = hourRange && !dimmed;
  return (
    <circle cx={cx} cy={cy} r={focused ? 5 : 3.5} fill={fill} stroke="#0A0E14" strokeWidth={1}
            opacity={dimmed ? 0.25 : 1}
            style={{ cursor: "pointer" }} onClick={() => onSelect(payload.key)} />
  );
}

export default function Temporal() {
  const { filters, toggleFilter, isActive, setFieldValues, setHourRange, hourRange, sevColor, sequential } = useStore();
  const [hover, setHover] = useState(null);

  const daySel = filters.Day_of_week || [];
  const hasSel = daySel.length > 0 || !!hourRange;
  const inSel = (d, h) =>
    (daySel.length === 0 || daySel.includes(d)) &&
    (!hourRange || (h >= hourRange[0] && h <= hourRange[1]));
  const pickCell = (e, d, h) => {
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    const dayOn = daySel.includes(d);
    const hourOn = hourRange && h >= hourRange[0] && h <= hourRange[1];
    if (additive) {
      if (hourOn && (dayOn || daySel.length === 0)) {
        const [lo, hi] = hourRange;
        if (lo === hi) setHourRange(null);
        else if (h === lo) setHourRange([h + 1, hi]);
        else if (h === hi) setHourRange([lo, h - 1]);
        else setHourRange(h - lo >= hi - h ? [lo, h - 1] : [h + 1, hi]);
      } else {
        if (!dayOn) toggleFilter("Day_of_week", d);
        if (!hourRange) setHourRange([h, h]);
        else if (!hourOn) setHourRange([Math.min(hourRange[0], h), Math.max(hourRange[1], h)]);
      }
      return;
    }
    const isOnly = dayOn && daySel.length === 1 && hourRange && hourRange[0] === h && hourRange[1] === h;
    if (isOnly) {
      setFieldValues("Day_of_week", []);
      setHourRange(null);
    } else {
      setFieldValues("Day_of_week", [d]);
      setHourRange([h, h]);
    }
  };

  const { data: matrixCells } = useMatrix("Day_of_week", "Hour", { ignoreFields: ["Day_of_week"], ignoreHourRange: true });
  const matrix = useMemo(() => {
    const m = {};
    for (const d of DAYS) m[d] = Array.from({ length: 24 }, () => ({ total: 0, fatal: 0, serious: 0 }));
    for (const c of matrixCells) {
      const cell = m[c.x]?.[c.y];
      if (!cell) continue;
      cell.total = c.total; cell.fatal = c.fatal; cell.serious = c.serious;
    }
    return m;
  }, [matrixCells]);

  const maxVal = useMemo(() => {
    let mx = 0;
    for (const d of DAYS) for (const c of matrix[d]) mx = Math.max(mx, c.total);
    return mx || 1;
  }, [matrix]);
  const color = sequential(maxVal);

  const { data: hourAgg } = useAgg("Hour", { ignoreHourRange: true });
  const hourly = useMemo(() => {
    const byH = Object.fromEntries(hourAgg.map((x) => [x.key, x]));
    return Array.from({ length: 24 }, (_, h) => {
      const o = byH[h];
      return { key: String(h), Fatal: o ? +(o.fatalRate * 100).toFixed(1) : 0, Serious: o ? +(o.seriousRate * 100).toFixed(1) : 0 };
    });
  }, [hourAgg]);

  const DISP_KEY = { "Slight Injury": "_slightDisp", "Serious Injury": "_seriousDisp", "Fatal injury": "_fatalDisp" };
  const sq = (v) => v * v;
  const { data: dayAgg } = useAgg("Day_of_week", { ignoreFields: ["Day_of_week"] });
  const byDay = useMemo(() => {
    const map = Object.fromEntries(dayAgg.map((x) => [x.key, x]));
    return DAYS.map((d) => {
      const r = map[d] || { key: d, total: 0, "Slight Injury": 0, "Serious Injury": 0, "Fatal injury": 0 };
      return {
        ...r,
        _slightDisp: Math.sqrt(r["Slight Injury"]),
        _seriousDisp: Math.sqrt(r["Serious Injury"]),
        _fatalDisp: Math.sqrt(r["Fatal injury"]),
      };
    });
  }, [dayAgg]);

  const W = 760, cellW = (W - 70) / 24, cellH = 30, gridH = cellH * 7;

  return (
    <div className="view" style={{ gridTemplateRows: "1.1fr 1fr" }}>
      <div className="card">
        <div className="card-head">
          <span className="card-title">Accident intensity </span>
        </div>
        <div className="fill flex gap-3" style={{ minHeight: 0 }}>
          <div className="relative flex-1 min-h-0">
            <svg viewBox={`0 0 ${W} ${gridH + 36}`} width="100%" height="100%" preserveAspectRatio="xMidYMid meet" style={{ display: "block" }}>
              {DAYS.map((d, di) => (
                <text key={d} x={62} y={di * cellH + cellH / 2 + 18} textAnchor="end" fontSize="11" fill="#B8C2CD"
                      style={{ cursor: "pointer" }} onClick={() => toggleFilter("Day_of_week", d)}
                      fontWeight={isActive("Day_of_week", d) ? 700 : 400}>{d.slice(0, 3)}</text>
              ))}
              {Array.from({ length: 24 }, (_, h) => (
                h % 3 === 0 && <text key={h} x={70 + h * cellW + cellW / 2} y={gridH + 30} textAnchor="middle"
                                     fontSize="10" fill="#B8C2CD" fontFamily="JetBrains Mono">{String(h).padStart(2, "0")}</text>
              ))}
              {DAYS.map((d, di) => matrix[d].map((c, h) => (
                <rect key={d + h} className="hm-cell" x={70 + h * cellW} y={di * cellH + 4} width={cellW - 2} height={cellH - 2}
                      rx="2" fill={c.total ? color(c.total) : "#0E141C"}
                      opacity={hasSel && !inSel(d, h) ? 0.16 : 1}
                      onClick={(e) => pickCell(e, d, h)}
                      onMouseEnter={() => setHover({ d, h, c })} onMouseLeave={() => setHover(null)} />
              )))}
            </svg>
            {hover && (
              <div style={{ position: "absolute", top: 6, right: 6, background: "#0A0E14", border: "1px solid #2C3A4A",
                            borderRadius: 8, padding: "8px 11px", fontSize: 12 }}>
                <b>{hover.d} · {String(hover.h).padStart(2, "0")}:00</b>
                <div style={{ color: "#8B98A8" }}>{hover.c.total} accidents · {hover.c.fatal} fatal</div>
              </div>
            )}
          </div>
          <div className="flex flex-col items-center gap-2 text-[11px] text-[#8B98A8] w-14 shrink-0">
            <span>more</span>
            <div className="flex flex-col w-2.5 flex-1 rounded overflow-hidden">
              {Array.from({ length: 24 }, (_, i) => <div key={i} className="flex-1" style={{ background: color(((23 - i) / 23) * maxVal) }} />)}
            </div>
            <span>fewer</span>
          </div>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "1.5fr 1fr", minHeight: 0 }}>
        <div className="card">
          <div className="card-head">
            <span className="card-title">Fatal & serious rate by hour</span>
          </div>
          <div className="fill">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={hourly} margin={{ left: 0, right: 10, top: 6 }}>
                <XAxis dataKey="key" {...axisProps} tickFormatter={(h) => `${String(h).padStart(2, "0")}`} />
                <YAxis {...axisProps} unit="%" />
                <Tooltip {...tipProps} formatter={(v, n) => [`${v}%`, n]} labelFormatter={(h) => `${String(h).padStart(2, "0")}:00`} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="Serious" stroke={sevColor("Serious Injury")} strokeWidth={2}
                      dot={({ key, ...p }) => <RateDot key={p.payload.key} {...p} hourRange={hourRange} onSelect={(k) => setHourRange([+k, +k])} />} />
                <Line type="monotone" dataKey="Fatal" stroke={sevColor("Fatal injury")} strokeWidth={2}
                      dot={({ key, ...p }) => <RateDot key={p.payload.key} {...p} hourRange={hourRange} onSelect={(k) => setHourRange([+k, +k])} />} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <span className="card-title">Accidents by day of week</span>
          </div>
          <div className="fill">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byDay} margin={{ left: 0, right: 10 }}>
                <XAxis dataKey="key" {...axisProps} tickFormatter={(d) => d.slice(0, 3)} />
                <YAxis {...axisProps} tickFormatter={(v) => Math.round(sq(v)).toLocaleString()} />
                <Tooltip {...tipProps} formatter={(v, n) => [Math.round(sq(v)).toLocaleString(), n]} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {SEVERITY_ORDER.map((s) => (
                  <Bar key={s} dataKey={DISP_KEY[s]} name={s} stackId="a" fill={sevColor(s)} activeBar={false}
                       onClick={(d) => toggleFilter("Day_of_week", d.key)} cursor="pointer">
                    {byDay.map((d) => {
                      const on = daySel.length === 0 || daySel.includes(d.key);
                      return (
                        <Cell key={d.key} fillOpacity={on ? 1 : 0.22}
                              stroke={daySel.includes(d.key) ? "#FFFFFF" : "none"}
                              strokeWidth={daySel.includes(d.key) ? 1.5 : 0} />
                      );
                    })}
                  </Bar>
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
