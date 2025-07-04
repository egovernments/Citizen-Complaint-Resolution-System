"""egov-user request dataclass"""
from dataclasses import dataclass
from typing import List,Optional

@dataclass
class LoginPayload:
    username: str
    password: str
    tenantId: str
    userType: str
    grant_type: str = 'password'
    scope: str = 'read'
