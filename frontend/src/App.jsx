import React, { useMemo, useState, useEffect, useRef } from "react";
import { useStore } from "./data/store.jsx";
import { useAgg, fetchAgg } from "./data/api.js";
import PaletteSwitcher from "./components/PaletteSwitcher.jsx";
import Overview from "./components/Overview.jsx";
import Geospatial from "./components/Geospatial.jsx";
import Temporal from "./components/Temporal.jsx";
import Insights from "./components/Insights.jsx";
import Causes from "./components/Causes.jsx";
import Patterns from "./components/Patterns.jsx";
import Predictor from "./components/Predictor.jsx";

const VIEWS = [
  { id: "overview", label: "Overview", el: Overview, crumb: "Severity at a glance" },
  { id: "geo", label: "Geospatial", el: Geospatial, crumb: "Where accidents concentrate" },
  { id: "temporal", label: "Temporal", el: Temporal, crumb: "When risk peaks" },
  { id: "causes", label: "Causes", el: Causes, crumb: "Why accidents turn severe" },
  { id: "patterns", label: "Patterns", el: Patterns, crumb: "What relates to what" },
  { id: "insights", label: "EDA", title: "EDA (Exploratory Data Analysis)", el: Insights, crumb: "Who & under what conditions" },
  { id: "predict", label: "Predictor", el: Predictor, crumb: "Forecast severity" },
];

