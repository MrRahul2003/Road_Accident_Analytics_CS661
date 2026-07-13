"""
Shared severity-model training used by both datasets:

    scripts/data_pipeline/india/train_severity_model.py
    scripts/data_pipeline/uk/train_severity_model.py

The model is a scikit-learn Pipeline:

    ColumnTransformer(OneHotEncoder on categoricals, passthrough numerics)
        -> XGBClassifier(multi:softprob)

Artifacts per dataset:

  data/runtime/<ds>/model/pipeline.joblib   fitted pipeline + label order,
                                            loaded and served by the backend
                                            /api/predict endpoint.
  frontend/public/app-data/<model json>     UI-only metadata (form option
                                            levels, defaults, held-out
                                            metrics, feature importances).

Model shape — generalise, don't memorise:
  A deep tree ensemble on this data memorises exact feature combinations;
  held-out accuracy barely beats always predicting Slight, and any scenario
  composed in the UI form (which almost never matches a stored combination)
  falls back to near-base-rate probabilities — Fatal (~1% base rate) then
  reads as 0 for every input. Shallow trees are forced to learn marginal and
  low-order risk effects (darkness, collision type, casualty count, ...)
  instead, so probabilities respond smoothly to every form input at no real
  cost in honest held-out accuracy.

Class-weight tempering:
  Sample weights are multiplied by (inverse class frequency) ** TEMPER.
  TEMPER=0 keeps true calibration but leaves the rare Serious/Fatal classes
  visually pinned near zero; TEMPER=1 (fully balanced) recreates the old
  over-severe predictions on quiet scenarios. 0.5 keeps Slight dominant on
  quiet scenarios while letting Fatal move visibly with risk factors.

Honest evaluation:
  Rows are grouped to unique feature combinations, keeping one weighted row
  per (combination, observed label) pair — the full conditional label
  distribution, so rare outcomes are not erased by majority voting. The
  train/test split is done on combinations (never rows), so no combination
  leaks across the split and the reported metrics are real.

Data-leakage guard:
  Severity_rank is a 1:1 integer encoding of the target and is explicitly
  forbidden as a feature.
"""

import json
from pathlib import Path

import duckdb
import joblib
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]

SEVERITY_ORDER = [
    "Slight Injury",
    "Serious Injury",
    "Fatal injury",
]

TARGET = "Accident_severity"

LEAKING_COLUMNS = {"Severity_rank"}

FEATURE_CAT = [
    "Time_of_day",
    "Day_of_week",
    "Age_band_of_driver",
    "Sex_of_driver",
    "Driving_experience",
    "Area_accident_occured",
    "Light_conditions",
    "Weather_conditions",
    "Road_surface_conditions",
    "Type_of_collision",
    "Cause_of_accident",
]

FEATURE_NUM = [
    "Number_of_vehicles_involved",
    "Number_of_casualties",
]

FORM_ONLY_CAT = ["State"]

CLASS_WEIGHT_TEMPER = 0.5
SEED = 42

PCA_VARIANCE = 0.95

DATASETS = {
    "india": {
        "records": ROOT / "data" / "runtime" / "india" / "records",
        "model_dir": ROOT / "data" / "runtime" / "india" / "model",
        "model_json": ROOT / "frontend" / "public" / "app-data" / "model.json",
        # State is assigned by assign_states_exact() purely from MoRTH marginal
        # totals via a seeded shuffle, independent of every Road.csv field
        # (see build_runtime_dataset.py) — trained in at explicit request, but
        # any State-level split the model learns reflects that one random
        # assignment's sampling noise, not a real geographic relationship.
        "state_is_feature": True,
        "state_note": (
            "State is trained as a feature, but it is an independent MoRTH "
            "marginal enrichment assigned by a seeded shuffle with no real "
            "relationship to the Road.csv predictors — any State-level "
            "effect the model shows reflects sampling noise from that "
            "assignment, not an observed geographic risk difference."
        ),
    },
    "uk": {
        "records": ROOT / "data" / "runtime" / "uk" / "records",
        "model_dir": ROOT / "data" / "runtime" / "uk" / "model",
        "model_json": ROOT / "frontend" / "public" / "app-data" / "model_uk.json",
        # Unlike India's State, UK police force is an observed STATS19 field
        # (build_runtime_dataset.py reads it straight off the collision
        # table) and it carries real signal: fatal-injury rate ranges from
        # ~0.5% (City of London) to ~4.1% (Northern) against a ~1.6% overall
        # base rate, reflecting each force's real mix of road types and
        # rurality. It is trained as a genuine feature.
        "state_is_feature": True,
        "state_note": (
            "Police force is trained as a real feature: it is an observed "
            "STATS19 field whose fatal-injury rate varies several-fold "
            "across forces, reflecting each force's mix of road types and "
            "rurality."
        ),
    },
}

