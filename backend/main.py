

import json
import math
from pathlib import Path
from typing import Optional

import duckdb
import joblib
import numpy as np
import pandas as pd
import xgboost as xgb
from fastapi import Body, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

ROOT = Path(__file__).resolve().parents[1]

DATASETS = {
    "uk": {
        "dir": ROOT / "data" / "runtime" / "uk",
        "tables": {"records": "records/*.parquet"},
        "default_table": "records",
    },
    "india": {
        "dir": ROOT / "data" / "runtime" / "india",
        "tables": {"records": "records/*.parquet"},
        "default_table": "records",
    },
}

SEVERITY_ORDER = ["Slight Injury", "Serious Injury", "Fatal injury"]

app = FastAPI(title="Road Safety Analytics API")
app.add_middleware(CORSMiddleware, allow_origins=["*"],
                   allow_methods=["*"], allow_headers=["*"])

con = duckdb.connect()
con.execute("PRAGMA threads=4")

COLS: dict[str, set] = {}

MODELS: dict[str, dict] = {}
MODEL_STATUS: dict[str, str] = {}  

def db():
    """A fresh cursor per request. FastAPI runs sync route handlers in a
    thread pool, and a single shared DuckDBPyConnection is NOT safe for
    concurrent queries from multiple threads (early testing hit corrupted
    fetchone() results under concurrent Overview/Insights chart loads).
    con.cursor() shares the same database handle but gives each request its
    own independent query state."""
    return con.cursor()

@app.on_event("startup")
def register_views():
    for ds, cfg in DATASETS.items():
        for tbl, glob in cfg["tables"].items():
            path = cfg["dir"] / glob
            view = f"{ds}_{tbl}"
            try:
                con.execute(f"""CREATE OR REPLACE VIEW {view} AS
                                SELECT * FROM read_parquet('{path}', hive_partitioning=true)""")
                COLS[view] = {r[0] for r in
                              con.execute(f"DESCRIBE {view}").fetchall()}
            except duckdb.Error as e:
                print(f"[startup] skipping {view}: {e}")
    load_models()

def load_models():
    """Load each dataset's severity pipeline (produced by
    train_severity_model.py). Missing artifacts are skipped — /api/predict
    then reports the model as unavailable rather than crashing startup."""
    for ds, cfg in DATASETS.items():
        path = cfg["dir"] / "model" / "pipeline.joblib"
        if not path.exists():
            MODEL_STATUS[ds] = f"missing file: {path}"
            print(f"[startup] no model file for '{ds}' at {path}")
            continue
        try:
            MODELS[ds] = joblib.load(path)
            MODEL_STATUS[ds] = "loaded"
            print(f"[startup] loaded severity model for '{ds}'")
        except Exception as e:
            MODEL_STATUS[ds] = f"error: {type(e).__name__}: {e}"
            print(f"[startup] failed to load model for '{ds}': {e}")

def resolve(dataset: str, table: Optional[str]):
    if dataset not in DATASETS:
        raise HTTPException(400, f"unknown dataset '{dataset}'")
    cfg = DATASETS[dataset]
    table = table or cfg["default_table"]
    if table not in cfg["tables"]:
        raise HTTPException(400, f"unknown table '{table}' for dataset '{dataset}'")
    view = f"{dataset}_{table}"
    if view not in COLS:
        raise HTTPException(503, f"data for {view} not available — run the pipeline")
    return view

def build_where(view, filters_json, year_min, year_max, hour_min, hour_max):
    """Validated WHERE clause + bound params from the standard filter set."""
    clauses, params = [], []
    if filters_json:
        try:
            filters = json.loads(filters_json)
            assert isinstance(filters, dict)
        except Exception:
            raise HTTPException(400, "filters must be a JSON object {field: [values]}")
        for field, values in filters.items():
            if field not in COLS[view]:
                raise HTTPException(400, f"unknown filter field '{field}'")
            if not isinstance(values, list) or not values:
                raise HTTPException(400, f"filter '{field}' needs a non-empty list")
            ph = ", ".join("?" for _ in values)
            clauses.append(f'CAST("{field}" AS VARCHAR) IN ({ph})')
            params.extend(str(v) for v in values)
    if "year" in COLS[view]:
        if year_min is not None:
            clauses.append("year >= ?"); params.append(year_min)
        if year_max is not None:
            clauses.append("year <= ?"); params.append(year_max)
    if "Hour" in COLS[view]:
        if hour_min is not None:
            clauses.append("Hour >= ?"); params.append(hour_min)
        if hour_max is not None:
            clauses.append("Hour <= ?"); params.append(hour_max)
    return (" WHERE " + " AND ".join(clauses) if clauses else ""), params

@app.get("/api/health")
def health():
    return {"ok": True, "views": sorted(COLS),
            "models_loaded": sorted(MODELS), "model_status": MODEL_STATUS}

