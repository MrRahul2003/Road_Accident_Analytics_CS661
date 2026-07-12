import React, { useMemo, useState, useEffect } from "react";
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { geoMercator, geoPath } from "d3-geo";
import { useStore } from "../data/store.jsx";
import { useKpis, useAgg } from "../data/api.js";
import { foldAgg, memberMap, mergeOtherUnknown, sortOtherLast } from "../data/aggutil.js";
import { SEVERITY_ORDER, meanDivergingColor } from "../theme.js";

const WORLD_GEO_PATH = "app-data/world_countries.geojson";

const TOD_ORDER = ["Night (0-5)", "Morning (6-11)", "Afternoon (12-16)", "Evening (17-20)"];
const EMPTY_SEV = { "Slight Injury": 0, "Serious Injury": 0, "Fatal injury": 0 };

const GEO_CONFIG = {
  india: { path: "app-data/india_states.geojson", nameProp: "st_nm" },
  uk: { path: "app-data/uk_police_forces.geojson", nameProp: "name" },
};

function Kpi({ label, value, unit, foot }) {
  return (
    <div className="relative overflow-hidden rounded-[10px] border border-[#1F2935] bg-[#121821] px-3.5 py-2.75 before:absolute before:left-0 before:top-0 before:bottom-0 before:w-0.75 before:bg-[#E69F00] before:opacity-70 before:content-['']">
      <div className="text-[11px] uppercase tracking-[0.06em] text-[#8B98A8]">{label}</div>
      <div className="mt-1 font-(family-name:--mono) text-[23px] font-bold tracking-[-0.02em]">
        {value}<span className="text-[13px] font-medium text-[#5A6675]"> {unit}</span>
      </div>
      <div className="mt-0.75 text-[11px] text-[#5A6675]">{foot}</div>
    </div>
  );
}

function ChartCard({ title, sub, className, legend, children }) {
  return (
    <div className={`card ${className}`}>
      <div className="card-head">
        <span className="card-title">{title}</span>
        {sub && <span className="card-sub">{sub}</span>}
      </div>
      <div className="fill">
        <ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer>
      </div>
      {legend}
    </div>
  );
}

function SevLegend({ sevColor, onPick }) {
  return (
    <div className="mt-2 flex flex-none flex-wrap justify-center gap-x-4 gap-y-1">
      {SEVERITY_ORDER.map((s) => (
        <span key={s} className="legend-item cursor-pointer" onClick={() => onPick(s)}>
          <span className="legend-dot" style={{ background: sevColor(s) }} /> {s}
        </span>
      ))}
    </div>
  );
}

