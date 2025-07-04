import json
from localisation import SchemaProcessor
import migrate_localisations

FILE_PATH = "MDMS_Localizations.json"
TENANT = "pg"

loc_obj=SchemaProcessor(path="schema/TL.json")
loc_obj.generateLocalisations(module="rainmaker-workbench", locale="en_IN")

# Localisations=loc_obj.LocalisationsList

with open(FILE_PATH, 'w') as file:
    file.write(json.dumps(loc_obj.LocalisationsList))

migrate_localisations.upsert_localisation(FILE_PATH, TENANT)

