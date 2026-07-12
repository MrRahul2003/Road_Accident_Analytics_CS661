"""
UK STATS19 -> unified `records` table (mirrors data/runtime/india/records schema)
================================================================================
Reads the three raw DfT STATS19 CSVs in data/sources/uk_stats19/ (collision /
vehicle / casualty, 1979-2024, ~9.0M collisions), decodes every coded field
using the official code list (dft-stats19-data-guide-2024.xlsx), and writes one
flat Parquet table at data/runtime/uk/records/ with the SAME column names as the India
synthetic corpus so every existing chart/component works unchanged.

Grain: one row per collision (~9.0M rows), joined to its first-listed vehicle
(vehicle_reference = 1) for driver/vehicle fields and first-listed casualty
(casualty_reference = 1) for casualty fields — matching the India corpus,
which is also one accident-level row with a representative vehicle/casualty.

India-only fields with no UK STATS19 source (contributory factors, driving
experience, education, vehicle ownership/defects, casualty fitness/work) are
filled with the constant "Not available (UK)" rather than a fabricated proxy.

Run (from repo root, using the project venv):
    python scripts/data_pipeline/uk/build_runtime_dataset.py
"""

import json
import re
from pathlib import Path

import duckdb
import openpyxl

ROOT = Path(__file__).resolve().parents[3]
RAW_DIR = ROOT / "data" / "sources" / "uk_stats19"
OUT_DIR = ROOT / "data" / "runtime" / "uk"
CODE_LABELS_PATH = ROOT / "data" / "intermediate" / "uk" / "uk_code_labels.json"
GUIDE_XLSX = RAW_DIR / "dft-stats19-data-guide-2024.xlsx"

COLLISION_CSV = RAW_DIR / "dft-road-casualty-statistics-collision-1979-latest-published-year.csv"
VEHICLE_CSV = RAW_DIR / "dft-road-casualty-statistics-vehicle-1979-latest-published-year.csv"
CASUALTY_CSV = RAW_DIR / "dft-road-casualty-statistics-casualty-1979-latest-published-year.csv"

SEVERITY_ORDER = ["Slight Injury", "Serious Injury", "Fatal injury"]

NOT_AVAILABLE = "Not available (UK)"

JUNK_LABEL = re.compile(r"data missing|out of range|unallocated|not known|undefined", re.I)

def clean_label(label):
    return "Unknown" if label is None or JUNK_LABEL.search(str(label)) else label

def extract_code_labels():
    """Parses the DfT code-list workbook into {table: {field: {code: label}}}
    and caches it to uk_code_labels.json so re-runs don't need openpyxl."""
    if CODE_LABELS_PATH.exists():
        return json.loads(CODE_LABELS_PATH.read_text())

    wb = openpyxl.load_workbook(GUIDE_XLSX, read_only=True, data_only=True)
    ws = wb["2024_code_list"]
    rows = list(ws.iter_rows(values_only=True))[1:]

    labels = {}
    for table, field, code, label, _note in rows:
        if code is None and label is None:
            continue
        try:
            code_int = int(code)
        except (TypeError, ValueError):
            continue
        labels.setdefault(table, {}).setdefault(field, {})[str(code_int)] = label

    CODE_LABELS_PATH.parent.mkdir(parents=True, exist_ok=True)
    CODE_LABELS_PATH.write_text(json.dumps(labels, indent=2))
    return labels

def sql_case(expr, mapping, default="'Unknown'"):
    """Builds a SQL CASE expression from a {code: label} dict. `default` is
    inserted verbatim (either a quoted literal or another SQL expression)."""
    whens = " ".join(
        f"WHEN {expr} = {code} THEN '{label}'"
        for code, label in mapping.items()
    )
    return f"CASE {whens} ELSE {default} END"

