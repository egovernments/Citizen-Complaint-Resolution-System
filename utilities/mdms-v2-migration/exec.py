from migrate_schema import *
from migrate_data import *

#create_schema("schema/TL.json", tenantId="pg")
# create_all_schema("schema", tenantId="pg")
# create_all_schema("schema", tenantId="pg", is_portforward=True)


# create_data("data/TL/TradeLicense.CalculationType.json", tenantId="pg.cityc")
create_all_data("data/Workflow", tenantId="pg")
# create_all_data("data", tenantId="pg", is_portforward=False)