# Crop and regional suitability data catalog

The catalog is a versioned evidence inventory, not a crop recommendation
service or a claim that every African country is supported. Its proposed
normalized crop profile lives in
[`data/catalog/v1/catalog.schema.json`](../data/catalog/v1/catalog.schema.json);
the current catalog data is
[`data/catalog/v1/catalog.json`](../data/catalog/v1/catalog.json). A source
coverage index for the pinned HarvestStat Africa v1.2 release is
[`data/catalog/v1/harveststat-coverage-v1.2.csv`](../data/catalog/v1/harveststat-coverage-v1.2.csv),
described by
[`data/catalog/v1/harveststat-coverage.schema.json`](../data/catalog/v1/harveststat-coverage.schema.json).
Catalog, profile, and coverage formats are versioned independently from the
recommendation API's OpenAPI contract.

## What is and is not populated

The HarvestStat Africa v1.2 source CSV is not copied into this repository.
Instead, the checked-in coverage index is reproducibly aggregated from its
version-pinned release file. It has one row per source administrative unit
(FNID), exact source crop-product label, and exact season label. Its keys let
consumers filter by `crop_id`, country (`country_code`), administrative unit
(`fnid`), and `season_name`. The crop profile records use source-specific IDs
and preserve the upstream product label; they are not yet taxonomically
cross-walked.

HarvestStat values describe historical crop production, harvested area, yield,
and reporting seasons. They are evidence that a crop was reported in a place
and season, **not** evidence that growing conditions were suitable. The
upstream README explicitly says `planting_year`, `planting_month`,
`harvest_year`, and `harvest_month` distinguish multi-season systems and
seasons crossing calendar years; **they do not represent actual phenological
timing**. The coverage index therefore reports these fields only as observed
source calendar labels/ranges and must not be used directly as a
recommendation window.

An absent coverage-index key means there is no matching record in this pinned
release for that exact crop/FNID/season. It does not mean the crop is absent,
unsuitable, or unsupported by all other sources.

The normalized profile fields for growing duration, temperature and rainfall
needs, water requirements, soil preferences, and planting windows are defined
but currently missing for every crop. Null values and `status: "missing"` are
intentional; they must not be replaced with plausible-looking values absent
crop-specific cited evidence. `proposed` describes a field/representation
decision only, never a sourced crop threshold.

## Source register