def build():
    labels = extract_code_labels()
    collision_L = labels["collision"]
    vehicle_L = labels["vehicle"]
    casualty_L = labels["casualty"]

    def L(table_labels, field, escape=True):
        m = table_labels[field]
        out = {}
        for code, label in m.items():
            lab = clean_label(label)
            lab = lab.replace("'", "''") if escape else lab
            out[code] = lab
        return out

    severity_map = {"1": "Fatal injury", "2": "Serious Injury", "3": "Slight Injury"}

    tmp_dir = OUT_DIR / "_duckdb_tmp"
    tmp_dir.mkdir(parents=True, exist_ok=True)

    con = duckdb.connect()
    con.execute("PRAGMA threads=6")
    con.execute("PRAGMA memory_limit='10GB'")
    con.execute(f"PRAGMA temp_directory='{tmp_dir}'")

    con.execute(f"""
        CREATE VIEW collision AS
        SELECT * FROM read_csv('{COLLISION_CSV}', ignore_errors=true)
    """)
    con.execute(f"""
        CREATE VIEW vehicle1 AS
        SELECT * FROM read_csv('{VEHICLE_CSV}', ignore_errors=true)
        WHERE vehicle_reference = 1
    """)
    con.execute(f"""
        CREATE VIEW casualty1 AS
        SELECT * FROM read_csv('{CASUALTY_CSV}', ignore_errors=true)
        WHERE casualty_reference = 1
    """)
    con.execute(f"""
        CREATE VIEW casualty_flags AS
        SELECT collision_index,
               MAX(CASE WHEN casualty_class = 3 THEN 1 ELSE 0 END) AS has_pedestrian
        FROM read_csv('{CASUALTY_CSV}', ignore_errors=true)
        GROUP BY 1
    """)

    day_of_week = sql_case("c.day_of_week", L(collision_L, "day_of_week"))
    light = sql_case("c.light_conditions", L(collision_L, "light_conditions"))
    weather = sql_case("c.weather_conditions", L(collision_L, "weather_conditions"))
    road_surface = sql_case("c.road_surface_conditions", L(collision_L, "road_surface_conditions"))
    urban_rural = sql_case("c.urban_or_rural_area", L(collision_L, "urban_or_rural_area"))
    road_type = sql_case("c.road_type", L(collision_L, "road_type"))
    road_class = sql_case("c.first_road_class", L(collision_L, "first_road_class"))
    police_force = sql_case("c.police_force", L(collision_L, "police_force"), default="'Unknown Force'")
    severity = sql_case("c.collision_severity", severity_map, default="'Unknown'")

    veh_type = sql_case("v.vehicle_type", L(vehicle_L, "vehicle_type"))
    sex_driver = sql_case("v.sex_of_driver", {"1": "Male", "2": "Female"}, default="'Unknown'")
    age_band_driver = sql_case("v.age_band_of_driver", L(vehicle_L, "age_band_of_driver"))
    manoeuvre = sql_case("v.vehicle_manoeuvre", L(vehicle_L, "vehicle_manoeuvre"))
    imd_decile = sql_case("v.driver_imd_decile", L(vehicle_L, "driver_imd_decile"))

    vehicle_age_band = """
        CASE
            WHEN v.age_of_vehicle < 0 THEN 'Unknown'
            WHEN v.age_of_vehicle <= 2 THEN '0-2 yrs'
            WHEN v.age_of_vehicle <= 5 THEN '3-5 yrs'
            WHEN v.age_of_vehicle <= 10 THEN '6-10 yrs'
            WHEN v.age_of_vehicle <= 15 THEN '11-15 yrs'
            WHEN v.age_of_vehicle IS NOT NULL THEN 'Over 15 yrs'
            ELSE 'Unknown'
        END
    """

    sex_casualty = sql_case("cas.sex_of_casualty", {"1": "Male", "2": "Female"}, default="'Unknown'")
    age_band_casualty = sql_case("cas.age_band_of_casualty", L(casualty_L, "age_band_of_casualty"))
    casualty_class = sql_case("cas.casualty_class", L(casualty_L, "casualty_class"))
    casualty_severity = sql_case("cas.casualty_severity", severity_map, default="'Unknown'")
    pedestrian_movement = sql_case("cas.pedestrian_movement", L(casualty_L, "pedestrian_movement"), default="'Not a Pedestrian'")

    vehicle_movement = """
        CASE
            WHEN v.skidding_and_overturning = 1 THEN 'Skidded'
            WHEN v.skidding_and_overturning = 2 THEN 'Skidded and overturned'
            WHEN v.skidding_and_overturning = 3 THEN 'Jackknifed'
            WHEN v.skidding_and_overturning = 4 THEN 'Jackknifed and overturned'
            WHEN v.skidding_and_overturning = 5 THEN 'Overturned'
            WHEN v.vehicle_leaving_carriageway NOT IN (0, -1) THEN 'Left carriageway'
            WHEN v.skidding_and_overturning = -1 THEN 'Unknown'
            ELSE 'No abnormal movement'
        END
    """

    type_of_collision = f"""
        CASE
            WHEN cf.has_pedestrian = 1 THEN 'Collision with pedestrians'
            WHEN v.skidding_and_overturning IN (2, 4, 5) THEN 'Rollover'
            WHEN v.hit_object_off_carriageway NOT IN (0, -1)
                 OR v.vehicle_leaving_carriageway NOT IN (0, -1) THEN 'Collision with roadside objects'
            WHEN c.number_of_vehicles >= 2 THEN 'Vehicle with vehicle collision'
            ELSE 'Other'
        END
    """

    hour_expr = "TRY_CAST(EXTRACT(hour FROM c.time) AS SMALLINT)"
    time_of_day = f"""
        CASE
            WHEN {hour_expr} BETWEEN 6 AND 11 THEN 'Morning (6-11)'
            WHEN {hour_expr} BETWEEN 12 AND 16 THEN 'Afternoon (12-16)'
            WHEN {hour_expr} BETWEEN 17 AND 20 THEN 'Evening (17-20)'
            ELSE 'Night (0-5)'
        END
    """
    severity_rank = "CASE c.collision_severity WHEN 1 THEN 2 WHEN 2 THEN 1 WHEN 3 THEN 0 ELSE NULL END"

    select_sql = f"""
        SELECT
            CAST(c.time AS VARCHAR) AS "Time",
            {day_of_week} AS Day_of_week,
            {age_band_driver} AS Age_band_of_driver,
            {sex_driver} AS Sex_of_driver,
            {imd_decile} AS Educational_level,
            '{NOT_AVAILABLE}' AS Vehicle_driver_relation,
            {vehicle_age_band} AS Driving_experience,
            {veh_type} AS Type_of_vehicle,
            '{NOT_AVAILABLE}' AS Owner_of_vehicle,
            '{NOT_AVAILABLE}' AS Service_year_of_vehicle,
            '{NOT_AVAILABLE}' AS Defect_of_vehicle,
            {urban_rural} AS Area_accident_occured,
            {road_type} AS Lanes_or_Medians,
            '{NOT_AVAILABLE}' AS Road_allignment,
            '{NOT_AVAILABLE}' AS Types_of_Junction,
            {road_class} AS Road_surface_type,
            {road_surface} AS Road_surface_conditions,
            {light} AS Light_conditions,
            {weather} AS Weather_conditions,
            {type_of_collision} AS Type_of_collision,
            CAST(c.number_of_vehicles AS SMALLINT) AS Number_of_vehicles_involved,
            CAST(c.number_of_casualties AS SMALLINT) AS Number_of_casualties,
            {vehicle_movement} AS Vehicle_movement,
            {casualty_class} AS Casualty_class,
            {sex_casualty} AS Sex_of_casualty,
            {age_band_casualty} AS Age_band_of_casualty,
            {casualty_severity} AS Casualty_severity,
            '{NOT_AVAILABLE}' AS Work_of_casuality,
            '{NOT_AVAILABLE}' AS Fitness_of_casuality,
            {pedestrian_movement} AS Pedestrian_movement,
            {manoeuvre} AS Cause_of_accident,
            {severity} AS Accident_severity,
            CAST(COALESCE({hour_expr}, 12) AS SMALLINT) AS Hour,
            {time_of_day} AS Time_of_day,
            {day_of_week} IN ('Saturday', 'Sunday') AS Is_weekend,
            CAST({severity_rank} AS SMALLINT) AS Severity_rank,
            {police_force} AS State
        FROM collision c
        LEFT JOIN vehicle1 v ON v.collision_index = c.collision_index
        LEFT JOIN casualty1 cas ON cas.collision_index = c.collision_index
        LEFT JOIN casualty_flags cf ON cf.collision_index = c.collision_index
    """

    out_dir = OUT_DIR / "records"
    out_dir.mkdir(parents=True, exist_ok=True)
    con.execute(f"""
        COPY ({select_sql}) TO '{out_dir}'
        (FORMAT PARQUET, COMPRESSION ZSTD, PER_THREAD_OUTPUT true)
    """)

    write_meta(con, out_dir)

