from pydantic import BaseModel, ConfigDict, Field


class SeverityRequest(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "complaint_id": "2024-297EJL",
                "description": "Stray dogs are attacking children near the school",
            }
        }
    )

    complaint_id: str | None = Field(None, description="Echoed back in the response.")
    description: str = Field(
        ...,
        min_length=1,
        description="Raw complaint text (English or Tamil); cleaned server-side. "
        "This is the only model input. Other fields, such as a complaint type, are ignored.",
    )


class SeverityResponse(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "complaint_id": "2024-297EJL",
                "severity": "Critical",
                "severity_id": 3,
                "confidence": 0.96,
                "probabilities": {"Low": 0.01, "Medium": 0.01, "High": 0.02, "Critical": 0.96},
                "needs_review": False,
                "model_version": "catboost_desc_only-cv5-2026-11-08",
            }
        }
    )

    complaint_id: str | None = None
    severity: str = Field(..., description="Low | Medium | High | Critical")
    severity_id: int = Field(..., description="0=Low, 1=Medium, 2=High, 3=Critical")
    confidence: float = Field(..., description="Probability of the returned severity.")
    probabilities: dict[str, float]
    needs_review: bool = Field(..., description="True when confidence is below the review threshold.")
    model_version: str


class BatchRequest(BaseModel):
    items: list[SeverityRequest] = Field(..., min_length=1)


class BatchResponse(BaseModel):
    results: list[SeverityResponse]


class HealthResponse(BaseModel):
    status: str
    model_version: str
    review_threshold: float
