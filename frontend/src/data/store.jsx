import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from "react";
import { PALETTES, SEVERITY_ORDER, sequentialScale, divergingScale } from "../theme.js";

const Ctx = createContext(null);
export const useStore = () => useContext(Ctx);

export function StoreProvider({ children }) {
  const [models, setModels] = useState(null);
  const [error, setError] = useState(null);
  const [ready, setReady] = useState(false);

  const [paletteKey, setPaletteKey] = useState("standard");
  const [dataset, setDatasetRaw] = useState("india");
  const [filters, setFilters] = useState({});
  const [hourRange, setHourRange] = useState(null);

  const setDataset = useCallback((next, keptFilters = {}) => {
    setDatasetRaw((cur) => {
      if (cur === next) return cur;
      setFilters(keptFilters);
      return next;
    });
  }, []);

  useEffect(() => {
    Promise.all([
      fetch("app-data/model.json").then((r) => r.json()),
      fetch("app-data/model_uk.json").then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ])
      .then(([india, uk]) => { setModels({ india, uk }); setReady(true); })
      .catch((e) => setError(String(e)));
  }, []);

  const model = models ? (models[dataset] || models.india) : null;
  const modelDataset = models ? (models[dataset] ? dataset : "india") : null;

  const palette = PALETTES[paletteKey];
  const sevColor = useCallback((s) => palette.severity[s] || "#888", [palette]);
  const sequential = useCallback((domainMax) => sequentialScale(paletteKey, domainMax), [paletteKey]);
  const diverging = useCallback((domain) => divergingScale(paletteKey, domain), [paletteKey]);

  const toggleFilter = useCallback((field, value) => {
    setFilters((f) => {
      const cur = f[field] || [];
      const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
      const out = { ...f };
      if (next.length) out[field] = next; else delete out[field];
      return out;
    });
  }, []);

  const clearField = useCallback((field) => {
    if (field === "Hour") return setHourRange(null);
    setFilters((f) => { const o = { ...f }; delete o[field]; return o; });
  }, []);

  const setFieldValues = useCallback((field, values) => {
    setFilters((f) => {
      const out = { ...f };
      if (values && values.length) out[field] = values; else delete out[field];
      return out;
    });
  }, []);

  const clearAll = useCallback(() => { setFilters({}); setHourRange(null); }, []);

  const toggleFilterValues = useCallback((field, values) => {
    if (!values || !values.length) return;
    setFilters((f) => {
      const cur = f[field] || [];
      const allIn = values.every((v) => cur.includes(v));
      const out = { ...f };
      if (allIn) {
        const next = cur.filter((v) => !values.includes(v));
        if (next.length) out[field] = next; else delete out[field];
      } else {
        out[field] = Array.from(new Set([...cur, ...values]));
      }
      return out;
    });
  }, []);

  const isActive = useCallback((field, value) => (filters[field] || []).includes(value), [filters]);

  const isAnyActive = useCallback(
    (field, values) => (filters[field] || []).some((v) => values.includes(v)), [filters]);

  const activeChips = useMemo(() => {
    const chips = [];
    for (const [k, vals] of Object.entries(filters))
      for (const v of vals) chips.push({ field: k, value: v });
    if (hourRange) chips.push({ field: "Hour", value: `${hourRange[0]}:00–${hourRange[1]}:59` });
    return chips;
  }, [filters, hourRange]);

  const value = {
    model, modelDataset, error, ready,
    dataset, setDataset,
    palette, paletteKey, setPaletteKey, sevColor, sequential, diverging, SEVERITY_ORDER,
    filters, hourRange, setHourRange, toggleFilter, toggleFilterValues, clearField, clearAll, isActive, isAnyActive, setFieldValues,
    activeChips,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