def build_pipeline(cat_features, num_features):
    from sklearn.compose import ColumnTransformer
    from sklearn.decomposition import PCA
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import OneHotEncoder
    from xgboost import XGBClassifier

    pre = ColumnTransformer(
        transformers=[
            (
                "cat",
                OneHotEncoder(handle_unknown="ignore", sparse_output=False),
                cat_features,
            ),
            ("num", "passthrough", num_features),
        ],
        remainder="drop",
        verbose_feature_names_out=True,
    )

    pca = PCA(n_components=PCA_VARIANCE, svd_solver="full", random_state=SEED)

    clf = XGBClassifier(
        objective="multi:softprob",
        n_estimators=150,
        max_depth=3,
        learning_rate=0.08,
        subsample=0.9,
        colsample_bytree=0.8,
        min_child_weight=30.0,
        reg_lambda=2.0,
        tree_method="hist",
        eval_metric="mlogloss",
        random_state=SEED,
        n_jobs=4,
    )

    return Pipeline([("pre", pre), ("pca", pca), ("clf", clf)])

def load_combinations(records_dir, cat_features, num_features):
    """
    One weighted row per (feature combination, observed label) pair, grouped
    in DuckDB so the multi-million-row corpora never sit in pandas whole.
    """
    cols = ", ".join(f'"{c}"' for c in cat_features + num_features)
    con = duckdb.connect()
    con.execute("PRAGMA threads=4")
    combos = con.execute(
        f"""SELECT {cols}, "{TARGET}" AS label, count(*) AS weight
            FROM read_parquet('{records_dir}/*.parquet')
            GROUP BY ALL"""
    ).fetchdf()
    con.close()

    for column in cat_features:
        combos[column] = combos[column].astype(str)
    for column in num_features:
        combos[column] = pd.to_numeric(
            combos[column], errors="coerce"
        ).fillna(0)
    combos["label"] = combos["label"].astype(str)
    return combos

