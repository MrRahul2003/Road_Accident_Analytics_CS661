import React, { useMemo, useRef, useState } from "react";
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Legend, Tooltip, ResponsiveContainer } from "recharts";
import { arc } from "d3-shape";
import { useStore } from "../data/store.jsx";
import { useAgg } from "../data/api.js";
import { foldAgg, mergeOtherUnknown, vehicleClass, memberMap, sortOtherLast } from "../data/aggutil.js";
import { textColorFor } from "../theme.js";
import { axisProps, tipProps } from "./Overview.jsx";

const FISHEYE_RADIUS = 135;
const FISHEYE_DISTORTION = 4.5;

function fisheyeDistort(px, py, fx, fy, radius, distortion) {
  const dx = px - fx, dy = py - fy;
  const dd = Math.sqrt(dx * dx + dy * dy);
  if (!dd || dd >= radius) return { x: px, y: py, z: 1 };
  const k0 = (Math.exp(distortion) / (Math.exp(distortion) - 1)) * radius;
  const k1 = distortion / radius;
  const k = ((k0 * (1 - Math.exp(-dd * k1))) / dd) * 0.75 + 0.25;
  return { x: fx + dx * k, y: fy + dy * k, z: k };
}

function packLayout(nodes, W, H, iters = 220) {
  const cx = W / 2, cy = H / 2;
  const seeded = nodes.map((n, i) => {
    const a = i * 2.399963;
    return { ...n, x: cx + Math.cos(a) * (40 + i * 14), y: cy + Math.sin(a) * (30 + i * 11) };
  });
  for (let it = 0; it < iters; it++) {
    for (const n of seeded) { n.x += (cx - n.x) * 0.012; n.y += (cy - n.y) * 0.012; }
    for (let i = 0; i < seeded.length; i++)
      for (let j = i + 1; j < seeded.length; j++) {
        const a = seeded[i], b = seeded[j];
        let dx = b.x - a.x, dy = b.y - a.y;
        let d = Math.hypot(dx, dy) || 0.01;
        const min = a.r + b.r + 14;
        if (d < min) {
          const push = (min - d) / 2;
          dx /= d; dy /= d;
          a.x -= dx * push; a.y -= dy * push;
          b.x += dx * push; b.y += dy * push;
        }
      }
    for (const n of seeded) {
      n.x = Math.max(n.r + 4, Math.min(W - n.r - 4, n.x));
      n.y = Math.max(n.r + 4, Math.min(H - n.r - 4, n.y));
    }
  }
  return seeded;
}

const ROSE = 240;

const VEHICLE_PASTELS = {
  "Four-wheeler": "#A8D8FF",
  "Long chassis": "#FFD8A8",
  "Two-wheeler": "#B8F2C8",
  "Other": "#C9CED6",
};