@app.get("/api/meta")
def meta(dataset: str = Query("uk")):
    if dataset not in DATASETS:
        raise HTTPException(400, f"unknown dataset '{dataset}'")
    path = DATASETS[dataset]["dir"] / "meta.json"
    if not path.exists():
        raise HTTPException(503, f"meta for '{dataset}' missing — run the pipeline")
    return json.loads(path.read_text())

@app.get("/api/agg")
def agg(dataset: str = Query("uk"),
        table: Optional[str] = None,
        by: str = Query(..., description="group-by field"),
        filters: Optional[str] = Query(None, description='JSON {field: [values]}'),
        year_min: Optional[int] = None, year_max: Optional[int] = None,
        hour_min: Optional[int] = None, hour_max: Optional[int] = None,
        min_count: int = 0,
        limit: int = Query(200, le=2000)):
    """Severity breakdown grouped by `by` — mirrors frontend groupSeverity()."""
    view = resolve(dataset, table)
    if by not in COLS[view]:
        raise HTTPException(400, f"unknown field '{by}'")
    sev = "Accident_severity"
    if sev not in COLS[view]:
        raise HTTPException(400, f"table has no {sev}")
    where, params = build_where(view, filters, year_min, year_max, hour_min, hour_max)
    rows = db().execute(f"""
        SELECT CAST("{by}" AS VARCHAR) AS key,
               COUNT(*)::BIGINT AS total,
               COUNT(*) FILTER (WHERE {sev} = 'Slight Injury')::BIGINT  AS slight,
               COUNT(*) FILTER (WHERE {sev} = 'Serious Injury')::BIGINT AS serious,
               COUNT(*) FILTER (WHERE {sev} = 'Fatal injury')::BIGINT   AS fatal
        FROM {view}{where}
        GROUP BY 1 HAVING COUNT(*) >= {int(min_count)}
        ORDER BY total DESC LIMIT {int(limit)}
    """, params).fetchall()
    return [{
        "key": k, "total": t,
        "Slight Injury": sl, "Serious Injury": se, "Fatal injury": fa,
        "fatalRate": fa / t if t else 0,
        "seriousRate": se / t if t else 0,
        "risk": (se + 3 * fa) / t if t else 0,
    } for k, t, sl, se, fa in rows]

@app.get("/api/kpis")
def kpis(dataset: str = Query("uk"), table: Optional[str] = None,
         filters: Optional[str] = None,
         year_min: Optional[int] = None, year_max: Optional[int] = None,
         hour_min: Optional[int] = None, hour_max: Optional[int] = None):
    """Overview headline stats over the CURRENT filter selection (not the
    whole corpus) — mirrors what Overview.jsx used to derive from `filtered`."""
    view = resolve(dataset, table)
    sev = "Accident_severity"
    cur = db()
    where, params = build_where(view, filters, year_min, year_max, hour_min, hour_max)
    row = cur.execute(f"""
        SELECT COUNT(*)::BIGINT,
               100.0 * COUNT(*) FILTER (WHERE {sev} = 'Fatal injury') / NULLIF(COUNT(*), 0),
               100.0 * COUNT(*) FILTER (WHERE {sev} = 'Serious Injury') / NULLIF(COUNT(*), 0),
               AVG(Number_of_casualties),
               100.0 * COUNT(*) FILTER (WHERE Is_weekend) / NULLIF(COUNT(*), 0)
        FROM {view}{where}
    """, params).fetchone()
    total, fatal_pct, serious_pct, avg_cas, weekend_pct = row
    peak_hour = None
    if "Hour" in COLS[view] and total:
        r = cur.execute(f"""SELECT Hour FROM {view}{where}
                            GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 1""", params).fetchone()
        peak_hour = r[0] if r else None
    sev_counts = dict(cur.execute(
        f'SELECT "{sev}", COUNT(*) FROM {view}{where} GROUP BY 1', params).fetchall())
    return {
        "total": total or 0,
        "fatalPct": round(fatal_pct or 0, 2),
        "seriousPct": round(serious_pct or 0, 2),
        "avgCasualties": round(avg_cas or 0, 2),
        "weekendPct": round(weekend_pct or 0, 2),
        "peakHour": peak_hour,
        "severityCounts": {s: sev_counts.get(s, 0) for s in SEVERITY_ORDER},
    }

