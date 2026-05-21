export const CreateComplaintConfig = {
  get tenantId() { return Digit.ULBService.getCurrentTenantId(); },
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
                  // CCRS#437: Allow 4-character names (e.g. "John"). The
                  // quantifier counts characters AFTER the leading letter,
                  // so {3,29} = total length 4–30, not 5–30.
                  pattern: /^(?!.*[ _-]{2})(?!^[\s_-])(?!.*[\s_-]$)(?=^[A-Za-z][A-Za-z0-9 _\-\(\)]{3,29}$)^.*$/,
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
            {
              inline: true,
              label: "CS_COMPLAINT_POSTALCODE__DETAILS",
              type: "number",
              disable: false,
              populators: {
                name: "postalCode",
                // Postal code is optional in Nairobi — the boundary picker
                // already pins the complaint to a Ward, and many citizens
                // don't know the postal code (which is the post-office area
                // code, not a residential identifier in KE). We still
                // validate format if anything is entered.
                required: false,
                validation: {
                  required: false,
                  pattern: /^[0-9]{5}$/,
                },
                error: "CS_COMPLAINT_POSTALCODE_INVALID_ERROR",
              },
            },

            // Boundary cascade — replaces the old City + Locality pair.
            // Renders N dropdowns derived from `boundaryHierarchyOrder`
            // (populated by `usePGRInitialization` on employee module
            // mount), so a tenant with County → Sub-County → Ward gets
            // three dropdowns, and a tenant with City → Locality gets
            // two. The form payload's `SelectedBoundary` key ends up
            // holding the lowest-level node the operator picked — e.g.
            // the Ward — which `formPayloadToCreateComplaint` maps to
            // `address.locality.code` (closes egovernments/CCRS#438,
            // #406 practical cause, and #447 items 6+7).
            {
              isMandatory: true,
              key: "SelectedBoundary",
              type: "component",
              component: "PGRBoundaryComponent",
              label: "CS_COMPLAINT_LOCATION",
              populators: {
                name: "SelectedBoundary",
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

      ],
    }
  ],
}