export default function Geospatial() {
  const { dataset, toggleFilterValues, isAnyActive, sequential } = useStore();
  const [hover, setHover] = useState(null);
  const [laneHover, setLaneHover] = useState(null);
  const [focus, setFocus] = useState(null);
  const svgRef = useRef(null);
  const W = 640, H = 460;

  const handleFisheyeMove = (e) => {
    const svg = svgRef.current;
    if (!svg || areaFilterActive) return;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const loc = pt.matrixTransform(ctm.inverse());
    setFocus({ x: loc.x, y: loc.y });
  };

  const { data: areasRaw } = useAgg("Area_accident_occured", { minCount: 1, ignoreFields: ["Area_accident_occured"] });
  const areas = useMemo(() => foldAgg(areasRaw, mergeOtherUnknown), [areasRaw]);
  const areaMembers = useMemo(() => memberMap(areasRaw, mergeOtherUnknown), [areasRaw]);
  const areaActive = (key) => isAnyActive("Area_accident_occured", areaMembers[key] || [key]);
  const areaClick = (key) => toggleFilterValues("Area_accident_occured", areaMembers[key] || [key]);
  const maxCount = Math.max(1, ...areas.map((a) => a.total));
  const maxRisk = Math.max(0.01, ...areas.map((a) => a.risk));

  const nodes = useMemo(() => {
    const sized = areas.map((a) => ({
      ...a, r: 20 + 58 * Math.sqrt(a.total / maxCount),
    }));
    return packLayout(sized, W, H);
  }, [areas, maxCount]);

  const areaFilterActive = useMemo(() => areas.some((a) => areaActive(a.key)), [areas, areaActive]);

  const displayNodes = useMemo(() => {
    if (!focus || areaFilterActive) return nodes.map((n) => ({ ...n, dx: n.x, dy: n.y, dr: n.r }));
    return nodes.map((n) => {
      const f = fisheyeDistort(n.x, n.y, focus.x, focus.y, FISHEYE_RADIUS, FISHEYE_DISTORTION);
      return { ...n, dx: f.x, dy: f.y, dr: n.r * Math.min(f.z, 3) };
    });
  }, [nodes, focus, areaFilterActive]);

  const orderedNodes = useMemo(() => {
    if (!hover) return displayNodes;
    const rest = displayNodes.filter((n) => n.key !== hover.key);
    const top = displayNodes.find((n) => n.key === hover.key);
    return top ? [...rest, top] : displayNodes;
  }, [displayNodes, hover]);

  const ranked = useMemo(() => sortOtherLast(areas, (a, b) => b.risk - a.risk), [areas]);

  const { data: surfaceAggRaw } = useAgg("Road_surface_type", { minCount: 5, ignoreFields: ["Road_surface_type"] });
  const surfaceAgg = useMemo(() => foldAgg(surfaceAggRaw, mergeOtherUnknown), [surfaceAggRaw]);
  const surfaceMembers = useMemo(() => memberMap(surfaceAggRaw, mergeOtherUnknown), [surfaceAggRaw]);
  const surfaces = useMemo(() =>
    [...surfaceAgg].sort((a, b) => b.risk - a.risk).slice(0, 6).map((o) => {
      const f = +(o.fatalRate * 100).toFixed(2), s = +(o.seriousRate * 100).toFixed(2);
      return { key: o.key, band: [Math.min(f, s), Math.max(f, s)], fatal: f, serious: s, risk: o.risk };
    }), [surfaceAgg]);

  const { data: lanesAggRaw } = useAgg("Lanes_or_Medians", { minCount: 5, ignoreFields: ["Lanes_or_Medians"] });
  const laneMembers = useMemo(() => memberMap(lanesAggRaw, mergeOtherUnknown), [lanesAggRaw]);
  const lanes = useMemo(() =>
    sortOtherLast(foldAgg(lanesAggRaw, mergeOtherUnknown), (a, b) => b.total - a.total).slice(0, 6), [lanesAggRaw]);

  const sharedMaxRisk = Math.max(0.01, maxRisk, ...surfaces.map((d) => d.risk), ...lanes.map((d) => d.risk));
  const color = sequential(sharedMaxRisk);

  const laneRose = useMemo(() => {
    const n = lanes.length;
    if (!n) return [];
    const maxR = ROSE / 2 - 10;
    const maxVal = Math.max(1, ...lanes.map((l) => l.total));
    const step = (2 * Math.PI) / n;
    const a = arc();
    return lanes.map((l, i) => {
      const outerRadius = Math.max(7, Math.sqrt(l.total / maxVal) * maxR);
      const mid = i * step + step / 2, lr = outerRadius + 12;
      return {
        ...l, outerRadius,
        d: a({ innerRadius: 0, outerRadius, startAngle: i * step + 0.03, endAngle: (i + 1) * step - 0.03 }),
        lx: Math.sin(mid) * lr, ly: -Math.cos(mid) * lr,
      };
    });
  }, [lanes]);

  const { data: vehicleAgg } = useAgg("Type_of_vehicle", { minCount: 5, ignoreFields: ["Type_of_vehicle"] });
  const vehicleMembers = useMemo(() => memberMap(vehicleAgg, vehicleClass), [vehicleAgg]);
  const vehicles = useMemo(() =>
    sortOtherLast(foldAgg(vehicleAgg, vehicleClass), (a, b) => b.total - a.total), [vehicleAgg]);
  const vehicleActive = (key) => isAnyActive("Type_of_vehicle", vehicleMembers[key] || [key]);
  const vehicleClick = (key) => toggleFilterValues("Type_of_vehicle", vehicleMembers[key] || [key]);

  return (
    <div className="view grid-rows-[1fr]">
      <div className="grid grid-cols-[1.5fr_1fr_1fr] grid-rows-[1fr_1fr] min-h-0">
        <div className="card col-start-1 row-start-1 row-span-2">
          <div className="card-head">
            <span className="card-title">Crash-Density Map by Area</span>
          </div>
          <div className="fill relative">
            <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" preserveAspectRatio="xMidYMid meet"
                 className="block"
                 onMouseMove={handleFisheyeMove}
                 onMouseLeave={() => setFocus(null)}>
              <defs>
                <radialGradient id="bg" cx="50%" cy="45%" r="70%">
                  <stop offset="0%" stopColor="#13202C" />
                  <stop offset="100%" stopColor="#0C1219" />
                </radialGradient>
              </defs>
              <rect x="0" y="0" width={W} height={H} rx="10" fill="url(#bg)" />
              {focus && !areaFilterActive && (
                <circle cx={focus.x} cy={focus.y} r={FISHEYE_RADIUS} fill="none"
                        stroke="#3A4A5C" strokeWidth={1} strokeDasharray="3 4" opacity={0.4} pointerEvents="none" />
              )}
              {orderedNodes.map((n) => {
                const sel = areaActive(n.key);
                const isHovered = hover && hover.key === n.key;
                const dimmed = areaFilterActive ? !sel : hover && !isHovered;
                const r = n.dr;
                return (
                  <g key={n.key} transform={`translate(${n.dx},${n.dy})`}
                     className="cursor-pointer"
                     style={{ transition: focus ? "none" : "transform 260ms ease-out" }}
                     onClick={() => areaClick(n.key)}
                     onMouseEnter={() => setHover(n)} onMouseLeave={() => setHover(null)}>
                    <circle r={r} fill={color(n.risk)}
                            stroke={sel ? "#E69F00" : "#0A0E14"} strokeWidth={sel ? 3 : 1.5}
                            opacity={dimmed ? (areaFilterActive ? 0.28 : 0.2) : (isHovered ? 1 : 0.94)}
                            style={{ transition: "r 200ms ease-out, opacity 200ms ease-out" }} />
                    {(() => {
                      const textFill = textColorFor(color(n.risk));
                      if (isHovered) {
                        const label = n.key;
                        const countStr = n.total.toLocaleString();
                        const usableWidth = r * 2 * 0.82;
                        const minFont = 7;
                        const widthSize = (chars) => usableWidth / (chars * 0.56);
                        let nameLines = [label];
                        let nameSize = Math.min(28, r * 0.3, widthSize(label.length));
                        if (nameSize < minFont + 4 && label.includes(" ")) {
                          const words = label.split(" ");
                          let best = null;
                          for (let i = 1; i < words.length; i++) {
                            const l1 = words.slice(0, i).join(" "), l2 = words.slice(i).join(" ");
                            const longest = Math.max(l1.length, l2.length);
                            if (!best || longest < best.longest) best = { l1, l2, longest };
                          }
                          const wrappedSize = Math.min(24, r * 0.26, widthSize(best.longest));
                          if (wrappedSize > nameSize) { nameLines = [best.l1, best.l2]; nameSize = wrappedSize; }
                        }
                        if (nameSize < minFont) {
                          nameSize = minFont;
                          const maxChars = Math.max(3, Math.floor(usableWidth / (minFont * 0.56)));
                          nameLines = nameLines.map((l) => (l.length > maxChars ? l.slice(0, maxChars - 1) + "…" : l));
                        }
                        const countSize = Math.max(6, Math.min(22, r * 0.24, widthSize(countStr.length)));
                        const nameLineH = nameSize * 1.15;
                        const totalH = nameLines.length * nameLineH + countSize * 1.15;
                        let cy = -totalH / 2;
                        const nameYs = nameLines.map(() => { cy += nameLineH; return cy - nameLineH * 0.28; });
                        cy += countSize * 1.15;
                        const countY = cy - countSize * 0.28;
                        return (
                          <>
                            {nameLines.map((line, i) => (
                              <text key={i} textAnchor="middle" y={nameYs[i]} fontSize={nameSize} fontWeight="700"
                                    fontFamily="Inter, sans-serif" fill={textFill} pointerEvents="none">
                                {line}
                              </text>
                            ))}
                            <text textAnchor="middle" y={countY} fontSize={countSize} fontWeight="700" fontFamily="JetBrains Mono"
                                  fill={textFill} pointerEvents="none">
                              {countStr}
                            </text>
                          </>
                        );
                      }
                      if (n.dr > 26) {
                        const nameSize = Math.min(28, n.dr * 0.28);
                        const countSize = Math.min(22, n.dr * 0.22);
                        const maxChars = Math.max(3, Math.floor((n.dr * 1.6) / (nameSize * 0.58)));
                        const label = n.key.length > maxChars ? n.key.slice(0, maxChars - 1) + "…" : n.key;
                        return (
                          <>
                            <text textAnchor="middle" dy={-nameSize * 0.3} fontSize={nameSize} fontWeight="500"
                                  fontFamily="Inter, sans-serif" fill={textFill} pointerEvents="none">
                              {label}
                            </text>
                            <text textAnchor="middle" dy={countSize * 1.05} fontSize={countSize} fontWeight="400" fontFamily="JetBrains Mono"
                                  fill={textFill} pointerEvents="none">
                              {n.total.toLocaleString()}
                            </text>
                          </>
                        );
                      }
                      if (n.dr > 14) {
                        const countSize = Math.min(18, n.dr * 0.26);
                        return (
                          <text textAnchor="middle" dy={countSize * 0.34} fontSize={countSize} fontWeight="400" fontFamily="JetBrains Mono"
                                fill={textFill} pointerEvents="none">
                            {n.total.toLocaleString()}
                          </text>
                        );
                      }
                      return null;
                    })()}
                  </g>
                );
              })}
            </svg>
            {hover && (
              <div className="absolute top-2.5 right-2.5 max-w-57.5 rounded-lg px-3.25 py-2.75 text-[13px] pointer-events-none bg-[#0A0E14] border border-[#2C3A4A]">
                <div className="font-bold mb-1.25">{hover.key}</div>
                <div className="text-[#8B98A8]">{hover.total.toLocaleString()} accidents</div>
                <div className="text-[#8B98A8]">Fatal: {(hover.fatalRate * 100).toFixed(1)}% · Serious: {(hover.seriousRate * 100).toFixed(1)}%</div>
                <div className="text-[#E69F00] font-[JetBrains_Mono] mt-0.5">risk {hover.risk.toFixed(3)}</div>
              </div>
            )}
          </div>
          <SequentialLegend max={sharedMaxRisk} sequential={sequential} />
        </div>

        <div className="card col-start-2 row-start-1">
          <div className="card-head">
            <span className="card-title capitalize">Area risk ranking</span>
          </div>
          <div className="fill overflow-y-auto">
          <table className="tbl">
            <thead className="sticky top-0 bg-[#0A0E14]"><tr><th>Area</th><th className="num">N</th><th className="num">Fatal%</th><th className="num">Risk</th></tr></thead>
            <tbody>
              {ranked.map((a) => (
                <tr key={a.key} className={"clickable" + (areaActive(a.key) ? " sel" : "")}
                    onClick={() => areaClick(a.key)}>
                  <td>{a.key}</td>
                  <td className="num">{a.total.toLocaleString()}</td>
                  <td className="num">{(a.fatalRate * 100).toFixed(1)}</td>
                  <td className="num font-semibold" style={{ color: color(a.risk) }}>{a.risk.toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>

        <div className="card col-start-3 row-start-1">
          <div className="card-head">
            <span className="card-title capitalize">{dataset === "india" ? "By road surface" : "By road class"}</span>
          </div>
          <div className="fill">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={surfaces} layout="vertical" margin={{ left: 6, right: 34, top: 4, bottom: 4 }} barCategoryGap="34%">
                <XAxis type="number" domain={[0, "dataMax"]} tickFormatter={(v) => `${v}%`} {...axisProps} />
                <YAxis type="category" dataKey="key" width={110} {...axisProps} tick={{ fontSize: 10, fill: "#B8C2CD" }} />
                <Tooltip {...tipProps} cursor={{ fill: "#141C26" }}
                         formatter={(v, n, p) => [`fatal ${p.payload.fatal}% → serious ${p.payload.serious}%`, p.payload.key]} />
                <Bar dataKey="band" radius={4} minPointSize={2}
                     onClick={(d) => toggleFilterValues("Road_surface_type", surfaceMembers[d.key] || [d.key])} cursor="pointer">
                  {surfaces.map((d) => (
                    <Cell key={d.key} fill={color(d.risk)}
                          stroke={isAnyActive("Road_surface_type", surfaceMembers[d.key] || [d.key]) ? "#E69F00" : "none"}
                          strokeWidth={isAnyActive("Road_surface_type", surfaceMembers[d.key] || [d.key]) ? 2 : 0} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <SequentialLegend max={sharedMaxRisk} sequential={sequential} />
        </div>

        <div className="card col-start-2 row-start-2">
          <div className="card-head">
            <span className="card-title capitalize">By lanes / medians</span>
          </div>
          <div className="fill relative flex items-center justify-center">
            <svg viewBox={`0 0 ${ROSE} ${ROSE}`} width="100%" height="100%" preserveAspectRatio="xMidYMid meet" className="block">
              <g transform={`translate(${ROSE / 2},${ROSE / 2})`}>
                {laneRose.map((w) => {
                  const sel = isAnyActive("Lanes_or_Medians", laneMembers[w.key] || [w.key]);
                  const dim = laneHover && laneHover.key !== w.key;
                  return (
                    <path key={w.key} d={w.d} className="cursor-pointer"
                          fill={color(w.risk)} stroke={sel ? "#E69F00" : "#0A0E14"} strokeWidth={sel ? 2.5 : 1}
                          opacity={dim ? 0.5 : 0.95}
                          onClick={() => toggleFilterValues("Lanes_or_Medians", laneMembers[w.key] || [w.key])}
                          onMouseEnter={() => setLaneHover(w)} onMouseLeave={() => setLaneHover(null)} />
                  );
                })}
              </g>
            </svg>
            {laneHover && (
              <div className="absolute top-2 right-2 max-w-52 rounded-lg px-3 py-2 text-[12px] pointer-events-none bg-[#0A0E14] border border-[#2C3A4A]">
                <div className="font-bold mb-1">{laneHover.key}</div>
                <div className="text-[#8B98A8]">{laneHover.total.toLocaleString()} accidents</div>
                <div className="text-[#8B98A8]">Fatal {(laneHover.fatalRate * 100).toFixed(1)}%</div>
                <div className="text-[#E69F00] font-[JetBrains_Mono] mt-0.5">risk {laneHover.risk.toFixed(3)}</div>
              </div>
            )}
          </div>
          <SequentialLegend max={sharedMaxRisk} sequential={sequential} />
        </div>

        <div className="card col-start-3 row-start-2">
          <div className="card-head">
            <span className="card-title capitalize">By vehicle type</span>
          </div>
          <div className="fill">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={vehicles} dataKey="total" nameKey="key" outerRadius="82%" innerRadius="42%" paddingAngle={2}
                     stroke="#0A0E14" strokeWidth={2}
                     onClick={(d) => vehicleClick(d.key)} cursor="pointer">
                  {vehicles.map((d) => (
                    <Cell key={d.key} fill={VEHICLE_PASTELS[d.key] || "#C9CED6"}
                          stroke={vehicleActive(d.key) ? "#E69F00" : "#0A0E14"} strokeWidth={vehicleActive(d.key) ? 3 : 2} />
                  ))}
                </Pie>
                <Legend iconSize={8} wrapperStyle={{ fontSize: 10 }} />
                <Tooltip {...tipProps} formatter={(v, n, p) => [`${v.toLocaleString()} (risk ${p.payload.risk.toFixed(2)})`, p.payload.key]} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}

function SequentialLegend({ max, sequential }) {
  const scale = sequential(max);
  const stops = Array.from({ length: 24 }, (_, i) => (i / 23) * max);
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