def write_meta(con, records_dir):
    view = "SELECT * FROM read_parquet('" + str(records_dir) + "/*.parquet')"
    n_records = con.execute(f"SELECT COUNT(*) FROM ({view})").fetchone()[0]
    severity_counts = dict(con.execute(
        f'SELECT "Accident_severity", COUNT(*) FROM ({view}) GROUP BY 1'
    ).fetchall())

    distinct_fields = [
        "Day_of_week", "Time_of_day", "Age_band_of_driver", "Sex_of_driver",
        "Type_of_vehicle", "Area_accident_occured", "Lanes_or_Medians",
        "Road_surface_conditions", "Light_conditions", "Weather_conditions",
        "Type_of_collision", "Vehicle_movement", "Cause_of_accident", "Road_surface_type",
        "Driving_experience", "Educational_level", "Accident_severity", "State",
    ]
    distinct = {}
    for f in distinct_fields:
        rows = con.execute(f'SELECT DISTINCT "{f}" FROM ({view}) ORDER BY 1').fetchall()
        distinct[f] = [r[0] for r in rows]

    meta = {
        "dataset": "uk_stats19_1979_2024",
        "synthetic": False,
        "n_records": n_records,
        "severity_order": SEVERITY_ORDER,
        "severity_counts": {s: severity_counts.get(s, 0) for s in SEVERITY_ORDER},
        "distinct": distinct,
        "source": {
            "provider": "Department for Transport (DfT) — STATS19 road safety data",
            "licence": "Open Government Licence v3.0",
            "years": "1979-2024",
            "grain": "one row per collision, joined to its first-listed vehicle and casualty",
        },
        "data_note": (
            "Several columns are STATS19 proxies, not literal matches to the "
            "India schema — the frontend relabels them for this dataset: "
            "Cause_of_accident holds the vehicle's manoeuvre before the "
            "collision (vehicle_manoeuvre; shown as 'Cause'). Vehicle_movement "
            "holds skid/overturn/leave-carriageway outcomes. Road_surface_type "
            "holds road classification (Motorway/A/B/C/Unclassified; shown as "
            "'Road class'), not paving material. Driving_experience holds "
            "vehicle age in years (age_of_vehicle; shown as 'Vehicle age'), "
            "since STATS19 has no years-licensed field. Educational_level holds "
            "the driver's home-area deprivation decile (driver_imd_decile; "
            "shown as 'Deprivation decile'), since STATS19 collects no "
            "education data. Fields with no STATS19 equivalent at all (vehicle "
            "ownership/defects, casualty fitness/occupation) are filled with "
            "the constant 'Not available (UK)' rather than approximated."
        ),
    }
    (records_dir.parent / "meta.json").write_text(json.dumps(meta, indent=2))
    print(f"wrote {n_records:,} records to {records_dir}")

if __name__ == "__main__":
    build()