def train_model(dataset, combos, cat_features, num_features, state_levels, form_only_cat):
    from sklearn.metrics import (
        accuracy_score,
        classification_report,
        f1_score,
    )
    from sklearn.model_selection import train_test_split

    leaks = LEAKING_COLUMNS & set(cat_features + num_features)
    if leaks:
        raise ValueError(
            f"Refusing to train: leaking target-derived columns present as "
            f"features: {sorted(leaks)}"
        )

    group_cols = cat_features + num_features

    present = [s for s in SEVERITY_ORDER if s in set(combos["label"])]
    if len(present) < 2:
        raise ValueError("Need at least two severity classes to train.")
    class_index = {name: i for i, name in enumerate(present)}

    combo_keys = combos[group_cols].drop_duplicates().reset_index(drop=True)
    combo_keys["__combo_id"] = np.arange(len(combo_keys))
    combos = combos.merge(combo_keys, on=group_cols, how="left")
    print(
        f"  Grouped corpus into {len(combo_keys):,} unique feature "
        f"combinations ({len(combos):,} weighted combination/label rows)"
    )

    dominant = (
        combos.sort_values("weight", ascending=False)
        .drop_duplicates(subset="__combo_id", keep="first")
        .set_index("__combo_id")["label"]
    )
    strat_labels = combo_keys["__combo_id"].map(dominant)
    stratify = strat_labels if strat_labels.value_counts().min() >= 2 else None

    train_ids, test_ids = train_test_split(
        combo_keys["__combo_id"],
        test_size=0.20,
        random_state=SEED,
        stratify=stratify,
    )
    train_mask = combos["__combo_id"].isin(set(train_ids))

    X_train = combos.loc[train_mask, group_cols]
    X_test = combos.loc[~train_mask, group_cols]
    y_train = combos.loc[train_mask, "label"].map(class_index).to_numpy()
    y_test = combos.loc[~train_mask, "label"].map(class_index).to_numpy()
    w_train = combos.loc[train_mask, "weight"].to_numpy(dtype=float)
    w_test = combos.loc[~train_mask, "weight"].to_numpy(dtype=float)

    class_weight = {
        i: (w_train.sum() / (len(present) * w_train[y_train == i].sum()))
        ** CLASS_WEIGHT_TEMPER
        for i in range(len(present))
    }
    fit_weight = w_train * np.array([class_weight[i] for i in y_train])

    pipeline = build_pipeline(cat_features, num_features)
    pipeline.fit(X_train, y_train, clf__sample_weight=fit_weight)

    pred = pipeline.predict(X_test)

    report = classification_report(
        y_test,
        pred,
        labels=list(range(len(present))),
        target_names=present,
        sample_weight=w_test,
        output_dict=True,
        zero_division=0,
    )

    metrics = {
        "accuracy": round(
            float(accuracy_score(y_test, pred, sample_weight=w_test)), 4
        ),
        "macro_f1": round(
            float(
                f1_score(y_test, pred, average="macro", sample_weight=w_test)
            ),
            4,
        ),
        "weighted_f1": round(
            float(
                f1_score(
                    y_test, pred, average="weighted", sample_weight=w_test
                )
            ),
            4,
        ),
        "n_train_combos": int(len(train_ids)),
        "n_test_combos": int(len(test_ids)),
        "n_test": int(round(float(w_test.sum()))),
        "class_weight_temper": CLASS_WEIGHT_TEMPER,
    }

    print(
        "  Severity model metrics: "
        f"accuracy={metrics['accuracy']}, "
        f"macro_f1={metrics['macro_f1']}, "
        f"weighted_f1={metrics['weighted_f1']}"
    )

    per_class = {
        label: {
            "precision": round(float(report[label]["precision"]), 3),
            "recall": round(float(report[label]["recall"]), 3),
            "f1": round(float(report[label]["f1-score"]), 3),
            "support": int(round(float(report[label]["support"]))),
        }
        for label in present
        if label in report
    }

    importances = feature_importances(pipeline, cat_features, num_features)

    cat_levels = {
        column: sorted(combos[column].unique().tolist())
        for column in cat_features
    }
    cat_levels["State"] = state_levels

    num_stats = {}
    total_w = float(combos["weight"].sum())
    for column in num_features:
        values = combos[column]
        num_stats[column] = {
            "mean": float((values * combos["weight"]).sum() / total_w),
            "min": int(values.min()),
            "max": int(values.max()),
        }

    ui_meta = {
        "inference": "backend",
        "dataset": dataset,
        "classes": present,
        "severity_order": SEVERITY_ORDER,
        "model_cat_features": cat_features,
        "model_num_features": num_features,
        "form_only_cat": form_only_cat,
        "cat_levels": cat_levels,
        "num_features": num_features,
        "num_means": {c: num_stats[c]["mean"] for c in num_features},
        "num_min": {c: num_stats[c]["min"] for c in num_features},
        "num_max": {c: num_stats[c]["max"] for c in num_features},
        "metrics": metrics,
        "per_class": per_class,
        "feature_importances": importances,
        "state_note": DATASETS[dataset]["state_note"],
    }

    serving = {
        "pipeline": pipeline,
        "classes": present,
        "cat_features": cat_features,
        "num_features": num_features,
        "severity_order": SEVERITY_ORDER,
    }

    return ui_meta, serving

