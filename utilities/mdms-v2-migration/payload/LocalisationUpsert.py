from pydantic import BaseModel
from typing import List
from payload import RequestInfo as r

class LocalizationList(BaseModel):
    code: str
    message: str
    module: str
    locale: str

class LocalisationUpsertBody(BaseModel):
    RequestInfo: r.RequestInfo
    tenantId: str
    messages: List[LocalizationList]
