#!/usr/bin/env python3
"""Small history-only HTTP API for the crop advisory MVP."""

from __future__ import annotations

import csv
import json
import logging
import os
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

if __package__:
    from .resolve_location import (
        AmbiguousLocation,
        BoundaryDataError,
        HarvestStatLocationResolver,
        InvalidCoordinates,
        UnsupportedLocation,
    )
else:
    from resolve_location import (
        AmbiguousLocation,
        BoundaryDataError,
        HarvestStatLocationResolver,
        InvalidCoordinates,
        UnsupportedLocation,
    )


ROOT = Path(__file__).resolve().parents[1]
CATALOG_PATH = ROOT / "data/catalog/v1/catalog.json"
COVERAGE_PATH = ROOT / "data/catalog/v1/harveststat-coverage-v1.2.csv"
COVERAGE_SOURCE_ID = "harveststat-africa-v1-2"
MAX_REQUEST_BYTES = 16 * 1024
DEFAULT_CORS_ORIGINS = (
    "https://tyala-africa-pwa-production.up.railway.app",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
)
LOGGER = logging.getLogger(__name__)


class ApiError(Exception):
    def __init__(
        self,
        status: int,
        code: str,
        message: str,
        details: list[dict[str, str]] | None = None,
        *,
        retryable: bool = False,
    ) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.details = details or []
        self.retryable = retryable


