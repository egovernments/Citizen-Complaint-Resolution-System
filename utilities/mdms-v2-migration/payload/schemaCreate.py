from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any, Union

from payload import RequestInfo as r

# Define the model for a property within the schema definition
# class SchemaProperty(BaseModel):
#     type: Union[str, Any, List[Any]]

# Define the model for the 'definition' part of SchemaDefinition.
# Note: We use Field with alias to handle keys that are not valid Python identifiers.
class Definition(BaseModel):
    type: str
    title: Optional[str] = "Generated schema for Root"
    schema_: str = Field(..., alias="$schema")
    required: List[str]
    x_unique: List[str] = Field(..., alias="x-unique")
    properties: Dict[str, Any]
    additionalProperties: Optional[bool] = False
    x_ref_schema: List[Any] = Field(default_factory=list, alias="x-ref-schema")

# Define the model for SchemaDefinition
class SchemaDefinition(BaseModel):
    tenantId: str
    code: str
    description: str
    definition: Definition
    isActive: bool

# Define the root model that includes both RequestInfo and SchemaDefinition
class SchemaCreate(BaseModel):
    RequestInfo: r.RequestInfo
    SchemaDefinition: SchemaDefinition
