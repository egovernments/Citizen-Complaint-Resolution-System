export const additionalDetails = {
  "head": "CS_COMPLAINT_DETAILS_ADDITIONAL_DETAILS",
  "body": [
    {
      "label": "CS_COMPLAINT_DETAILS_ADDITIONAL_DETAILS_DESCRIPTION",
      "isMandatory": true,
      "type": "textarea",
      "key": "ComplaintDescription",
      "populators": {
        "name": "description",
        "maxLength": 1000,
        "validation": {
          "required": true
        },
        "error": "CORE_COMMON_REQUIRED_ERRMSG"
      }
    }
  ]
}