class CropApi:
    def __init__(self) -> None:
        catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
        self.crop_ids = {
            profile["crop_id"] for profile in catalog["crop_profiles"]
        }
        self.crop_labels = {
            profile["crop_id"]: profile["common_name"]
            for profile in catalog["crop_profiles"]
        }
        self.covered_crop_areas: set[tuple[str, str]] = set()
        self.coverage_by_area: dict[str, dict[str, list[dict[str, Any]]]] = {}
        with COVERAGE_PATH.open(newline="", encoding="utf-8") as coverage_file:
            reader = csv.DictReader(coverage_file)
            required = {
                "source_id",
                "crop_id",
                "crop_label",
                "fnid",
                "season_name",
                "planting_months",
                "harvest_months",
                "record_count",
            }
            if not required.issubset(reader.fieldnames or []):
                raise ValueError("HarvestStat coverage index is missing required columns.")
            for row in reader:
                if (
                    row["source_id"] != COVERAGE_SOURCE_ID
                    or row["crop_id"] not in self.crop_ids
                    or not row["fnid"]
                ):
                    raise ValueError("HarvestStat coverage index has an invalid entry.")
                self.crop_labels.setdefault(row["crop_id"], row["crop_label"])
                self.covered_crop_areas.add((row["crop_id"], row["fnid"]))
                observation = self._parse_observation(row)
                self.coverage_by_area.setdefault(row["fnid"], {}).setdefault(
                    row["crop_id"], []
                ).append(observation)
        self.location_resolver = HarvestStatLocationResolver()

    @staticmethod
    def _parse_observation(row: dict[str, str]) -> dict[str, Any]:
        try:
            planting_months = [int(month) for month in json.loads(row["planting_months"])]
            harvest_months = [int(month) for month in json.loads(row["harvest_months"])]
            record_count = int(row["record_count"])
        except (ValueError, TypeError, json.JSONDecodeError) as error:
            raise ValueError(
                "HarvestStat coverage index has a malformed calendar or record entry."
            ) from error
        if (
            not row["season_name"]
            or not planting_months
            or not harvest_months
            or any(month < 1 or month > 12 for month in planting_months + harvest_months)
            or record_count < 1
        ):
            raise ValueError("HarvestStat coverage index has a malformed calendar or record entry.")
        return {
            "season_name": row["season_name"],
            "planting_months": planting_months,
            "harvest_months": harvest_months,
            "record_count": record_count,
        }

    @staticmethod
    def _validate_fields(
        payload: Any, required_fields: set[str], field_name: str
    ) -> dict[str, Any]:
        if not isinstance(payload, dict) or set(payload) != required_fields:
            raise ApiError(
                422,
                "validation_error",
                "The request contains invalid or conflicting fields.",
                [{"field": field_name, "issue": "Required fields are missing or unexpected fields were supplied."}],
            )
        return payload

    def _resolve(self, location: Any):
        location = self._validate_fields(
            location, {"latitude", "longitude"}, "location"
        )
        try:
            return self.location_resolver.resolve(
                location["latitude"], location["longitude"]
            )
        except InvalidCoordinates:
            raise ApiError(
                422,
                "validation_error",
                "The request contains invalid or conflicting fields.",
                [{"field": "location", "issue": "Provide valid WGS 84 latitude and longitude."}],
            ) from None
        except UnsupportedLocation:
            raise ApiError(
                422,
                "unsupported_location",
                "No exact supported administrative area contains this location.",
            ) from None
        except AmbiguousLocation:
            raise ApiError(
                422,
                "ambiguous_location",
                "This location falls on an ambiguous administrative boundary.",
            ) from None
        except BoundaryDataError:
            raise ApiError(
                503,
                "service_unavailable",
                "The pinned boundary data is temporarily unavailable.",
                retryable=True,
            ) from None

    @staticmethod
    def _area_payload(area) -> dict[str, Any]:
        return {
            "fnid": area.fnid,
            "country_code": area.country_code,
            "country": area.country,
            "admin_level": area.admin_level,
            "admin_1": area.admin_1,
            "admin_2": area.admin_2,
            "boundary_source": {
                "id": area.boundary_source_id,
                "version": area.boundary_version,
            },
        }

    def resolve_location(self, payload: Any) -> dict[str, Any]:
        payload = self._validate_fields(payload, {"location"}, "request")
        area = self._resolve(payload["location"])
        return {"resolved_location": self._area_payload(area)}

    def recommend(self, payload: Any) -> dict[str, Any]:
        if not isinstance(payload, dict) or set(payload) not in (
            {"location"},
            {"location", "crop_id"},
        ):
            raise ApiError(
                422,
                "validation_error",
                "The request contains invalid or conflicting fields.",
                [
                    {
                        "field": "request",
                        "issue": "Provide location with an optional catalog crop ID, or location alone to list crop options.",
                    }
                ],
            )
        crop_id = payload.get("crop_id")
        if "crop_id" in payload and (not isinstance(crop_id, str) or not crop_id):
            raise ApiError(
                422,
                "validation_error",
                "The request contains invalid or conflicting fields.",
                [{"field": "crop_id", "issue": "Provide a catalog crop ID."}],
            )
        area = self._resolve(payload["location"])
        if "crop_id" in payload:
            self._recommend_single_crop(area, crop_id)
        return self._crop_options(area)

    def _recommend_single_crop(self, area, crop_id: str) -> None:
        if crop_id not in self.crop_ids:
            raise ApiError(
                422,
                "insufficient_evidence",
                "No verified catalog mapping is available for this crop.",
                [{"field": "crop_id", "issue": "The crop ID is not in the versioned catalog."}],
            )
        if (crop_id, area.fnid) not in self.covered_crop_areas:
            raise ApiError(
                422,
                "insufficient_evidence",
                "No historical records for this crop are indexed at this location.",
                [{"field": "data", "issue": "The exact administrative area has no indexed records for this crop."}],
            )
        raise ApiError(
            422,
            "insufficient_evidence",
            "Historical records do not support a defensible prevalence estimate or planting recommendation.",
            [
                {
                    "field": "data.prevalence",
                    "issue": "The catalog has no validated comparable-area denominator.",
                },
                {
                    "field": "data.evidence_band",
                    "issue": "Evidence thresholds have not been validated.",
                },
                {
                    "field": "data.planting_window",
                    "issue": "HarvestStat calendar fields distinguish reported seasons; they are not phenological timing.",
                },
            ],
        )

    def _crop_options(self, area) -> dict[str, Any]:
        observations = self.coverage_by_area.get(area.fnid, {})
        if not observations:
            raise ApiError(
                422,
                "insufficient_evidence",
                "No historical crop records are indexed for this administrative area.",
                [
                    {
                        "field": "data.crop_options",
                        "issue": "The exact administrative area has no indexed crop records.",
                    }
                ],
            )
        options: list[dict[str, Any]] = []
        for crop_id in sorted(
            observations, key=lambda key: (self.crop_labels[key].casefold(), key)
        ):
            rows = observations[crop_id]
            record_count = sum(row["record_count"] for row in rows)
            seasons_observed = [
                {
                    "season_name": row["season_name"],
                    "planting_months": row["planting_months"],
                    "harvest_months": row["harvest_months"],
                }
                for row in sorted(rows, key=lambda row: row["season_name"])
            ]
            options.append(
                {
                    "crop_id": crop_id,
                    "crop_label": self.crop_labels[crop_id],
                    "summary": {
                        "record_count": record_count,
                        "seasons_observed": seasons_observed,
                    },
                    "evidence_hint": (
                        f"{record_count} source record"
                        f"{'' if record_count == 1 else 's'} across "
                        f"{len(seasons_observed)} reported season"
                        f"{'' if len(seasons_observed) == 1 else 's'}."
                    ),
                }
            )
        return {
            "resolved_location": self._area_payload(area),
            "options": options,
            "notes": [
                "Options are crops with historical records in the pinned HarvestStat Africa v1.2 coverage index for this exact administrative area; this is not a suitability ranking or recommendation.",
                "Record counts are raw source record counts; no prevalence, share, or ranking is computed.",
                "HarvestStat season and month fields describe reported seasons; they are not phenological timing.",
                "Absence from this list means no indexed historical record in the pinned release; it does not mean the crop is absent or unsuitable.",
            ],
        }


