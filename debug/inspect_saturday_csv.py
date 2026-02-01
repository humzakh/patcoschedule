
import pandas as pd
from pathlib import Path

CSV_DIR = Path(__file__).parent.parent / "app" / "schedules" / "parsed_csvs"

def inspect_saturday():
    # Find Saturday Eastbound CSV
    pattern = "*_saturday_eastbound.csv"
    csvs = list(CSV_DIR.glob(pattern))
    if not csvs:
        print("No Saturday Eastbound CSV found!")
        try:
            # Fallback to listing all
            print("Files:", list(CSV_DIR.glob("*.csv")))
        except:
            pass
        return

    csv = csvs[0]
    print(f"Loading {csv}...")
    df = pd.read_csv(csv)
    
    col = "15/16th & Locust"
    if col not in df.columns:
        print(f"Column '{col}' not found.")
        return

    print(f"\nTotal rows: {len(df)}")
    print(f"Inspecting '{col}' column around midnight:")
    
    # Print all rows to scan for the jump
    for i, t_str in enumerate(df[col]):
        # Highlight late night or early morning
        print(f"Row {i}: {t_str}")

if __name__ == "__main__":
    inspect_saturday()