export default function Overview() {
  const { dataset, sevColor, toggleFilter, toggleFilterValues } = useStore();

  const { data: kpis } = useKpis();
  const sev = kpis ? kpis.severityCounts : EMPTY_SEV;
  const total = kpis ? kpis.total : 0;
  const peakHour = kpis && kpis.peakHour != null ? `${String(kpis.peakHour).padStart(2, "0")}:00` : "—";

  const donut = useMemo(() => SEVERITY_ORDER.map((s) => ({ name: s, value: sev[s], display: Math.sqrt(sev[s]) })), [sev]);

  const withPct = (r, denom) => {
    const slight = denom ? (r["Slight Injury"] / denom) * 100 : 0;
    const serious = denom ? (r["Serious Injury"] / denom) * 100 : 0;
    const fatal = denom ? (r["Fatal injury"] / denom) * 100 : 0;
    return {
      ...r,
      _slight: slight, _serious: serious, _fatal: fatal,
      _slightDisp: Math.sqrt(slight), _seriousDisp: Math.sqrt(serious), _fatalDisp: Math.sqrt(fatal),
    };
  };

  const { data: areaAggRaw } = useAgg("Area_accident_occured", { ignoreFields: ["Area_accident_occured"] });
  const areaAgg = useMemo(() => foldAgg(areaAggRaw, mergeOtherUnknown), [areaAggRaw]);
  const areaMembers = useMemo(() => memberMap(areaAggRaw, mergeOtherUnknown), [areaAggRaw]);
  const areaGrandTotal = useMemo(() => areaAgg.reduce((sum, o) => sum + o.total, 0), [areaAgg]);
  const areas = useMemo(
    () => sortOtherLast(areaAgg, (a, b) => b.total - a.total).slice(0, 8).map((r) => withPct(r, areaGrandTotal)),
    [areaAgg, areaGrandTotal]);

  const { data: todAgg } = useAgg("Time_of_day", { ignoreFields: ["Time_of_day"] });
  const todGrandTotal = useMemo(() => todAgg.reduce((sum, o) => sum + o.total, 0), [todAgg]);
  const tod = useMemo(
    () => TOD_ORDER.map((k) => withPct(todAgg.find((x) => x.key === k) || { key: k, total: 0, ...EMPTY_SEV }, todGrandTotal)),
    [todAgg, todGrandTotal]);

  const DISP_KEY = { "Slight Injury": "_slightDisp", "Serious Injury": "_seriousDisp", "Fatal injury": "_fatalDisp" };

  const sevBars = (field, onBarClick = (d) => toggleFilter(field, d.key)) => SEVERITY_ORDER.map((s, i) => (
    <Bar key={s} dataKey={DISP_KEY[s]} name={s} stackId="a" fill={sevColor(s)} activeBar={false}
         onClick={onBarClick} cursor="pointer"
         isAnimationActive animationDuration={1800} animationEasing="ease-out" animationBegin={i * 120} />
  ));

  const sq = (v) => v * v;

  return (
    <div className="view grid-cols-[1.9fr_1fr] grid-rows-[auto_1fr_1fr_1fr]">
      <div className="kpi-row col-span-2 mb-0">
        <Kpi label="Total accidents" value={total.toLocaleString()} foot="in current selection" />
        <Kpi label="Fatal share" value={(kpis ? kpis.fatalPct : 0).toFixed(1)} unit="%" foot={`${sev["Fatal injury"].toLocaleString()} fatal injuries`} />
        <Kpi label="Serious share" value={(kpis ? kpis.seriousPct : 0).toFixed(1)} unit="%" foot={`${sev["Serious Injury"].toLocaleString()} serious injuries`} />
        <Kpi label="Avg casualties" value={(kpis ? kpis.avgCasualties : 0).toFixed(2)} foot="per accident" />
        <Kpi label="Peak hour" value={peakHour} foot={`${(kpis ? kpis.weekendPct : 0).toFixed(0)}% on weekends`} />
      </div>

      <ChartCard title="Severity distribution" className="col-start-2 row-start-2"
                 legend={<SevLegend sevColor={sevColor} onPick={(s) => toggleFilter("Accident_severity", s)} />}>
        <PieChart>
          <Pie data={donut} dataKey="display" nameKey="name" innerRadius="48%" outerRadius="78%" paddingAngle={2}
               onClick={(d) => toggleFilter("Accident_severity", d.name)} stroke="#0A0E14" strokeWidth={2}
               isAnimationActive animationDuration={1800} animationEasing="ease-out">
            {donut.map((d) => <Cell key={d.name} fill={sevColor(d.name)} cursor="pointer" />)}
          </Pie>
          <Tooltip {...tipProps} formatter={(_v, n, p) => [`${p.payload.value.toLocaleString()} (${((p.payload.value / total) * 100).toFixed(1)}%)`, n]} />
        </PieChart>
      </ChartCard>

      <ChartCard title="Severity by accident area" className="col-start-2 row-start-3"
                 legend={<SevLegend sevColor={sevColor} onPick={(s) => toggleFilter("Accident_severity", s)} />}>
        <BarChart data={areas} layout="vertical" margin={{ left: 10, right: 16 }}>
          <XAxis type="number" domain={[0, "dataMax"]} tickFormatter={(v) => `${sq(v).toFixed(0)}%`} {...axisProps} />
          <YAxis type="category" dataKey="key" width={150} interval={0} {...axisProps} tick={{ fontSize: 11, fill: "#B8C2CD" }} />
          <Tooltip {...tipProps} formatter={(v, n) => [`${sq(v).toFixed(1)}%`, n]} />
          {sevBars("Area_accident_occured",
                    (d) => toggleFilterValues("Area_accident_occured", areaMembers[d.key] || [d.key]))}
        </BarChart>
      </ChartCard>

      <ChartCard title="Severity composition across the day" className="col-start-2 row-start-4"
                 legend={<SevLegend sevColor={sevColor} onPick={(s) => toggleFilter("Accident_severity", s)} />}>
        <BarChart data={tod} margin={{ left: 0, right: 10 }}>
          <XAxis dataKey="key" interval={0} tickFormatter={(v) => v.split(" ")[0]} {...axisProps} />
          <YAxis domain={[0, "dataMax"]} tickFormatter={(v) => `${sq(v).toFixed(0)}%`} {...axisProps} />
          <Tooltip {...tipProps} formatter={(v, n) => [`${sq(v).toFixed(1)}%`, n]} />
          {sevBars("Time_of_day")}
        </BarChart>
      </ChartCard>

      <StateMini dataset={dataset} className="col-start-1 row-start-2 row-span-3" />
    </div>
  );
}

