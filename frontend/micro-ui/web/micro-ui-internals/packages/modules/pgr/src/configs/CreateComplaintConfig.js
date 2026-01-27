export const CreateComplaintConfig = {
  tenantId: Digit.ULBService.getCurrentTenantId(),
  moduleName: "RAINMAKER-PGR",
  CreateComplaintConfig: [
    {
      form: [
        {
          head: "ES_CREATECOMPLAINT_PROVIDE_COMPLAINANT_DETAILS",
          body: [
            {
              inline: true,
              label: "COMPLAINTS_COMPLAINANT_CONTACT_NUMBER",
              isMandatory: true,
              type: "mobileNumber",
              disable: false,
              populators: {
                name: "ComplainantContactNumber",
                error: "CORE_COMMON_MOBILE_ERROR",
                // componentInFront: "+91",
                // prefix:"+91",
                validation: {
                  required: true,
                  // minLength: 10,
                  // maxLength: 10,
                  // min: 6000000000,
                  // max: 9999999999
                }, // 10-digit phone number validation
              },
            },
            {
              inline: true,
              label: "COMPLAINTS_COMPLAINANT_NAME",
              isMandatory: true,
              type: "text",
              key: "ComplainantName",
              disable: false,
              populators: {
                name: "ComplainantName",
                error: "CORE_COMMON_REQUIRED_ERRMSG",
                validation: {
                  required: true,
                  pattern: /^(?!.*[ _-]{2})(?!^[\s_-])(?!.*[\s_-]$)(?=^[A-Za-z][A-Za-z0-9 _\-\(\)]{4,29}$)^.*$/,
                }
              },
            },

          ],
        },
        {
          head: "CS_COMPLAINT_DETAILS_COMPLAINT_DETAILS",
          body: [
            {
              isMandatory: true,
              key: "SelectComplaintType",
              type: "dropdown",
              label: "CS_COMPLAINT_DETAILS_COMPLAINT_TYPE",
              disable: false,
              preProcess: {
                updateDependent: ["populators.options"]
              },
              populators: {
                name: "SelectComplaintType",
                optionsKey: "menuPathName",
                error: "CORE_COMMON_REQUIRED_ERRMSG",
              },
            },
            {
              isMandatory: true,
              key: "SelectSubComplaintType",
              type: "dropdown",
              label: "CS_COMPLAINT_DETAILS_SUB_COMPLAINT_TYPE",
              disable: false,
              preProcess: {
                updateDependent: ["populators.options"]
              },
              populators: {
                name: "SelectSubComplaintType",
                optionsKey: "i18nKey",
                error: "CORE_COMMON_REQUIRED_ERRMSG",
              },
            },

          ],
        },
        // {
        //   head: "CS_COMPLAINT_DETAILS_COMPLAINT_DETAILS",
        //   body: [
        //     // {
        //     //   isMandatory: true,
        //     //   key: "SelectComplaintType",
        //     //   type: "dropdown",
        //     //   label: "CS_COMPLAINT_DETAILS_COMPLAINT_TYPE",
        //     //   disable: false,
        //     //   preProcess : {
        //     //     updateDependent : ["populators.options"]
        //     //   },
        //     //   populators: {
        //     //     name: "SelectComplaintType",
        //     //     optionsKey: "i18nKey",
        //     //     error: "CORE_COMMON_REQUIRED_ERRMSG",
        //     //   },
        //     // },
        //     // {
        //     //   inline: true,
        //     //   label: "CS_COMPLAINT_DETAILS_COMPLAINT_DATE",
        //     //   isMandatory: true,
        //     //   key: "ComplaintDate",
        //     //   type: "date", // Input type is date picker
        //     //   disable: false,
        //     //   preProcess : {
        //     //     updateDependent : ["populators.validation.max"]
        //     //   },
        //     //   populators: {
        //     //     name: "ComplaintDate",
        //     //     required: true,
        //     //     validation:{
        //     //       max: "currentDate"
        //     //     },
        //     //     error: "CORE_COMMON_REQUIRED_ERRMSG"
        //     //   },
        //     // },
        //     {
        //       type: "component",
        //       isMandatory: true,
        //       component: "PGRBoundaryComponent",
        //       key: "SelectedBoundary",
        //       label: "Boundary",
        //       populators: {
        //         name: "SelectedBoundary",
        //       },
        //     }
        //   ],
        // },

        {
          head: "CS_COMPLAINT_LOCATION_DETAILS",
          body: [
           /* {
              inline: true,
              label: "CS_COMPLAINT_POSTALCODE__DETAILS",
              type: "number",
              disable: false,
              populators: {
                name: "postalCode",
                required: true,
                validation: {
                  minLength: 6,
                  maxLength: 6,
                  pattern: /^[1-9][0-9]{5}$/i,

                },
                error: "CORE_COMMON_REQUIRED_ERRMSG",
              },
            },*/

            {
              isMandatory: true,
              key: "SelectCity",
              type: "dropdown",
              label: "CS_COMPLAINT_SELECT_CITY",
              disable: false,
              preProcess: {
                updateDependent: ["populators.options"]
              },
              populators: {
                name: "SelectCity",
                optionsKey: "i18nKey",
                error: "CORE_COMMON_REQUIRED_ERRMSG",
              },
            },


            {
              isMandatory: true,
              key: "SelectLocality",
              type: "dropdown",
              label: "CS_COMPLAINT_LOCALITY",
              disable: false,
              preProcess: {
                updateDependent: ["populators.options"]
              },
              populators: {
                name: "SelectLocality",
                optionsKey: "i18nKey",
                error: "CORE_COMMON_REQUIRED_ERRMSG",
              },
            },
            {
              inline: true,
              label: "CS_COMPLAINT_LANDMARK__DETAILS",
              isMandatory: false,
              type: "textarea",
              disable: false,
              populators: {
                name: "landmark",
                maxLength: 1000,
              },
            },

          ],
        },

        {
          head: "CS_COMPLAINT_DETAILS_ADDITIONAL_DETAILS",
          body: [
            {
              label: "CS_COMPLAINT_DETAILS_ADDITIONAL_DETAILS_DESCRIPTION",
              isMandatory: true,
              type: "textarea",
              key: "ComplaintDescription",
              populators: {
                name: "description",
                maxLength: 1000,
                validation: {
                  required: true,
                  pattern: /^(?!\s*$).+/,
                },
                error: "CORE_COMMON_REQUIRED_ERRMSG",
              },
            },
          ],
        },

{
  "head": "CS_ADDCOMPLAINT_UPLOAD_PHOTO",
  "body": [
    {
      "type": "component",
      "isMandatory": false,
      "component": "SelectImages",
      "key": "ComplaintImagesPoint",
      "label": "CS_ADDCOMPLAINT_UPLOAD_PHOTO_TEXT",
      "populators": {
        "name": "ComplaintImagesPoint"
      }
    },

  ]

},

        

      ],
    }
  ],
}
