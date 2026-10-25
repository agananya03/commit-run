from __future__ import annotations

from typing import Any, Literal
from pydantic import BaseModel, ConfigDict, Field

from app.models.contracts import Citation


class ErrorDetail(BaseModel):
    model_config = ConfigDict(extra="forbid")
    code: str
    message: str


class ApiError(BaseModel):
    model_config = ConfigDict(extra="forbid")
    error: ErrorDetail


class IngestFile(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal["forum", "pdf", "social", "onchain"]
    path: str


class IngestRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    proposalId: str
    files: list[IngestFile]


class SummarizeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    proposalId: str


class ExtractIntentRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    proposalId: str


class SearchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    proposalId: str
    query: str
    k: int = 8


class ExplainRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    proposalId: str
    findings: list[Any] = Field(default_factory=list)


class AskRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    proposalId: str
    question: str


class AskResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    proposalId: str
    question: str
    answer: str
    citations: list[Citation] = Field(default_factory=list)
    refused: bool = False
