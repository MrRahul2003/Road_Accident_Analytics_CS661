import duckdb
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
RAW_DIR = ROOT / "data" / "sources" / "uk_stats19"

files = {
    "Collisions": "dft-road-casualty-statistics-collision-1979-latest-published-year.csv",
    "Vehicles": "dft-road-casualty-statistics-vehicle-1979-latest-published-year.csv",
    "Casualties": "dft-road-casualty-statistics-casualty-1979-latest-published-year.csv",
}

con = duckdb.connect()

for name, path in files.items():
    csv_path = RAW_DIR / path
    result = con.execute(
        f"SELECT COUNT(*) FROM read_csv('{csv_path}', ignore_errors=true)"
    ).fetchone()[0]
    print(f"{name}: {result:,} rows")

con.close()