def feature_importances(pipeline, cat_features, num_features, top_n=15):
    """
    Reports how much each original field matters to the model.

    With PCA between the encoder and the classifier the XGBoost gain
    importances are per principal component, not per one-hot column. Each
    component's gain is redistributed onto the one-hot columns in proportion
    to the absolute PCA loadings, then aggregated up to the original field —
    i.e. how strongly a field feeds the components the model actually relies
    on. Without a PCA step the gains map to one-hot columns directly.
    """
    pre = pipeline.named_steps["pre"]
    clf = pipeline.named_steps["clf"]
    names = pre.get_feature_names_out()

    pca = pipeline.named_steps.get("pca")
    if pca is not None:
        comp_gain = clf.feature_importances_
        loadings = np.abs(pca.components_)
        row_sums = loadings.sum(axis=1, keepdims=True)
        row_sums[row_sums == 0] = 1.0
        gains = (comp_gain[:, None] * loadings / row_sums).sum(axis=0)
    else:
        gains = clf.feature_importances_

    field_of = {}
    for name in names:
        body = name.split("__", 1)[1] if "__" in name else name
        matched = None
        for field in cat_features:
            if body == field or body.startswith(field + "_"):
                matched = field
                break
        if matched is None:
            for field in num_features:
                if body == field:
                    matched = field
                    break
        field_of[name] = matched or body

    agg = {}
    for name, gain in zip(names, gains):
        field = field_of[name]
        agg[field] = agg.get(field, 0.0) + float(gain)

    total = sum(agg.values()) or 1.0
    ranked = sorted(agg.items(), key=lambda kv: kv[1], reverse=True)
    return [
        {"feature": field, "importance": round(gain / total, 4)}
        for field, gain in ranked[:top_n]
    ]

def run(dataset):
    cfg = DATASETS[dataset]
    records_dir = cfg["records"]
    if not records_dir.exists():
        raise FileNotFoundError(
            f"{records_dir} was not found. Run the dataset's "
            "build_runtime_dataset.py first."
        )

    print(f"Grouping runtime records: {records_dir}")
    con = duckdb.connect()
    available = {
        r[0]
        for r in con.execute(
            f"DESCRIBE SELECT * FROM read_parquet('{records_dir}/*.parquet')"
        ).fetchall()
    }
    cat_features = [c for c in FEATURE_CAT if c in available]
    state_is_feature = cfg.get("state_is_feature", False) and "State" in available
    if state_is_feature:
        cat_features = cat_features + ["State"]
    form_only_cat = [] if state_is_feature else [c for c in FORM_ONLY_CAT if c in available]
    num_features = [c for c in FEATURE_NUM if c in available]

    combos = load_combinations(records_dir, cat_features, num_features)

    state_levels = []
    if "State" in available:
        state_levels = sorted(
            v[0]
            for v in con.execute(
                f"""SELECT DISTINCT "State"
                    FROM read_parquet('{records_dir}/*.parquet')"""
            ).fetchall()
            if v[0] is not None
        )
    con.close()

    print(f"Training XGBoost severity predictor ({dataset})...")
    ui_meta, serving = train_model(
        dataset, combos, cat_features, num_features, state_levels, form_only_cat
    )

    cfg["model_dir"].mkdir(parents=True, exist_ok=True)
    pipeline_path = cfg["model_dir"] / "pipeline.joblib"
    joblib.dump(serving, pipeline_path)
    print(f"Saved serving pipeline: {pipeline_path}")

    cfg["model_json"].parent.mkdir(parents=True, exist_ok=True)
    cfg["model_json"].write_text(json.dumps(ui_meta), encoding="utf-8")
    print(f"Saved frontend model metadata: {cfg['model_json']}")
