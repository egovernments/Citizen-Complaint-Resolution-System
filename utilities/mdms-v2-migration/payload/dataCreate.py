from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any

from payload import RequestInfo as r

# Define the model for SchemaDefinition
class Mdms(BaseModel):
    tenantId: str
    schemaCode: str
    uniqueIdentifier: Optional[Any] = None
    data: Dict[str, Any]
    isActive: bool

# Define the root model that includes both RequestInfo and SchemaDefinition
class DataCreate(BaseModel):
    RequestInfo: r.RequestInfo
    Mdms: Mdms