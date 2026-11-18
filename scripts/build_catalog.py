#!/usr/bin/env python3
"""Build the HarvestStat v1.2 coverage index without copying its source rows."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
CATALOG_PATH = ROOT / "data/catalog/v1/catalog.json"
COVERAGE_PATH = ROOT / "data/catalog/v1/harveststat-coverage-v1.2.csv"
SOURCE_ID = "harveststat-africa-v1-2"
PINNED_GIT_BLOB_SHA = "731d050395ed96b2d4a75b33f17ee61c7e569440"
REQUIRED_COLUMNS = {
    "fnid",
    "country",
    "country_code",
    "admin_1",
    "admin_2",
    "product",
    "season_name",
    "planting_year",
    "planting_month",
    "harvest_year",
    "harvest_month",
    "qc_flag",
}
COVERAGE_COLUMNS = [
    "source_id",
    "crop_id",
    "crop_label",
    "country_code",
    "country_name",
    "fnid",
    "admin_1",
    "admin_2",
    "admin_level",
    "season_name",
    "planting_year_min",
    "planting_year_max",
    "planting_months",
    "harvest_year_min",
    "harvest_year_max",
    "harvest_months",
    "record_count",
    "qc_flag_counts",
]


def _integer(value: str, column: str, minimum: int, maximum: int) -> int | None:
    value = value.strip()
    if not value:
        return None
    try:
        parsed = int(value)
    except ValueError as error:
        raise ValueError(f"{column} must be an integer or blank: {value!r}") from error
    if not minimum <= parsed <= maximum:
        raise ValueError(f"{column} is out of range: {value!r}")
    return parsed


def _crop_id(label: str) -> str:
    ascii_label = unicodedata.normalize("NFKD", label).encode("ascii", "ignore").decode()
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_label.lower()).strip("-") or "product"
    digest = hashlib.sha256(label.encode("utf-8")).hexdigest()[:8]
    return f"hsa-v1-2-{slug}-{digest}"


def _missing_field(**values: Any) -> dict[str, Any]:
    return {**values, "status": "missing", "source_ids": []}


def _profile(label: str) -> dict[str, Any]:
    return {
        "crop_id": _crop_id(label),
        "common_name": label,
        "scientific_name": None,
        "identity_status": "source_label_only",
        "identity_source_id": SOURCE_ID,
        "growing_duration_days": _missing_field(minimum=None, maximum=None),
        "temperature_requirements_c": _missing_field(
            minimum=None, maximum=None, growth_stage=None
        ),
        "rainfall_requirements_mm": _missing_field(
            minimum_total=None, maximum_total=None, period_days=None
        ),
        "water_requirement": _missing_field(value=None, unit=None, basis=None),
        "soil_preferences": _missing_field(
            texture_classes=[], ph_minimum=None, ph_maximum=None
        ),
        "planting_window_status": "missing",
        "planting_windows": [],
    }


def _year_range(values: set[int]) -> list[int] | None:
    return [min(values), max(values)] if values else None


def _git_blob_sha(path: Path) -> str:
    digest = hashlib.sha1()
    size = path.stat().st_size
    digest.update(f"blob {size}\0".encode("ascii"))
    with path.open("rb") as source_file:
        for chunk in iter(lambda: source_file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def build_catalog(
    source_csv: Path,
    catalog_path: Path = CATALOG_PATH,
    coverage_path: Path = COVERAGE_PATH,
    expected_git_blob_sha: str | None = None,
) -> dict[str, Any]:
    """Create one coverage record per FNID, crop product, and season."""
    source_git_blob_sha = _git_blob_sha(source_csv)
    if expected_git_blob_sha and source_git_blob_sha != expected_git_blob_sha:
        raise ValueError(
            "HarvestStat source CSV does not match the expected Git blob SHA: "
            f"{source_git_blob_sha}"
        )

    groups: dict[tuple[str, str, str, str], dict[str, Any]] = {}
    countries: dict[str, dict[str, Any]] = {}
    products: set[str] = set()
    season_labels: set[str] = set()
    planting_years: set[int] = set()
    harvest_years: set[int] = set()
    record_count = 0

    with source_csv.open(newline="", encoding="utf-8-sig") as source_file:
        reader = csv.DictReader(source_file)
        if reader.fieldnames is None:
            raise ValueError("HarvestStat CSV has no header")
        missing_columns = REQUIRED_COLUMNS - set(reader.fieldnames)
        if missing_columns:
            raise ValueError(f"HarvestStat CSV is missing columns: {sorted(missing_columns)}")

        for line_number, row in enumerate(reader, start=2):
            country_code = row["country_code"].strip().upper()
            country_name = row["country"].strip()
            fnid = row["fnid"].strip()
            label = row["product"].strip()
            season_name = row["season_name"].strip()
            admin_1 = row["admin_1"].strip()
            source_admin_2 = row["admin_2"].strip()
            admin_2 = "" if source_admin_2.lower() in {"", "none"} else source_admin_2
            admin_level = 2 if admin_2 else 1

            if not re.fullmatch(r"[A-Z]{2}", country_code):
                raise ValueError(f"Invalid country_code on CSV line {line_number}")
            if not all((country_name, fnid, label, admin_1)):
                raise ValueError(f"Missing geography or product label on CSV line {line_number}")

            planting_year = _integer(row["planting_year"], "planting_year", 1900, 2200)
            planting_month = _integer(row["planting_month"], "planting_month", 1, 12)
            harvest_year = _integer(row["harvest_year"], "harvest_year", 1900, 2200)
            harvest_month = _integer(row["harvest_month"], "harvest_month", 1, 12)
            qc_flag = row["qc_flag"].strip() or "missing"

            key = (country_code, fnid, label, season_name)
            group = groups.setdefault(
                key,
                {
                    "country_name": country_name,
                    "admin_1": admin_1,
                    "admin_2": admin_2,
                    "admin_level": admin_level,
                    "planting_years": set(),
                    "planting_months": set(),
                    "harvest_years": set(),
                    "harvest_months": set(),
                    "qc_flag_counts": Counter(),
                    "record_count": 0,
                },
            )
            group_identity = (country_name, admin_1, admin_2, admin_level)
            if group_identity != (
                group["country_name"],
                group["admin_1"],
                group["admin_2"],
                group["admin_level"],
            ):
                raise ValueError(f"Inconsistent geography for coverage key {key!r}")

            if planting_year is not None:
                group["planting_years"].add(planting_year)
                planting_years.add(planting_year)
            if planting_month is not None:
                group["planting_months"].add(planting_month)
            if harvest_year is not None:
                group["harvest_years"].add(harvest_year)
                harvest_years.add(harvest_year)
            if harvest_month is not None:
                group["harvest_months"].add(harvest_month)
            group["qc_flag_counts"][qc_flag] += 1
            group["record_count"] += 1
            record_count += 1
            products.add(label)
            if season_name:
                season_labels.add(season_name)

            country = countries.setdefault(
                country_code,
                {"name": country_name, "admin_levels": set()},
            )
            if country["name"] != country_name:
                raise ValueError(f"Inconsistent country name for code {country_code}")
            country["admin_levels"].add(admin_level)

    if not groups:
        raise ValueError("HarvestStat CSV contains no data rows")

    crop_ids = {label: _crop_id(label) for label in products}
    coverage_path.parent.mkdir(parents=True, exist_ok=True)
    with coverage_path.open("w", newline="", encoding="utf-8") as coverage_file:
        writer = csv.DictWriter(
            coverage_file, fieldnames=COVERAGE_COLUMNS, lineterminator="\n"
        )
        writer.writeheader()
        for (country_code, fnid, label, season_name), group in sorted(groups.items()):
            writer.writerow(
                {
                    "source_id": SOURCE_ID,
                    "crop_id": crop_ids[label],
                    "crop_label": label,
                    "country_code": country_code,
                    "country_name": group["country_name"],
                    "fnid": fnid,
                    "admin_1": group["admin_1"],
                    "admin_2": group["admin_2"],
                    "admin_level": group["admin_level"],
                    "season_name": season_name,
                    "planting_year_min": min(group["planting_years"])
                    if group["planting_years"]
                    else "",
                    "planting_year_max": max(group["planting_years"])
                    if group["planting_years"]
                    else "",
                    "planting_months": json.dumps(sorted(group["planting_months"])),
                    "harvest_year_min": min(group["harvest_years"])
                    if group["harvest_years"]
                    else "",
                    "harvest_year_max": max(group["harvest_years"])
                    if group["harvest_years"]
                    else "",
                    "harvest_months": json.dumps(sorted(group["harvest_months"])),
                    "record_count": group["record_count"],
                    "qc_flag_counts": json.dumps(
                        dict(sorted(group["qc_flag_counts"].items())),
                        separators=(",", ":"),
                    ),
                }
            )

    admin_level_counts: Counter[str] = Counter()
    for country in countries.values():
        level_name = str(next(iter(country["admin_levels"]))) if len(country["admin_levels"]) == 1 else "mixed"
        admin_level_counts[level_name] += 1

    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    source_records = {
        source["source_id"]: source for source in catalog["sources"]
    }
    if SOURCE_ID not in source_records:
        raise ValueError(f"Catalog is missing source {SOURCE_ID}")
    source_records[SOURCE_ID]["observed_coverage"] = {
        "record_count": record_count,
        "country_count": len(countries),
        "crop_product_count": len(products),
        "season_label_count": len(season_labels),
        "admin_level_country_counts": dict(sorted(admin_level_counts.items())),
        "planting_year_range": _year_range(planting_years),
        "harvest_year_range": _year_range(harvest_years),
    }
    catalog["crop_profiles"] = [_profile(label) for label in sorted(products)]
    catalog["regional_coverage"]["record_count"] = len(groups)
    catalog["regional_coverage"]["generated_on"] = catalog["accessed_on"]
    catalog_path.write_text(
        json.dumps(catalog, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return {
        "record_count": record_count,
        "coverage_rows": len(groups),
        "countries": len(countries),
        "products": len(products),
        "season_labels": len(season_labels),
        "planting_year_range": _year_range(planting_years),
        "harvest_year_range": _year_range(harvest_years),
        "source_git_blob_sha": source_git_blob_sha,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--harveststat-csv",
        required=True,
        type=Path,
        help="Path to hvstat_africa_data_v1.2.csv from the pinned upstream release.",
    )
    parser.add_argument("--catalog", type=Path, default=CATALOG_PATH)
    parser.add_argument("--coverage", type=Path, default=COVERAGE_PATH)
    parser.add_argument(
        "--expected-git-blob-sha",
        default=PINNED_GIT_BLOB_SHA,
        help="Expected Git blob SHA for the pinned upstream CSV.",
    )
    args = parser.parse_args()
    summary = build_catalog(
        args.harveststat_csv,
        args.catalog,
        args.coverage,
        args.expected_git_blob_sha,
    )
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
