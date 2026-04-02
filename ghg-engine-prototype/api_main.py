"""Thin entry point so ``uvicorn api_main:app --reload`` keeps working."""

from api.app import create_app

app = create_app()