| Source | Catalog use and verified coverage | Terms and limits |
| --- | --- | --- |
| [HarvestStat Africa v1.2](https://github.com/HarvestStat/HarvestStat-Africa/tree/v1.2/public) | Indexed from the pinned release CSV: 217,487 source records, 33 Sub-Saharan countries, 92 exact product labels, and 34 non-empty season labels. Coverage ranges by reported planting/harvest year from 1960 through 2026; each crop/location/season has its own range and count. Administrative units are identified by FEWS NET FNID at level 1 or 2. Dataset version changelog is dated 2026-05-05. | Upstream v1.2 README licenses repository data under MIT. Historical reporting is not suitability. Calendar fields separate seasons, not phenology. Values are derived from multiple source documents; consult upstream notes and citations. |
| [SoilGrids 2.0](https://docs.isric.org/globaldata/soilgrids/) | Candidate global soil layers, including Africa: 250 m maps, six standard depth intervals, soil pH, organic carbon, texture fractions, bulk density, coarse fragments, CEC, and total nitrogen. No raster has been retrieved. | ISRIC states CC BY 4.0. Prediction uncertainty matters. ISRIC reports its REST API is temporarily paused; use documented WCS/WebDAV alternatives if service access is required. |
| [CHIRPS v3](https://www.chc.ucsb.edu/data/chirps3) | Candidate rainfall time series, 0.05° quasi-global land coverage from 60°N to 60°S, 1981 to near-present, including Africa. Pentad and monthly are fundamental; daily estimates are disaggregated from pentad totals. No raster or summary has been retrieved. | CHC states public-domain dedication to the extent possible and CC BY 4.0. Daily date labels do not imply uniform local observation windows. Complex terrain and extreme rainfall have known estimation limitations. |
| [ERA5-Land](https://cds.climate.copernicus.eu/datasets/reanalysis-era5-land) | Candidate temperature/reanalysis layer: global, January 1950 to present, hourly, 0.1° distribution grid (native resolution reported as 9 km). No variables have been retrieved or summarized. | CDS says product-specific licenses apply and download requires registration. Confirm the selected product's license and variable availability before use. Reanalysis estimates are not local station observations. |
| [FAO/IIASA GAEZ v4](https://gaez.fao.org/) | Candidate crop-suitability source. The official portal exposes GAEZ v4 data and crop-related themes; no individual crop-suitability layer or regional values have been checked into this catalog. | A layer-specific license, resolution, period/scenario, and method were not verified from the portal landing page. Verify those details before using or redistributing a selected layer. Modeled suitability is not a farm-level guarantee. |
| [FAO ECOCROP](https://gaez.fao.org/pages/ecocrop) | Candidate agronomic reference. The FAO portal describes plant and environmental descriptors for more than 2,000 plant species, including temperature, annual precipitation, soil pH, and other environment factors. No crop-level values are included here. | The portal page supplies no verified data license or dated release. Check terms, crop identity, and descriptor provenance before using any value. |
| [HarvestStat Africa v1.2 boundaries](https://github.com/HarvestStat/HarvestStat-Africa/tree/v1.2/public) | Pinned GeoPackage `hvstat_africa_boundary_v1.2.gpkg`, 1,128 administrative polygons, EPSG:4326 / WGS 84; joined by FNID to the historical coverage index, which contains 1,041 distinct FNIDs. The source feature level is admin 1 or 2; no uniform ground-distance resolution is stated. | Upstream repository states MIT for its data. GeoPackage `last_change` is 2026-05-18. FNID coverage denotes historical crop records, not suitability. No parent-area or nearest-neighbor matching is used. |

These are source candidates and a pinned historical coverage index, not a
verified operational evidence stack. There is no country allowlist, no local
climate/soil extraction, no verified field-level or district-level service
coverage, and no agronomic threshold set. The API contract remains authoritative
about unsupported locations and insufficient evidence.

The pinned boundary GeoPackage is included at
[`data/catalog/v1/hvstat_africa_boundary_v1.2.gpkg`](../data/catalog/v1/hvstat_africa_boundary_v1.2.gpkg).
Its source artifact URL, Git blob SHA, license, CRS, and limitations are
recorded under `harveststat-boundaries-v1-2` in `catalog.json`. Coordinate
matching is implemented by `scripts/resolve_location.py`; it rejects points on
boundaries or overlapping polygons as ambiguous and rejects areas absent from
the historical coverage index. It does not persist or log coordinates.

## Regenerating the HarvestStat coverage index

Download `hvstat_africa_data_v1.2.csv` from the version-pinned
[v1.2 public directory](https://github.com/HarvestStat/HarvestStat-Africa/tree/v1.2/public)
and run from the repository root. The builder checks the file against the
recorded Git blob SHA before generating output:

```sh
python3 scripts/build_catalog.py --harveststat-csv /path/to/hvstat_africa_data_v1.2.csv
```

The standard-library builder aggregates by FNID, exact product label, and
season label; it does not retain production, area, yield, or raw source rows.
`admin_2` values equal to the source sentinel `none` are normalized to an empty
value and `admin_level: 1`. Month lists and quality-flag counts are serialized
as JSON within CSV cells. No external package is required.

## Profile and coverage conventions

- `crop_id` values in this catalog are pinned-source identifiers, not
  canonical taxonomy IDs. A later taxonomy mapping should be explicit and
  traceable rather than merging labels by guesswork.
- Every agronomic profile property carries a status (`sourced`, `proposed`, or
  `missing`) and source IDs. A sourced value requires traceable source
  provenance; missing values remain null or empty.
- Regional coverage is a source inventory indexed by country, FNID, crop label,
  and season. It does not contain suitability values or underlying production
  measurements.
- New regional sources should record provenance, spatial and temporal
  resolution, data/version date, retrieval date, terms/license, and limitations.
  Coverage summaries should preserve missingness and never interpolate an
  unsupported location silently.

A small query using Python's standard library:

```python
import csv

with open("data/catalog/v1/harveststat-coverage-v1.2.csv", newline="") as file:
    rows = csv.DictReader(file)
    matches = [
        row for row in rows
        if row["country_code"] == "AO"
        and row["fnid"] == "AO2008A101"
        and row["crop_label"] == "Maize"
        and row["season_name"] == "Main"
    ]
```

## References and access dates

All linked source documentation and terms were reviewed on 2026-11-17. See
`catalog.json` for machine-readable citations and the exact pinned file
references. Key citations:

- Lee, D. et al. (2025). *HarvestStat Africa – Harmonized Subnational Crop
  Statistics for Sub-Saharan Africa*. Scientific Data 12, 690.
  [doi:10.1038/s41597-025-05001-z](https://doi.org/10.1038/s41597-025-05001-z).
- Poggio, L. et al. (2021). *SoilGrids 2.0: producing soil information for the
  globe with quantified spatial uncertainty*. SOIL 7, 217–240.
  [doi:10.5194/soil-7-217-2021](https://doi.org/10.5194/soil-7-217-2021).
- Climate Hazards Center. (2025). *CHIRPS3 Data Repository*.
  [doi:10.15780/G2JQ0P](https://doi.org/10.15780/G2JQ0P).
