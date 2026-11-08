from pydantic import BaseModel, ConfigDict, Field


class SeverityRequest(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "complaint_id": "2024-297EJL",
                "description": "Stray dogs are attacking children near the school",
                "complaint_type": "Street Dogs",
            }
        }
    )

    complaint_id: str | None = Field(None, description="Echoed back in the response.")
    description: str = Field(..., description="Raw complaint text; cleaned server-side.")
    complaint_type: str | None = Field(
        None,
        description="PGR complaint type display name (COMPLAINTTYPENAME), unchanged. "
        "Omitted -> 'Others'. Values unseen in training are scored as an unknown category.",
    )


class SeverityResponse(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "complaint_id": "2024-297EJL",
                "severity": "High",
                "severity_id": 2,
                "confidence": 0.81,
                "probabilities": {"Low": 0.02, "Medium": 0.12, "High": 0.81, "Critical": 0.05},
                "needs_review": False,
                "model_version": "catboost_pgr-2026-10-24",
            }
        }
    )

    complaint_id: str | None = None
    severity: str = Field(..., description="Low | Medium | High | Critical")
    severity_id: int = Field(..., description="0=Low, 1=Medium, 2=High, 3=Critical")
    confidence: float = Field(..., description="Probability of the returned severity.")
    probabilities: dict[str, float]
    needs_review: bool = Field(
        ..., description="True when confidence is below the review threshold."
    )
    model_version: str


class BatchRequest(BaseModel):
    items: list[SeverityRequest] = Field(..., min_length=1)


class BatchResponse(BaseModel):
    results: list[SeverityResponse]


class HealthResponse(BaseModel):
    status: str
    model_version: str
    critical_threshold: float
    review_threshold: float
