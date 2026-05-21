
export const createComplaint = {
  "head": "CS_COMPLAINT_DETAILS_COMPLAINT_DETAILS",
  "body": [
    {
      "isMandatory": true,
      "key": "SelectComplaintType",
      "type": "dropdown",
      "label": "CS_COMPLAINT_DETAILS_COMPLAINT_TYPE",
      "disable": false,
      "preProcess": {
        "updateDependent": [
          "populators.options"
        ]
      },
      "populators": {
        "name": "SelectComplaintType",
        "optionsKey": "menuPathName",
        "error": "CORE_COMMON_REQUIRED_ERRMSG",
        "options": []
      }
    },
    {
  "isMandatory": false,
  "key": "SelectSubComplaintType",
  "type": "dropdown",
  "label": "CS_COMPLAINT_DETAILS_COMPLAINT_SUBTYPE",
  "disable": false,
  "populators": {
    "name": "SelectSubComplaintType",
    "optionsKey": "name",
    "options": [],
    "error": "CORE_COMMON_REQUIRED_ERRMSG"
  }
},
    // {
    //   "inline": true,
    //   "label": "CS_COMPLAINT_DETAILS_COMPLAINT_DATE",
    //   "isMandatory": true,
    //   "key": "ComplaintDate",
    //   "type": "date",
    //   "disable": false,
    //   "preProcess": {
    //     "updateDependent": [
    //       "populators.validation.max"
    //     ]
    //   },
    //   "populators": {
    //     "name": "ComplaintDate",
    //     "required": true,
    //     "validation": {
    //       "max": new Date().toISOString().split("T")[0]
    //     },
    //     "error": "CORE_COMMON_REQUIRED_ERRMSG"
    //   }
    // },
    // {
    //   "type": "component",
    //   "isMandatory": true,
    //   "component": "PGRBoundaryComponent",
    //   "key": "SelectedBoundary",
    //   "label": "Boundary",
    //   "populators": {
    //     "name": "SelectedBoundary"
    //   }
    // },

  ]
}