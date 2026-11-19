FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Copy only the files needed by the runtime, including the pinned data.
COPY main.py /app/main.py
COPY scripts/ /app/scripts/
COPY data/catalog/v1/catalog.json /app/data/catalog/v1/catalog.json
COPY data/catalog/v1/harveststat-coverage-v1.2.csv /app/data/catalog/v1/harveststat-coverage-v1.2.csv
COPY data/catalog/v1/hvstat_africa_boundary_v1.2.gpkg /app/data/catalog/v1/hvstat_africa_boundary_v1.2.gpkg

EXPOSE 8000
CMD ["python", "main.py"]
