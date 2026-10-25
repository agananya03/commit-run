.PHONY: dev test generate-models

dev:
	uvicorn app.main:app --reload --port 8000

test:
	pytest -v tests

generate-models:
	datamodel-codegen --input ../shared/schemas/json/meridian.schema.json --input-file-type jsonschema --output-model-type pydantic_v2.BaseModel --use-annotated --field-constraints --output app/models/contracts.py