function StateMini({ dataset, className }) {
  const { diverging, filters, setFieldValues, toggleFilter } = useStore();
  const { data: stateAgg } = useAgg("State", { ignoreFields: ["State"] });
  const [geoByDataset, setGeoByDataset] = useState({});
  const [world, setWorld] = useState(null);
  const [hover, setHover] = useState(null);
  const isIndia = dataset === "india";
  const geoCfg = GEO_CONFIG[dataset];
  const MODES = [ ["2d", "2D"], ["list", "List"]];
  const [mode, setMode] = useState("2d");

  useEffect(() => { setMode("2d"); }, [isIndia]);

  const selected = filters.State && filters.State.length === 1 ? filters.State[0] : null;
  const pick = (name) => setFieldValues("State", selected === name ? [] : [name]);

  useEffect(() => {
    if (geoByDataset[dataset]) return;
    fetch(geoCfg.path).then((r) => r.json())
      .then((data) => setGeoByDataset((m) => ({ ...m, [dataset]: data }))).catch(() => {});
  }, [dataset, geoCfg.path, geoByDataset]);

  useEffect(() => {
    if (world) return;
    fetch(WORLD_GEO_PATH).then((r) => r.json()).then(setWorld).catch(() => {});
  }, [world]);

  const geo = geoByDataset[dataset] || null;
  const W = 300, H = 330;
  const projection = useMemo(() => (geo ? geoMercator().fitSize([W, H], geo) : null), [geo]);
  const path = useMemo(() => (projection ? geoPath(projection) : null), [projection]);
  const byState = useMemo(() => Object.fromEntries((stateAgg || []).map((s) => [s.key, s])), [stateAgg]);

  const needsGeo = mode === "2d";
  if (needsGeo && (!geo || !path)) return null;

  const max = Math.max(1, ...stateAgg.map((s) => s.total));
  const ranked = [...stateAgg].sort((a, b) => b.total - a.total);
  const top = ranked.slice(0, 5);

  const regionLabel = isIndia ? "India" : "UK";
  const f = selected ? byState[selected] : null;
  const natAcc = stateAgg.reduce((a, s) => a + s.total, 0);
  const natFatal = stateAgg.reduce((a, s) => a + s["Fatal injury"], 0);

  const { color, domain: colorDomain, mean } = meanDivergingColor(diverging, stateAgg.map((s) => s.total));
  const [colorLo, , colorHi] = colorDomain;
  const head = f
    ? { title: selected, accidents: f.total, fatal: f["Fatal injury"], fatalRate: f.fatalRate }
    : { title: `All ${regionLabel}`, accidents: natAcc, fatal: natFatal, fatalRate: natAcc ? natFatal / natAcc : 0 };

  return (
    <div className={`card ${className}`}>
      <div className="card-head">
        <span className="card-title">{isIndia ? "India · accidents by state" : "UK · accidents by police force area"}</span>
        <span className="card-sub">
        </span>
        {MODES.length > 1 && (
          <span className="flex gap-1 rounded-md border border-[#1F2935] bg-[#0F151D] p-0.5">
            {MODES.map(([id, label]) => (
              <button key={id} type="button" onClick={() => setMode(id)}
                      className="rounded-sm px-2 py-0.75 text-[10.5px] font-semibold tracking-[0.02em] transition-colors"
                      style={{ background: mode === id ? "#E69F00" : "transparent", color: mode === id ? "#0A0E14" : "#8B98A8" }}>
                {label}
              </button>
            ))}
          </span>
        )}
      </div>
      <div className="fill grid grid-cols-[minmax(0,1fr)_190px] gap-3.5">
        <div className="flex min-h-0 flex-col">
          <div className="relative min-h-0 flex-1 flex gap-2">
            <div className="relative min-h-0 flex-1">
              {mode === "2d" && (
                <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" preserveAspectRatio="xMidYMid meet" className="block">
                  {world && (
                    <g pointerEvents="none">
                      {world.features.map((feat, i) => (
                        <path key={i} d={path(feat)} fill="#141B24" stroke="#1F2935" strokeWidth={0.35} />
                      ))}
                    </g>
                  )}
                  {geo.features.map((feat) => {
                    const name = feat.properties[geoCfg.nameProp];
                    const s = byState[name];
                    const isSel = selected === name;
                    const dim = selected && !isSel;
                    return (
                      <path key={name} d={path(feat)} className="cursor-pointer"
                            fill={s ? color(s.total) : "#1A222C"}
                            stroke={isSel ? "#E69F00" : "#0A0E14"} strokeWidth={isSel ? 1.6 : 0.4}
                            opacity={dim ? 0.45 : (hover && hover !== name ? 0.8 : 1)}
                            onClick={() => pick(name)}
                            onMouseEnter={() => setHover(name)} onMouseLeave={() => setHover(null)} />
                    );
                  })}
                </svg>
              )}
              {mode === "list" && (
                <div className="absolute inset-0 overflow-y-auto flex flex-col gap-[5px] pr-1">
                  {ranked.map((s) => {
                    const isSel = selected === s.key;
                    return (
                      <div key={s.key} className="flex items-center gap-2.5 text-xs cursor-pointer"
                           onClick={() => pick(s.key)}>
                        <span className={`w-[132px] truncate ${isSel ? "text-[#E6EDF3]" : "text-[#8B98A8]"}`}>{s.key}</span>
                        <div className="flex-1 h-[13px] rounded-[5px] overflow-hidden bg-[#0F151D] border border-[#1F2935]"
                             style={{ outline: isSel ? "1px solid #E69F00" : "none" }}>
                          <div className="h-full" style={{ width: `${(s.total / max) * 100}%`, background: color(s.total) }} />
                        </div>
                        <span className="w-11.5 text-right text-[#E6EDF3] [font-family:var(--mono)]" title={`${s.total.toLocaleString()} accidents`}>
                          {(natAcc ? (s.total / natAcc) * 100 : 0).toFixed(1)}%
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
              {mode !== "list" && hover && byState[hover] && (
                <div className="absolute top-1.5 left-1.5 max-w-50 rounded-[7px] px-2.5 py-1.75 text-[11.5px] pointer-events-none bg-[#0A0E14] border border-[#2C3A4A]">
                  <div className="font-semibold">{hover}</div>
                  <div className="text-[#8B98A8]">{byState[hover].total.toLocaleString()} accidents · {byState[hover]["Fatal injury"].toLocaleString()} fatal</div>
                  <div className="text-[#E69F00] [font-family:var(--mono)] mt-0.5">{(mean ? byState[hover].total / mean : 1).toFixed(2)}× national avg</div>
                </div>
              )}
            </div>
            {needsGeo && (
              <div className="flex flex-col items-center gap-1.5 py-1 text-[11px] text-[#8B98A8] w-12 shrink-0">
                <span>Above avg</span>
                <div className="flex flex-1 w-2 flex-col overflow-hidden rounded">
                  {Array.from({ length: 20 }, (_, i) => {
                    const v = colorHi - (i / 19) * (colorHi - colorLo);
                    return <div key={i} className="flex-1" style={{ background: color(v) }} />;
                  })}
                </div>
                <span>Below avg</span>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2.5 min-h-0 overflow-hidden">
          <div className="flex items-baseline gap-2">
            <span className="text-[13px] font-semibold">{head.title}</span>
            {selected && <span className="text-[11px] text-[#E69F00] cursor-pointer" onClick={() => setFieldValues("State", [])}>✕ clear</span>}
          </div>
          <div className="flex flex-col gap-2">
            <MiniStat label="Accidents" value={head.accidents.toLocaleString()} />
            <MiniStat label="Fatal injuries" value={head.fatal.toLocaleString()} />
            <MiniStat label="Fatal rate" value={`${(head.fatalRate * 100).toFixed(2)}%`} />
            <MiniStat label={`Share of ${regionLabel}`} value={`${(natAcc ? (head.accidents / natAcc) * 100 : 0).toFixed(1)}%`} />
          </div>
          {mode !== "list" && (
            <div className="flex flex-col gap-1.25">
              <div className="text-[10.5px] uppercase tracking-wider text-[#5A6675]">Top 5</div>
              {top.map((s) => (
                <div key={s.key} className="flex items-center gap-2.5 text-xs cursor-pointer" onClick={() => pick(s.key)}>
                  <span className={`w-26 truncate ${selected === s.key ? "text-[#E6EDF3]" : "text-[#8B98A8]"}`}>{s.key}</span>
                  <div className="flex-1 h-3.25 rounded-[5px] overflow-hidden bg-[#0F151D]">
                    <div className="h-full" style={{ width: `${(s.total / max) * 100}%`, background: color(s.total) }} />
                  </div>
                  <span className="w-11.5 text-right text-[#E6EDF3] [font-family:var(--mono)]" title={`${s.total.toLocaleString()} accidents`}>
                    {(natAcc ? (s.total / natAcc) * 100 : 0).toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MiniStat({ label, value }) {
  return (
    <div className="flex items-baseline justify-between gap-2 rounded-lg px-2.75 py-2 bg-[#0F151D] border border-[#1F2935]">
      <span className="text-[10px] uppercase tracking-wider whitespace-nowrap text-[#8B98A8]">{label}</span>
      <span className="text-base font-bold whitespace-nowrap [font-family:var(--mono)]">{value}</span>
    </div>
  );
}

export const axisProps = { stroke: "#2C3A4A", tick: { fontSize: 11, fill: "#B8C2CD" }, tickLine: false };
export const tipProps = {
  contentStyle: { background: "#0F151D", border: "1px solid #2C3A4A", borderRadius: 8, fontSize: 12 },
  labelStyle: { color: "#E6EDF3" }, itemStyle: { color: "#E6EDF3" }, cursor: false,
};
