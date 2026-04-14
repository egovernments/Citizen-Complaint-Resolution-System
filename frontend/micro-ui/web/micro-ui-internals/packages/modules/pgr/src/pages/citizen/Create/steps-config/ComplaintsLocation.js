
export const complaintsLocation = {
  "head": "CS_ADDCOMPLAINT_COMPLAINT_LOCATION",
  "body": [
    {
      "key": "SelectAddress",
      "type": "boundary",
      "inline": false,
      "disable": false,
      "populators": {
        validation: { required: true },
        error: "CORE_COMMON_REQUIRED_ERRMSG",
        "fieldPairClassName": "boundary-filter-label-left-align",
        "name": "boundaryComponent",
        "levelConfig": {
          "lowestLevel": window?.globalConfigs?.getConfig("PGR_BOUNDARY_LOWEST_LEVEL") || "Locality",
          "highestLevel": window?.globalConfigs?.getConfig("PGR_BOUNDARY_HIGHEST_LEVEL") || "City",
          isSingleSelect: [
            window?.globalConfigs?.getConfig("PGR_BOUNDARY_LOWEST_LEVEL") || "Locality",
            window?.globalConfigs?.getConfig("PGR_BOUNDARY_HIGHEST_LEVEL") || "City",
            "Ward",
          ]
        },
        "layoutConfig": {
          "isDropdownLayoutHorizontal": true,
          "isLabelFieldLayoutHorizontal": true

        },
        "hierarchyType": "ADMIN",
        "noCardStyle": false,
        "module": "CMS-BOUNDARY"
      }
    },

  ]
}