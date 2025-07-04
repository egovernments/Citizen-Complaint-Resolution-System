import os
import json
import utils  # Assuming utils is your helper module

class SchemaProcessor:
    def __init__(self, path):
        """
        Initializes the SchemaProcessor to process a JSON schema file or directory.

        Args:
            path (str): Path to a specific JSON file or a directory containing JSON schema files.

        Attributes:
            SchemaFiles (list): List of JSON file paths to process.
            ModuleList (set): Unique set of module names (uppercase) extracted from JSON codes.
            ModuleNameMap (dict): Mapping of uppercase module names to their original case versions.
            SchemaData (list): Stores tuples of (module_upper, master_upper, module_original, master_original, schema_obj).
            LocalisationsList (list): Stores localization dictionary objects.
        """
        self.SchemaFiles = []
        self.ModuleList = set()
        self.ModuleNameMap = {}  # Stores mapping of UPPERCASE module names to original names
        self.SchemaData = []
        self.LocalisationsList = []

        # Load JSON schema files
        self._load_schema_files(path)
        self._process_schema_files()

    def _load_schema_files(self, path):
        """Loads JSON schema file paths from a directory or a single file."""
        if os.path.isdir(path):
            self.SchemaFiles = [entry.path for entry in os.scandir(path) if entry.is_file() and entry.name.endswith(".json")]
        elif os.path.isfile(path) and path.endswith(".json"):
            self.SchemaFiles.append(path)
        else:
            raise ValueError("Invalid path: Provide a JSON file or a directory containing JSON files.")

    def _process_schema_files(self):
        """Reads and processes JSON schema files to extract module and master names."""
        for file_path in self.SchemaFiles:
            with open(file_path, "r", encoding="utf-8") as file:
                try:
                    data = json.load(file)
                    if isinstance(data, list):
                        for obj in data:
                            if "code" in obj and "." in obj["code"]:
                                module_original, master_original = obj["code"].split(".", 1)

                                module_upper = module_original.upper()
                                master_upper = master_original.upper()

                                # Store module details
                                self.ModuleList.add(module_upper)
                                self.ModuleNameMap[module_upper] = module_original
                                self.SchemaData.append((module_upper, master_upper, module_original, master_original, obj))
                except json.JSONDecodeError:
                    print(f"Error reading JSON file: {file_path}")

    def generateLocalisations(self, module, locale):
        """
        Generates localization entries for all schema data.

        Args:
            module (str): The target module for localization.
            locale (str): The target language/region for localization.
        """
        SCHEMA_PREFIX = "SCHEMA_"
        MASTER_PREFIX = "WBH_MDMS_MASTER_"
        MODULE_PREFIX = "WBH_MDMS_"
        
        unique_array_keys = set()  # Stores unique array-type field names

        # Generate master-level localizations
        for mod_upper in self.ModuleList:
            mod_original = self.ModuleNameMap.get(mod_upper, mod_upper)  # Fetch original case
            code = utils.formatCode(MASTER_PREFIX, mod_upper)
            self.generateLocalisationArray(code, mod_original, module, locale)  # Use original as message

        # Generate localizations for each schema
        for module_upper, master_upper, module_original, master_original, schema_obj in self.SchemaData:
            sub_prefix = f"{module_upper}_{master_upper}"

            # Generate module-level localization
            code = utils.formatCode(MODULE_PREFIX, sub_prefix)
            self.generateLocalisationArray(code, master_original, module, locale)

            # Generate schema-level localization
            code = utils.formatCode(SCHEMA_PREFIX, sub_prefix)
            self.generateLocalisationArray(code, master_original, module, locale)

            # Extract field names from schema definition
            master_keys, array_keys = utils.extract_properties_keys(schema_obj.get("definition", {}))

            # Generate field-level localizations
            for key in master_keys:
                code = utils.formatCode(f"{sub_prefix}_", key)
                self.generateLocalisationArray(code, key, module, locale)

            unique_array_keys.update(array_keys)

        # Generate localization entries for array-type fields
        for key in unique_array_keys:
            array_prefix = f"{module_upper}_{module_upper}"
            code = utils.formatCode(f"{array_prefix}_", key)
            self.generateLocalisationArray(code, key, module, locale)

    def generateLocalisationArray(self, code, message, module, locale):
        """
        Stores localization data as a dictionary in LocalisationsList.

        Args:
            code (str): The formatted localization key (always uppercase).
            message (str): The original message from JSON (retains case).
            module (str): The module associated with the localization entry.
            locale (str): The target localization language/region.
        """
        self.LocalisationsList.append({
            "code": code,
            "message": message,
            "module": module,
            "locale": locale
        })
