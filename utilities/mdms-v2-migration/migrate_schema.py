import json
from urllib.parse import urljoin
from pathlib import Path

import utils
from payload import schemaCreate

URL = utils.get_env()["host"]
LOCAL_URL = utils.get_env()["localhost"]
ENDPOINTS = utils.get_api()["mdmsv2"]
REQINFO = utils.get_reqInfo()

def create_schema(schema_path, tenantId, is_portforward = True):

    base_url = LOCAL_URL if is_portforward else URL
    
    base_url = base_url + ENDPOINTS["schemaCreate"]

    try:
        with open(schema_path) as f:
            schema_data = json.load(f)
    except FileNotFoundError:
        print(f"Error: Schema file {schema_path} not found")
        return
    except json.JSONDecodeError:
        print(f"Error: Invalid JSON in schema file {schema_path}")
        return

    for schema in schema_data:
        
        schema["tenantId"] = tenantId

        body = schemaCreate.SchemaCreate(RequestInfo=REQINFO, 
                                SchemaDefinition=schema).model_dump(by_alias=True)

        try:
            response = utils.make_request(method="POST",
                            url=base_url,
                            payload=body)
            
            utils.log_response(response)
            
            if response.status_code >= 400:
                print(f"Error creating schema {schema['code']}: {response.text}")
            else:
                print(f"Successfully created schema {schema['code']}")
        except Exception as e:
            print(f"Error making request for schema {schema['code']}: {str(e)}")

def create_all_schema(schema_folder, tenantId, is_portforward = True):

    try:
        path = Path(schema_folder)
        if not path.exists():
            print(f"Error: Directory {schema_folder} does not exist")
            return
        if not path.is_dir():
            print(f"Error: {schema_folder} is not a directory")
            return
            
        for item in path.iterdir():
            if item.is_file():
                create_schema(item, tenantId, is_portforward)
    except Exception as e:
        print(f"Error processing schema directory {schema_folder}: {str(e)}")

# create_schema("schema/pqm.json", tenantId="as")
# create_all_schema("schema", tenantId="as")