const QUICK_FILTERS = [
  { field: "Day_of_week", label: "Day", order: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"], short: (v) => v.slice(0, 3) },
  { field: "Time_of_day", label: "Time", order: ["Night (0-5)", "Morning (6-11)", "Afternoon (12-16)", "Evening (17-20)"], short: (v) => v.split(" ")[0] },
  { field: "Weather_conditions", label: "Weather", top: 3, short: (v) => (v.length > 12 ? v.slice(0, 11) + "…" : v) },
];
const QUICK_FIELDS = QUICK_FILTERS.map((q) => q.field);
const PROMOTE_ORDER = ["Day_of_week", "Weather_conditions"];

function StateSelect() {
  const { dataset, filters, setFieldValues } = useStore();
  const { data } = useAgg("State", { ignoreFields: ["State"], minCount: 1 });
  const options = useMemo(
    () => data.map((d) => d.key).filter((k) => k && !/^unknown/i.test(k)).sort(),
    [data]);
  const selected = filters.State || [];
  const current = selected.length === 1 ? selected[0] : "";
  const allLabel = selected.length > 1
    ? `${selected.length} selected`
    : dataset === "india" ? "All states" : "All police forces";
  return (
    <select value={current}
            onChange={(e) => setFieldValues("State", e.target.value ? [e.target.value] : [])}
            className="rounded-md border border-[#1F2935] bg-[#0F151D] px-2.5 py-1 text-xs font-semibold text-[#8B98A8] outline-none">
      <option value="">{allLabel}</option>
      {options.map((s) => <option key={s} value={s}>{s}</option>)}
    </select>
  );
}

export default function App() {
  const store = useStore();
  const [view, setView] = useState("overview");
  const [promoteCount, setPromoteCount] = useState(0);
  const groupNodesRef = useRef({});

  if (store.error)
    return <div className="loading">Failed to load data: {store.error}<br/>Make sure the backend is running (uvicorn main:app --port 8000 in backend/) and the pipeline has been run.</div>;
  if (!store.ready) return <div className="loading">Loading accident records…</div>;

  const active = VIEWS.find((v) => v.id === view);
  const ViewEl = active.el;
  const { activeChips, clearField, clearAll, dataset, setDataset, filters, toggleFilter, setFieldValues } = store;

  const promoted = PROMOTE_ORDER.slice(0, promoteCount);
  const topbarQuick = QUICK_FILTERS.filter((q) => promoted.includes(q.field));
  const rowQuick = QUICK_FILTERS.filter((q) => !promoted.includes(q.field));

  const switchDataset = async (next) => {
    if (next === dataset) return;
    const activeFields = Object.keys(filters);
    if (activeFields.length === 0) { setDataset(next, {}); return; }
    try {
      const checks = await Promise.all(activeFields.map((f) =>
        fetchAgg(next, f, {}).then((rows) => [f, new Set(rows.map((r) => r.key))]).catch(() => [f, new Set()])
      ));
      const validValues = Object.fromEntries(checks);
      const kept = {};
      for (const f of activeFields) {
        const survivors = filters[f].filter((v) => validValues[f].has(v));
        if (survivors.length) kept[f] = survivors;
      }
      setDataset(next, kept);
    } catch {
      setDataset(next, {});
    }
  };

  return (
    <div className="app capitalize">
      <aside className="sidebar group fixed inset-y-0 left-0 z-50 w-14 overflow-hidden transition-[width] duration-200 ease-in-out hover:w-57.5 hover:shadow-[8px_0_24px_rgba(0,0,0,0.45)]">
        <div className="brand">
          <div className="brand-mar rounded-sm text-[9px] bg-amber-500 p-1">RAA</div>
          <div className="min-w-0 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
            <div className="brand-name whitespace-nowrap">Road Accident<br/>Analysis</div>
          </div>
        </div>

        {VIEWS.map((v) => (
          <div key={v.id} className={"nav-item" + (v.id === view ? " active" : "")} onClick={() => setView(v.id)}>
            <span className="nav-dot" />
            <span className="whitespace-nowrap opacity-0 transition-opacity duration-150 group-hover:opacity-100">{v.label}</span>
          </div>
        ))}

        <div className="opacity-0 transition-opacity duration-150 group-hover:opacity-100">
          <PaletteSwitcher />
        </div>
      </aside>

      <main className="main ml-14 max-[760px]:ml-0">
        <div className="topbar" style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr" }}>
          <div className="flex items-baseline">
            <h1>{active.title || active.label}</h1>
          </div>

          <div className="flex items-center justify-center gap-3.5">
            {topbarQuick.map((q, qi) => (
              <React.Fragment key={q.field}>
                {qi > 0 && <span className="h-4 w-px shrink-0 bg-[#1F2935]" />}
                <span ref={(el) => { if (el) groupNodesRef.current[q.field] = el; }} className="flex shrink-0 self-center">
                  <QuickFilterGroup quick={q} filters={filters} toggleFilter={toggleFilter}
                                     setFieldValues={setFieldValues} clearField={clearField} />
                </span>
              </React.Fragment>
            ))}
          </div>

          <div className="flex items-center justify-end gap-3.5">
            {activeChips.length > 0 && (
              <button type="button" onClick={clearAll}
                      className="shrink-0 rounded-md border border-[#D55E00] px-2.5 py-1 text-xs font-semibold text-[#D55E00] transition-colors hover:bg-[#D55E00] hover:text-[#0A0E14]">
                Clear all
              </button>
            )}
            <StateSelect />
            <span className="flex gap-1 rounded-md border border-[#1F2935] bg-[#0F151D] p-0.5">
              {[["india", "India"], ["uk", "UK"]].map(([id, label]) => (
                <button key={id} type="button" onClick={() => switchDataset(id)}
                        className="rounded-sm px-3 py-1 text-xs font-semibold tracking-[0.02em] transition-colors"
                        style={{ background: dataset === id ? "#E69F00" : "transparent", color: dataset === id ? "#0A0E14" : "#8B98A8" }}>
                  {label}
                </button>
              ))}
            </span>
          </div>
        </div>

        <FilterBar filters={filters} toggleFilter={toggleFilter} setFieldValues={setFieldValues}
                   activeChips={activeChips} clearField={clearField}
                   rowQuick={rowQuick} promoteCount={promoteCount} setPromoteCount={setPromoteCount}
                   groupNodesRef={groupNodesRef} />

        <div className="content">
          <ViewEl />
        </div>
      </main>
    </div>
  );
}

function FilterBar({ filters, toggleFilter, setFieldValues, activeChips, clearField, rowQuick, promoteCount, setPromoteCount, groupNodesRef }) {
  const hasOtherChips = activeChips.some((c) => c.field !== "State" && !QUICK_FIELDS.includes(c.field));
  const chips = hasOtherChips
    ? activeChips
    : activeChips.filter((c) => c.field !== "State" && !QUICK_FIELDS.includes(c.field));

  const viewportRef = useRef(null);
  const contentRef = useRef(null);
  const groupWidthsRef = useRef({});
  useEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return;
    const PROMOTE_MARGIN = 16;
    const DEMOTE_MARGIN = 64;
    const check = () => {
      for (const f of PROMOTE_ORDER) {
        const node = groupNodesRef.current[f];
        if (node && node.isConnected && node.offsetWidth)
          groupWidthsRef.current[f] = Math.max(groupWidthsRef.current[f] || 0, node.offsetWidth);
      }
      const slack = viewport.clientWidth - content.offsetWidth;
      if (slack < PROMOTE_MARGIN && promoteCount < PROMOTE_ORDER.length) {
        setPromoteCount((c) => Math.min(PROMOTE_ORDER.length, c + 1));
      } else if (promoteCount > 0) {
        const width = groupWidthsRef.current[PROMOTE_ORDER[promoteCount - 1]];
        if (width && slack > width + DEMOTE_MARGIN) {
          setPromoteCount((c) => Math.max(0, c - 1));
        }
      }
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(viewport);
    ro.observe(content);
    window.addEventListener("resize", check);
    return () => { ro.disconnect(); window.removeEventListener("resize", check); };
  }, [activeChips, promoteCount, setPromoteCount, groupNodesRef]);

  return (
    <div className="flex min-h-11 shrink-0 items-center gap-3.5 border-b border-[#1F2935] bg-[#0B1017] px-6.5 py-2">
      {rowQuick.map((q, qi) => (
        <React.Fragment key={q.field}>
          {qi > 0 && <span className="h-4 w-px shrink-0 bg-[#1F2935]" />}
          <span ref={(el) => { if (el) groupNodesRef.current[q.field] = el; }} className="flex shrink-0">
            <QuickFilterGroup quick={q} filters={filters} toggleFilter={toggleFilter} setFieldValues={setFieldValues} clearField={clearField} />
          </span>
        </React.Fragment>
      ))}

      {chips.length > 0 && rowQuick.length > 0 && <span className="h-4 w-px shrink-0 bg-[#1F2935]" />}

      <div ref={viewportRef} className="flex min-h-0 flex-1 items-center overflow-x-auto overflow-y-hidden">
        <div ref={contentRef} className="flex items-center gap-2">
          {chips.map((c, i) => (
            <span key={i} className="inline-flex shrink-0 items-center gap-1.75 rounded-full border border-[#2C3A4A] bg-[#16202C] px-2.5 py-1.25 text-xs text-[#E6EDF3]">
              <span className="text-[#5A6675]">{c.field.replace(/_/g, " ")}:</span> {c.field === "Day_of_week" ? c.value.slice(0, 3) : c.value}
              <span className="cursor-pointer font-bold text-[#5A6675] hover:text-[#E69F00]" onClick={() => clearField(c.field)}>✕</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

const QUICK_ACTIVE = "border-[#3B82F6] bg-[#3B82F6] text-[#0A0E14]";
const QUICK_IDLE = "border-[#1F2935] bg-[#0F151D] text-[#8B98A8] hover:border-[#2C3A4A] hover:text-[#E6EDF3]";

function QuickFilterGroup({ quick, filters, toggleFilter, setFieldValues, clearField }) {
  const { data: agg } = useAgg(quick.field, { global: true });
  const options = useMemo(() => {
    if (quick.order) {
      const present = new Set(agg.map((d) => d.key));
      return quick.order.filter((v) => present.has(v));
    }
    return [...agg].sort((a, b) => b.total - a.total).slice(0, quick.top).map((d) => d.key);
  }, [agg, quick.order, quick.top]);
  const active = filters[quick.field] || [];
  const isFull = active.length === 0;

  const pick = (e, v) => {
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      toggleFilter(quick.field, v);
    } else {
      const isOnly = active.length === 1 && active[0] === v;
      setFieldValues(quick.field, isOnly ? [] : [v]);
    }
  };

  return (
    <div className="flex shrink-0 items-center gap-1">
      <button type="button" onClick={() => clearField(quick.field)} title={`All ${quick.label.toLowerCase()}`}
              className={`rounded-md border px-2 py-1 text-[10.5px] font-semibold uppercase tracking-wider transition-colors ${
                isFull ? QUICK_ACTIVE : QUICK_IDLE
              }`}>
        {quick.label}
      </button>
      {options.map((v) => {
        const isActive = active.includes(v);
        return (
          <button key={v} type="button" onClick={(e) => pick(e, v)}
                  title={`Click: only ${v} · Shift-click: add/remove`}
                  className={`rounded-md border px-2 py-1 text-[11px] font-semibold transition-colors ${
                    isActive ? QUICK_ACTIVE : QUICK_IDLE
                  }`}>
            {quick.short(v)}
          </button>
        );
      })}
    </div>
  );
}