@app.get("/api/matrix")
def matrix(dataset: str = Query("uk"), table: Optional[str] = None,
           x: str = Query(...), y: str = Query(...),
           filters: Optional[str] = None,
           year_min: Optional[int] = None, year_max: Optional[int] = None,
           hour_min: Optional[int] = None, hour_max: Optional[int] = None):
    """2D group-by with severity breakdown — powers Temporal's day×hour heatmap."""
    view = resolve(dataset, table)
    if x not in COLS[view] or y not in COLS[view]:
        raise HTTPException(400, "unknown x/y field")
    sev = "Accident_severity"
    where, params = build_where(view, filters, year_min, year_max, hour_min, hour_max)
    rows = db().execute(f"""
        SELECT "{x}" AS x, "{y}" AS y,
               COUNT(*)::BIGINT AS total,
               COUNT(*) FILTER (WHERE {sev} = 'Fatal injury')::BIGINT   AS fatal,
               COUNT(*) FILTER (WHERE {sev} = 'Serious Injury')::BIGINT AS serious
        FROM {view}{where}
        GROUP BY 1, 2
    """, params).fetchall()
    return [{"x": x_, "y": y_, "total": t, "fatal": f, "serious": s}
            for x_, y_, t, f, s in rows]

def cramers_v_from_counts(counts, severity_order=SEVERITY_ORDER):
    """counts: {field_value: {severity: n}}. Same formula as the frontend's
    live Cramér's V (Patterns.jsx) — computed here from aggregated counts
    instead of raw rows (mathematically identical)."""
    table = list(counts.values())
    n = sum(sum(row.get(s, 0) for s in severity_order) for row in table)
    if n == 0 or len(table) < 2:
        return 0.0
    col_tot = [sum(row.get(s, 0) for row in table) for s in severity_order]
    chi2 = 0.0
    for row in table:
        rt = sum(row.get(s, 0) for s in severity_order)
        for ci, s in enumerate(severity_order):
            exp = rt * col_tot[ci] / n
            if exp > 0:
                d = row.get(s, 0) - exp
                chi2 += d * d / exp
    k = min(len(table), len(severity_order))
    denom = n * (k - 1)
    return min(1.0, math.sqrt(chi2 / denom)) if denom > 0 else 0.0

@app.get("/api/association")
def association(dataset: str = Query("uk"), table: Optional[str] = None,
                fields: str = Query(..., description="comma-separated field list"),
                filters: Optional[str] = None,
                year_min: Optional[int] = None, year_max: Optional[int] = None,
                hour_min: Optional[int] = None, hour_max: Optional[int] = None):
    """Cramér's V of each field vs severity — powers Patterns' association ranking."""
    view = resolve(dataset, table)
    sev = "Accident_severity"
    field_list = [f.strip() for f in fields.split(",") if f.strip()]
    for f in field_list:
        if f not in COLS[view]:
            raise HTTPException(400, f"unknown field '{f}'")
    where, params = build_where(view, filters, year_min, year_max, hour_min, hour_max)
    cur = db()
    out = []
    for f in field_list:
        rows = cur.execute(f"""
            SELECT CAST("{f}" AS VARCHAR), {sev}, COUNT(*)
            FROM {view}{where} GROUP BY 1, 2
        """, params).fetchall()
        counts = {}
        for val, s, c in rows:
            counts.setdefault(val, {})[s] = c
        out.append({"field": f, "v": round(cramers_v_from_counts(counts), 4)})
    out.sort(key=lambda d: d["v"], reverse=True)
    return out

CONDITIONS = {
    "india": [
        ("Darkness", "Light_conditions LIKE 'Darkness%'"),
        ("Rain / Fog", "Weather_conditions IN ('Raining', 'Raining and Windy', 'Fog or mist')"),
        ("Speed / DUI", "Cause_of_accident IN ('Driving at high speed', 'Driving under the influence of drugs')"),
        ("Night", "Time_of_day LIKE 'Night%'"),
        ("Weekend", "Is_weekend = true"),
        ("Multi-vehicle", "Number_of_vehicles_involved >= 3"),
    ],
    "uk": [
        ("Darkness", "Light_conditions LIKE 'Darkness%'"),
        ("Rain / Fog", "(Weather_conditions LIKE 'Raining%' OR Weather_conditions = 'Fog or mist')"),
        ("Rural road", "Area_accident_occured = 'Rural'"),
        ("Night", "Time_of_day LIKE 'Night%'"),
        ("Weekend", "Is_weekend = true"),
        ("Multi-vehicle", "Number_of_vehicles_involved >= 3"),
    ],
}

