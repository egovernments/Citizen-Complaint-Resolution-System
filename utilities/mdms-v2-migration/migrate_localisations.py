import json
from urllib.parse import urljoin
from pathlib import Path

import utils
from payload import LocalisationUpsert

URL = utils.get_env()["host"]
LOCAL_URL = utils.get_env()["localhost"]
ENDPOINTS = utils.get_api()["Localisation"]
REQINFO = utils.get_reqInfo()

def upsert_localisation(loc_file_path, tenantId, is_portforward = True):

    base_url = LOCAL_URL if is_portforward else URL
    
    base_url = base_url + ENDPOINTS["upsert"]

    with open(loc_file_path) as f:
        loc_data = json.load(f)

    body = LocalisationUpsert.LocalisationUpsertBody(RequestInfo=REQINFO, 
                            messages=loc_data, tenantId=tenantId).model_dump(by_alias=True)

    response = utils.make_request(method="POST",
                    url=base_url,
                    payload=body)

    utils.log_response(response)

    # print(response.request.body, type(response.request.body))
    # print(base_url, "\n", schema["code"], "\n")
