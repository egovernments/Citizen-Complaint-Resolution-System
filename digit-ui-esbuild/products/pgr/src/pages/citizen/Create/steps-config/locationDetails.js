export const locationDetails = {
  "head": "CS_COMPLAINT_LOCATION_DETAILS",
  // "headerCaption": "CS_ADDCOMPLAINT_COMPLAINT_LOCATION",
  // "header": "CS_FILE_APPLICATION_PINCODE_LABEL",
  // "cardText": "CS_ADDCOMPLAINT_CHANGE_PINCODE_TEXT",
  "body": [
    // {
    //   "inline": true,
    //   "label": "CS_COMPLAINT_DETAILS_ADDRESS_1_DETAILS",
    //   "isMandatory": false,
    //   "type": "text",
    //   "key": "AddressOne",
    //   "disable": false,
    //   "populators": {
    //     "name": "AddressOne",
    //     "maxlength": 64
    //   }
    // },
    // {
    //   "inline": true,
    //   "label": "CS_COMPLAINT_DETAILS_ADDRESS_2_DETAILS",
    //   "isMandatory": false,
    //   "type": "text",
    //   "key": "AddressTwo",
    //   "disable": false,
    //   "populators": {
    //     "name": "AddressTwo",
    //     "maxlength": 64
    //   }
    // },
    {
      "inline": true,
      "label": "CS_COMPLAINT_LANDMARK__DETAILS",
      "isMandatory": false,
      "type": "text",
      "disable": false,
      "populators": {
        "name": "landmark",
        "maxlength": 64
      }
    },
    {
      "inline": true,
      "label": "CS_COMPLAINT_POSTALCODE__DETAILS",
      "isMandatory": false,
      // "text", not "number": the configured postalCodePattern may be alnum
      // or dash-suffixed (see _example.yml), and FormExplorer validates this
      // field against the full pattern via the shared utils/postalCode.js —
      // a number input can't hold those shapes, which would make the field
      // unfillable on such tenants.
      "type": "text",
      "disable": false,
      "populators": {
        "name": "postalCode",
        // Lives under validation.maxlength — RenderFormFields reads
        // populators.validation.maxlength; a bare populators.maxlength is
        // never passed to the input (the old `"maxlength": 7` here was
        // inert, this field never actually had a cap).
        "validation": {
          "maxlength": 16,
        },
      }
    }
  ]
}