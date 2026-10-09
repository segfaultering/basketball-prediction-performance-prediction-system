"""Execute a fresh notebook copy without changing the checked-in parameters."""

import argparse
import os
from pathlib import Path

import nbformat
from nbclient import NotebookClient
from nbclient.exceptions import CellExecutionError
from nbformat.notebooknode import NotebookNode

from bpps.settings import PROJECT_ROOT


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", choices=("nba", "csv", "synthetic"), default="nba")
    parser.add_argument("--csv", type=Path)
    parser.add_argument("--refresh", action="store_true")
    parser.add_argument("--player-id", default="201939")
    parser.add_argument("--first-season", type=int, default=2009)
    parser.add_argument("--last-season", type=int, default=2025)
    parser.add_argument("--tuning-seasons", type=int, nargs="+", default=[2023, 2024])
    parser.add_argument("--holdout-season", type=int, default=2025)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if args.source == "csv" and args.csv is None:
        parser.error("--source csv requires --csv")
    cache = PROJECT_ROOT / ".cache" / "bpps" / "research"
    cache.mkdir(parents=True, exist_ok=True)
    output = args.output or cache / f"player_baseline_{args.source}.ipynb"
    output = output.resolve()
    notebook = nbformat.read(
        PROJECT_ROOT / "notebooks/player_baseline.ipynb", as_version=4
    )
    if not isinstance(notebook, NotebookNode):
        raise TypeError("Expected a version-4 notebook document")
    parameters = {
        "DATA_SOURCE": repr(args.source),
        "PLAYER_ID": repr(args.player_id),
        "FIRST_SEASON": repr(args.first_season),
        "LAST_SEASON": repr(args.last_season),
        "CSV_PATH": (
            f"PROJECT_ROOT / {str(args.csv.resolve())!r}" if args.csv else "None"
        ),
        "REFRESH": repr(args.refresh),
        "TUNING_SEASONS": repr(tuple(args.tuning_seasons)),
        "HOLDOUT_SEASON": repr(args.holdout_season),
        "CACHE_DIR": 'PROJECT_ROOT / ".cache" / "bpps" / "research"',
    }
    for cell in notebook.cells:
        if "parameters" in cell.metadata.get("tags", []):
            cell.source = "\n".join(
                f"{key} = {value}" for key, value in parameters.items()
            )
    nbformat.validate(notebook)
    # Keep all notebook/kernel caches inside the workspace; no kernel installation.
    runtime = cache / "runtime"
    runtime.mkdir(exist_ok=True)
    environment = dict(os.environ)
    environment.update(
        IPYTHONDIR=str(runtime / "ipython"),
        JUPYTER_RUNTIME_DIR=str(runtime / "jupyter"),
        MPLCONFIGDIR=str(runtime / "matplotlib"),
        MPLBACKEND="module://matplotlib_inline.backend_inline",
    )
    client = NotebookClient(
        notebook,
        timeout=600,
        kernel_name="python3",
        resources={"metadata": {"path": str(PROJECT_ROOT)}},
    )
    succeeded = True
    try:
        client.execute(env=environment)
    except CellExecutionError as exc:
        succeeded = False
        print(f"Notebook failed; execution details will be saved.\n{exc}")
    output.parent.mkdir(parents=True, exist_ok=True)
    nbformat.write(notebook, output)
    print(f"Executed notebook: {output}")
    return 0 if succeeded else 1


if __name__ == "__main__":
    raise SystemExit(main())
