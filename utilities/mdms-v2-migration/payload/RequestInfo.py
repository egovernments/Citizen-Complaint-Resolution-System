from pydantic import BaseModel, Field
from typing import List, Optional, Dict

# Define the model for a role inside userInfo.roles
class Role(BaseModel):
    name: str
    code: str
    tenantId: str

# Define the model for userInfo inside RequestInfo
class UserInfo(BaseModel):
    id: int
    uuid: str
    userName: str
    name: str
    mobileNumber: str
    emailId: Optional[str] = None
    locale: Optional[str] = None
    type: str
    roles: List[Role]
    active: bool
    tenantId: str
    permanentCity: Optional[str] = None

# Define the model for RequestInfo
class RequestInfo(BaseModel):
    apiId: str = "asset-services"
    authToken: str
    userInfo: UserInfo