class ApiHandler(BaseHTTPRequestHandler):
    server_version = "CropAdvisoryAPI/1"
    sys_version = ""

    @property
    def app(self) -> CropApi:
        return self.server.app  # type: ignore[attr-defined]

    def _headers(self, request_id: str) -> None:
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Request-Id", request_id)
        self.send_header("Vary", "Origin")
        origin = self.headers.get("Origin")
        if origin in self.server.allowed_origins:
            self.send_header("Access-Control-Allow-Origin", origin)

    def _allow_origin(self, request_id: str) -> bool:
        origin = self.headers.get("Origin")
        if origin is None or origin in self.server.allowed_origins:
            return True
        self._send_error(
            ApiError(403, "forbidden_origin", "This browser origin is not allowed."),
            request_id,
        )
        return False

    def _send_json(self, status: int, payload: dict[str, Any], request_id: str) -> None:
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self._headers(request_id)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_error(self, error: ApiError, request_id: str) -> None:
        self._send_json(
            error.status,
            {
                "error": {
                    "code": error.code,
                    "message": error.message,
                    "details": error.details,
                    "request_id": request_id,
                    "retryable": error.retryable,
                }
            },
            request_id,
        )

    def _read_json(self) -> Any:
        if self.headers.get_content_type().lower() != "application/json":
            raise ApiError(
                415,
                "unsupported_media_type",
                "Content-Type must be application/json.",
            )
        try:
            length = int(self.headers.get("Content-Length", ""))
        except ValueError:
            raise ApiError(400, "bad_request", "A valid Content-Length is required.") from None
        if length < 0 or length > MAX_REQUEST_BYTES:
            raise ApiError(400, "bad_request", "The request body is invalid or too large.")
        raw_body = self.rfile.read(length)
        if len(raw_body) != length:
            raise ApiError(400, "bad_request", "The request body is incomplete.")
        try:
            return json.loads(raw_body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise ApiError(400, "bad_request", "The request body must be valid JSON.") from None

    def do_GET(self) -> None:
        request_id = uuid.uuid4().hex
        if not self._allow_origin(request_id):
            return
        if self.path != "/healthz":
            self._send_error(
                ApiError(404, "bad_request", "The requested API route was not found."),
                request_id,
            )
            return
        self._send_json(200, {"status": "ok", "request_id": request_id}, request_id)

    def do_POST(self) -> None:
        request_id = uuid.uuid4().hex
        if not self._allow_origin(request_id):
            return
        try:
            payload = self._read_json()
            if self.path == "/v1/locations/resolve":
                result = self.app.resolve_location(payload)
                result["request_id"] = request_id
                self._send_json(200, result, request_id)
            elif self.path == "/v1/recommendations":
                result = self.app.recommend(payload)
                result["request_id"] = request_id
                self._send_json(200, result, request_id)
            else:
                raise ApiError(404, "bad_request", "The requested API route was not found.")
        except ApiError as error:
            self._send_error(error, request_id)
        except Exception:
            LOGGER.exception("API request failed")
            self._send_error(
                ApiError(500, "internal_error", "The request could not be completed."),
                request_id,
            )

    def do_OPTIONS(self) -> None:
        request_id = uuid.uuid4().hex
        if not self._allow_origin(request_id):
            return
        self.send_response(204)
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Request-Id", request_id)
        self.send_header("Vary", "Origin")
        origin = self.headers.get("Origin")
        if origin in self.server.allowed_origins:
            self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def log_message(self, format: str, *args: Any) -> None:
        return


class ApiHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, address: tuple[str, int], app: CropApi) -> None:
        self.app = app
        configured = os.environ.get("CORS_ALLOWED_ORIGINS")
        entries = DEFAULT_CORS_ORIGINS if configured is None else configured.split(",")
        self.allowed_origins = frozenset(origin.strip() for origin in entries if origin.strip())
        if not self.allowed_origins:
            raise ValueError("CORS_ALLOWED_ORIGINS must include at least one browser origin.")
        super().__init__(address, ApiHandler)


def main() -> None:
    logging.basicConfig(level=logging.ERROR)
    port = int(os.environ.get("PORT", "8000"))
    if not 1 <= port <= 65535:
        raise ValueError("PORT must be between 1 and 65535.")
    app = CropApi()
    server = ApiHTTPServer(("0.0.0.0", port), app)
    LOGGER.info("API listening on port %d", port)
    server.serve_forever()


if __name__ == "__main__":
    main()
