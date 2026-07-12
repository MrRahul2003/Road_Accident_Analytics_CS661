import argparse
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[3]

SEVERITY_ORDER = ["Slight Injury", "Serious Injury", "Fatal injury"]
NULL_TOKENS = {"na", "nan", "unknown", "n/a", "none", "null", "", "?"}

SOURCES = {
    "generated": (
        ROOT / "data" / "intermediate" / "india" / "synthetic_raw.csv",
        ROOT / "data" / "intermediate" / "india" / "synthetic_cleaned.csv",
    ),
    "original": (
        ROOT / "data" / "sources" / "india" / "Road.csv",
        ROOT / "data" / "intermediate" / "india" / "rta_cleaned.csv",
    ),
}

def clean(df, drop_duplicates=True):
    report = {"rows_in": int(len(df))}

    df = df.copy()
    df.columns = [c.strip() for c in df.columns]

    object_columns = df.select_dtypes(include="object").columns.tolist()

    for column in object_columns:
        df[column] = (
            df[column]
            .astype(str)
            .str.strip()
            .str.replace(r"\s+", " ", regex=True)
        )

    def normalize_null(value):
        if isinstance(value, str) and value.strip().lower() in NULL_TOKENS:
            return np.nan
        return value

    for column in object_columns:
        df[column] = df[column].map(normalize_null)

    if drop_duplicates:
        duplicate_count = int(df.duplicated().sum())
        df = df.drop_duplicates().reset_index(drop=True)
    else:
        duplicate_count = 0

    report["duplicates_removed"] = duplicate_count

    for column in ["Number_of_vehicles_involved", "Number_of_casualties"]:
        if column in df.columns:
            numeric = pd.to_numeric(df[column], errors="coerce")
            median = numeric.median()

            if pd.isna(median):
                median = 1

            df[column] = numeric.fillna(median).clip(lower=1).round().astype(int)

    missing_cells = int(df[object_columns].isna().sum().sum())

    for column in object_columns:
        if column in df.columns:
            df[column] = df[column].fillna("Unknown")

    report["categorical_cells_imputed"] = missing_cells

    severity_map = {
        "slight injury": "Slight Injury",
        "slight": "Slight Injury",
        "serious injury": "Serious Injury",
        "serious": "Serious Injury",
        "fatal injury": "Fatal injury",
        "fatal": "Fatal injury",
    }

    df["Accident_severity"] = (
        df["Accident_severity"]
        .astype(str)
        .str.strip()
        .str.lower()
        .map(severity_map)
    )

    invalid_target_rows = int(df["Accident_severity"].isna().sum())
    df = df.dropna(subset=["Accident_severity"]).reset_index(drop=True)

    report["unmappable_target_rows_dropped"] = invalid_target_rows
    report["rows_out"] = int(len(df))

    return df, report

def derive(df):
    df = df.copy()

    parsed_time = pd.to_datetime(
        df["Time"].astype(str),
        format="%H:%M:%S",
        errors="coerce",
    )

    hour = parsed_time.dt.hour

    if hour.isna().all():
        hour = pd.to_numeric(
            df["Time"].astype(str).str.extract(r"^\s*(\d{1,2})")[0],
            errors="coerce",
        )

    median_hour = hour.median()
    fill_hour = 12 if pd.isna(median_hour) else int(round(median_hour))

    df["Hour"] = hour.fillna(fill_hour).round().astype(int).clip(0, 23)

    bins = [-1, 5, 11, 16, 20, 24]
    labels = [
        "Night (0-5)",
        "Morning (6-11)",
        "Afternoon (12-16)",
        "Evening (17-20)",
        "Night (21-23)",
    ]

    df["Time_of_day"] = pd.cut(
        df["Hour"],
        bins=bins,
        labels=labels,
    ).astype(str)

    df["Time_of_day"] = df["Time_of_day"].replace(
        "Night (21-23)",
        "Night (0-5)",
    )

    df["Is_weekend"] = df["Day_of_week"].isin(["Saturday", "Sunday"])

    df["Severity_rank"] = df["Accident_severity"].map(
        {name: rank for rank, name in enumerate(SEVERITY_ORDER)}
    )

    return df

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", choices=SOURCES, default="generated")
    args = parser.parse_args()

    input_path, output_path = SOURCES[args.source]

    df = pd.read_csv(input_path, keep_default_na=False)
    print(f"Loaded {len(df):,} rows from {input_path}")

    should_drop_duplicates = args.source == "original"

    df, report = clean(df, drop_duplicates=should_drop_duplicates)
    df = derive(df)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(output_path, index=False)

    print(
        f"Saved {len(df):,} rows to {output_path} "
        f"(duplicates removed: {report['duplicates_removed']:,})"
    )

if __name__ == "__main__":
    main()
