import SelectComplaintType from "../Steps/SelectComplaintType";

export const selectComplaintType = {
    "head": "ES_CREATECOMPLAINT_COMPLAINANT_TYPE",
    "body": [
        {
            "isMandatory": true,
            "type": "radio",
            "key": "complaintType",
            "label": "ES_CREATECOMPLAINT_FOR",
            "disable": false,
            "populators": {
                "name": "complaintType",
                "optionsKey": "name",
                "styles": {
                    "maxWidth": "37.5rem",
                    "disaplay": "flex",
                    "flexDirection":"column"

                },
                "validation": {
                    "required": true
                },
                "error": "CORE_COMMON_REQUIRED_ERRMSG",
                "required": true,
                "options": [
                    {
                        "name": "MYSELF",
                        "code": "MYSELF"
                    },
                    {
                        "name": "ANOTHER_USER",
                        "code": "ANOTHER_USER"
                    },
                ]
            }
        }
    
    ]
};