@app.get("/api/conditions")
def conditions(dataset: str = Query("uk"), table: Optional[str] = None,
              filters: Optional[str] = None,
              year_min: Optional[int] = None, year_max: Optional[int] = None,
              hour_min: Optional[int] = None, hour_max: Optional[int] = None):
    """Risk-fingerprint radar: % serious-or-fatal under each named condition
    vs the baseline, within the current filter selection."""
    view = resolve(dataset, table)
    if dataset not in CONDITIONS:
        raise HTTPException(400, f"no condition presets defined for '{dataset}'")
    sev = "Accident_severity"
    where, params = build_where(view, filters, year_min, year_max, hour_min, hour_max)
    base_where = where or " WHERE 1=1"
    exprs = ["COUNT(*)::BIGINT",
             f"COUNT(*) FILTER (WHERE {sev} != 'Slight Injury')::BIGINT"]
    for _, cond in CONDITIONS[dataset]:
        exprs.append(f"COUNT(*) FILTER (WHERE {cond})::BIGINT")
        exprs.append(f"COUNT(*) FILTER (WHERE {cond} AND {sev} != 'Slight Injury')::BIGINT")
    row = db().execute(f"SELECT {', '.join(exprs)} FROM {view}{base_where}", params).fetchone()
    base_n, base_severe = row[0], row[1]
    baseline = 100.0 * base_severe / base_n if base_n else 0.0
    out = []
    for i, (name, _) in enumerate(CONDITIONS[dataset]):
        n, severe = row[2 + i * 2], row[3 + i * 2]
        value = 100.0 * severe / n if n else 0.0
        out.append({"axis": name, "value": round(value, 1), "baseline": round(baseline, 1)})
    return out

def _field_of(transformed_name, cat_features, num_features):
    """Map a ColumnTransformer output name back to its original field, e.g.
    'cat__Cause_of_accident_Driving at high speed' -> 'Cause_of_accident'."""
    body = transformed_name.split("__", 1)[1] if "__" in transformed_name else transformed_name
    for field in cat_features:
        if body == field or body.startswith(field + "_"):
            return field
    for field in num_features:
        if body == field:
            return field
    return body

def _resolve_model(dataset):
    """Each dataset trains its own model; if one's artifact is missing the
    India model answers instead, matching the fallback note in the UI."""
    if dataset in MODELS:
        return MODELS[dataset]
    if "india" in MODELS:
        return MODELS["india"]
    raise HTTPException(503, "severity model unavailable — run train_severity_model.py")

@app.post("/api/predict")
def predict(payload: dict = Body(...)):
    """Predict accident-severity probabilities for a single scenario, with the
    per-field contributions behind the predicted class. Body:
        {"dataset": "india", "features": {<field>: <value>, ...}}"""
    dataset = payload.get("dataset", "india")
    features = payload.get("features") or {}
    if not isinstance(features, dict):
        raise HTTPException(400, "features must be an object {field: value}")

    bundle = _resolve_model(dataset)
    pipeline = bundle["pipeline"]
    classes = bundle["classes"]
    cat_features = bundle["cat_features"]
    num_features = bundle["num_features"]
    severity_order = bundle["severity_order"]

    row = {}
    for field in cat_features:
        row[field] = str(features.get(field, ""))
    for field in num_features:
        try:
            row[field] = float(features.get(field, 1) or 1)
        except (TypeError, ValueError):
            row[field] = 1.0
    frame = pd.DataFrame([row], columns=cat_features + num_features)

    with np.errstate(all="ignore"):
        proba = pipeline.predict_proba(frame)[0]
    pred_idx = int(proba.argmax())

    pre = pipeline.named_steps["pre"]
    clf = pipeline.named_steps["clf"]
    names = list(pre.get_feature_names_out())
    onehot = np.asarray(pre.transform(frame), dtype=float)
    booster = clf.get_booster()

    pca = pipeline.named_steps.get("pca")
    with np.errstate(all="ignore"):
        model_input = pca.transform(onehot) if pca is not None else onehot
    contribs = booster.predict(xgb.DMatrix(model_input), pred_contribs=True)

    if contribs.ndim == 3:
        input_contribs = contribs[0, pred_idx, :-1]
    else:
        input_contribs = contribs[0, :-1]

    if pca is not None:
        centered = onehot[0] - pca.mean_
        class_contribs = np.zeros(onehot.shape[1])
        for phi, loading in zip(input_contribs, pca.components_):
            share = loading * centered
            z = share.sum()
            if abs(z) > 1e-9:
                class_contribs += phi * share / z
    else:
        class_contribs = input_contribs

    per_field = {}
    for name, value in zip(names, class_contribs):
        field = _field_of(name, cat_features, num_features)
        per_field[field] = per_field.get(field, 0.0) + float(value)
    contributions = [
        {"feature": field, "value": round(val, 4)}
        for field, val in sorted(per_field.items(), key=lambda kv: abs(kv[1]), reverse=True)
        if abs(val) > 1e-6
    ][:6]

    prob_by_class = {cls: float(p) for cls, p in zip(classes, proba)}
    ordered = [
        {"cls": cls, "p": round(prob_by_class[cls], 6)}
        for cls in severity_order if cls in prob_by_class
    ]
    return {
        "classes": classes,
        "predicted": classes[pred_idx],
        "probabilities": ordered,
        "contributions": contributions,
    }
