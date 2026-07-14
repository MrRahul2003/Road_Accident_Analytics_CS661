import { useEffect, useRef, useState } from "react";
import { useStore } from "./store.jsx";

// Vercel supplies VITE_API_BASE at build time. Removing a trailing slash keeps
// requests in the form https://backend.example.com/api/... instead of //api/....
export const API_BASE = (
  import.meta.env.VITE_API_BASE || "http://localhost:8000"
).replace(/\/$/, "");

function qs(params) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    p.set(k, v);
  }
  return p.toString();
}

function filterParams(filters, hourRange) {
  const out = {};
  if (filters && Object.keys(filters).length) out.filters = JSON.stringify(filters);
  if (hourRange) { out.hour_min = hourRange[0]; out.hour_max = hourRange[1]; }
  return out;
}

async function getJSON(path, params) {
  const res = await fetch(`${API_BASE}${path}?${qs(params)}`);
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}

async function postJSON(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}

export const fetchPredict = (dataset, features) =>
  postJSON("/api/predict", { dataset, features });

export const fetchAgg = (dataset, by, { filters, hourRange, minCount = 0, limit } = {}) =>
  getJSON("/api/agg", { dataset, by, min_count: minCount, limit, ...filterParams(filters, hourRange) });

export const fetchKpis = (dataset, { filters, hourRange } = {}) =>
  getJSON("/api/kpis", { dataset, ...filterParams(filters, hourRange) });

export const fetchMatrix = (dataset, x, y, { filters, hourRange } = {}) =>
  getJSON("/api/matrix", { dataset, x, y, ...filterParams(filters, hourRange) });

export const fetchAssociation = (dataset, fields, { filters, hourRange } = {}) =>
  getJSON("/api/association", { dataset, fields: fields.join(","), ...filterParams(filters, hourRange) });

export const fetchConditions = (dataset, { filters, hourRange } = {}) =>
  getJSON("/api/conditions", { dataset, ...filterParams(filters, hourRange) });

const queryCache = new Map();
const QUERY_CACHE_MAX = 500;
function cachePut(key, data) {
  if (queryCache.size >= QUERY_CACHE_MAX) queryCache.delete(queryCache.keys().next().value);
  queryCache.set(key, data);
}

function useLiveFetch(kind, fetcher, deps, initial) {
  const key = kind + "|" + JSON.stringify(deps);
  const [state, setState] = useState(() =>
    queryCache.has(key)
      ? { data: queryCache.get(key), loading: false, error: null }
      : { data: initial, loading: true, error: null });
  const seq = useRef(0);
  useEffect(() => {
    const mySeq = ++seq.current;
    if (queryCache.has(key)) {
      const data = queryCache.get(key);
      setState((s) => (s.data === data && !s.loading ? s : { data, loading: false, error: null }));
      return;
    }
    setState((s) => ({ ...s, loading: true }));
    fetcher()
      .then((data) => { cachePut(key, data); if (mySeq === seq.current) setState({ data, loading: false, error: null }); })
      .catch((error) => { if (mySeq === seq.current) setState({ data: initial, loading: false, error: String(error) }); });
  }, deps);
  return state;
}

export function useAgg(field, opts = {}) {
  const { dataset, filters, hourRange } = useStore();
  const { minCount = 0, limit, ignoreFields, ignoreHourRange = false, global = false } = opts;
  const effFilters = global
    ? {}
    : ignoreFields && ignoreFields.length
      ? Object.fromEntries(Object.entries(filters).filter(([k]) => !ignoreFields.includes(k)))
      : filters;
  const effHourRange = (global || ignoreHourRange) ? undefined : hourRange;
  return useLiveFetch("agg",
    () => fetchAgg(dataset, field, { filters: effFilters, hourRange: effHourRange, minCount, limit }),
    [dataset, field, JSON.stringify(effFilters), effHourRange && effHourRange[0], effHourRange && effHourRange[1], minCount, limit],
    []
  );
}

export function useKpis() {
  const { dataset, filters, hourRange } = useStore();
  return useLiveFetch("kpis",
    () => fetchKpis(dataset, { filters, hourRange }),
    [dataset, JSON.stringify(filters), hourRange && hourRange[0], hourRange && hourRange[1]],
    null
  );
}

export function useMatrix(x, y, opts = {}) {
  const { dataset, filters, hourRange } = useStore();
  const { ignoreFields, ignoreHourRange = false } = opts;
  const effFilters = ignoreFields && ignoreFields.length
    ? Object.fromEntries(Object.entries(filters).filter(([k]) => !ignoreFields.includes(k)))
    : filters;
  const effHourRange = ignoreHourRange ? undefined : hourRange;
  return useLiveFetch("matrix",
    () => fetchMatrix(dataset, x, y, { filters: effFilters, hourRange: effHourRange }),
    [dataset, x, y, JSON.stringify(effFilters), effHourRange && effHourRange[0], effHourRange && effHourRange[1]],
    []
  );
}

export function useAssociation(fields) {
  const { dataset, filters, hourRange } = useStore();
  const key = fields.join(",");
  return useLiveFetch("assoc",
    () => fetchAssociation(dataset, fields, { filters, hourRange }),
    [dataset, key, JSON.stringify(filters), hourRange && hourRange[0], hourRange && hourRange[1]],
    []
  );
}

export function useConditions() {
  const { dataset, filters, hourRange } = useStore();
  return useLiveFetch("cond",
    () => fetchConditions(dataset, { filters, hourRange }),
    [dataset, JSON.stringify(filters), hourRange && hourRange[0], hourRange && hourRange[1]],
    []
  );
}
