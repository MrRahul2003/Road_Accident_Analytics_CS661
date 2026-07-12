"""
Trains the UK severity predictor. Shared logic lives in
scripts/data_pipeline/severity_training.py (same model for the India dataset).

Run after build_runtime_dataset.py (from repo root, using the project venv):
    python scripts/data_pipeline/uk/train_severity_model.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from severity_training import run

if __name__ == "__main__":
    run("uk")
