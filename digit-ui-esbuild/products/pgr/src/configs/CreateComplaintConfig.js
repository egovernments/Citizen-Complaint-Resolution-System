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
              // QA #26 (product call): channel-of-receipt CHIP selector just
              // above the mobile number — label in the LEFT column, chips in
              // the control column (inline row, same as the fields below).
              // The selected CODE becomes service.source at submit (email /
              // inperson / letter / linhaverde — kept in pgr-services'
              // allowed.source list). "In Person" is first and pre-selected.
              inline: true,
              isMandatory: false,
              // Always carries a value (defaults to inperson) — suppress the
              // generic "(Optional)" label suffix.
              noOptionalSuffix: true,
              type: "component",
              component: "PGRChannelChipsComponent",
              key: "ReceivedChannel",
              label: "ES_CREATECOMPLAINT_RECEIVED_CHANNEL",
              populators: { name: "ReceivedChannel" },
            },
            {
              inline: true,
              label: "COMPLAINTS_COMPLAINANT_CONTACT_NUMBER",
              isMandatory: true,
              type: "mobileNumber",
              disable: false,
              populators: {
                name: "ComplainantContactNumber",
                error: "CORE_COMMON_MOBILE_ERROR",
                // Read order (per @vinothrallapalli-eGov review on
                // PR #689, canonical UserValidation pattern):
                //   1. `window.__DIGIT_USER_VALIDATION.mobile` —
                //      populated by `useMobileValidation` from the
                //      `common-masters.UserValidation` MDMS master.
                //   2. `globalConfigs.CORE_MOBILE_CONFIGS` — build-time
                //      fallback rendered by the playbook for tenants
                //      that haven't seeded the master OR for the first
                //      render before the MDMS hook resolves.
                //   3. Legacy hardcoded India value (10) — last resort.
                // Getters re-evaluate on every read so a tenant switch
                // mid-session picks up the latest source.
                get maxLength() {
                  return window?.__DIGIT_USER_VALIDATION?.mobile?.maxLength || 15;
                },
                validation: {
                  required: true,
                  get minLength() {
                    return window?.__DIGIT_USER_VALIDATION?.mobile?.minLength || 1;
                  },
                  get maxLength() {
                    return window?.__DIGIT_USER_VALIDATION?.mobile?.maxLength || 15;
                  },
                },
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
                  // Read order (canonical UserValidation pattern, same as the
                  // mobile field above):
                  //   1. `window.__DIGIT_USER_VALIDATION.name` — populated by
                  //      `useMobileValidation` from the validation MDMS master
                  //      (nameRegex, optional field).
                  //   2. Built-in fallback below — always valid, so an
                  //      unseeded or malformed master value can't break the form.
                  // Getter re-evaluates on every read, so the MDMS value wins
                  // as soon as the hook resolves.
                  // CCRS#437: Allow 4-character names (e.g. "John"). The
                  // quantifier counts characters AFTER the leading letter,
                  // CCSD-1990: min length 1 (was 4). {0,29} = total 1–30.
                  // Letter-first / no leading-trailing-doubled separator kept.
                  get pattern() {
                    const raw = window?.__DIGIT_USER_VALIDATION?.name?.pattern;
                    if (raw) {
                      try {
                        return raw instanceof RegExp ? raw : new RegExp(raw);
                      } catch (e) {
                        console.error("Invalid nameRegex in validation master:", e);
                      }
                    }
                    return /^(?!.*[ _-]{2})(?!^[\s_-])(?!.*[\s_-]$)(?=^[A-Za-z][A-Za-z0-9 _\-\(\)]{0,29}$)^.*$/;
                  },
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
            // Pin-location map (egovernments/CCRS#447 item 5). Renders the
            // same leaflet map the citizen flow uses (registered as
            // `PGRComplaintLocationMap` → GeoLocations in Module.js). On a
            // pin drop, GeoLocations.resolveWard() runs point-in-polygon
            // against the bundled Nairobi-wards GeoJSON and writes
            // `{ lat, lng, pincode, address, ward:{code,name,...} }` to the
            // `GeoLocationsPoint` form key. PGRBoundaryComponent below
            // already watches `formData.GeoLocationsPoint.ward` (CCRS#491)
            // and auto-fills the County / Sub-County / Ward cascade from
            // that pin — so dropping a pin populates the boundary picker
            // for free, with no extra wiring on the employee path.
            //
            // Optional: the operator can still file by manually selecting
            // the boundary cascade without dropping a pin. Leaving it
            // non-mandatory also avoids forcing a geoLocation onto every
            // submit (see the null-geoLocation persister risk noted on the
            // ticket) — the map only contributes a geoLocation when a pin
            // is actually placed.
            {
              isMandatory: false,
              key: "GeoLocationsPoint",
              type: "component",
              component: "PGRComplaintLocationMap",
              label: "CS_COMPLAINT_DETAILS_PIN_LOCATION",
              populators: {
                name: "GeoLocationsPoint",
              },
            },
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
                  // Postal-code shape is per-country. Read the pattern from
                  // globalConfigs CORE_POSTAL_CONFIGS (e.g. MZ = 4 digits)
                  // instead of hardcoding 5, so this field rule matches the
                  // config-driven check in createComplaintForm.js. Falls back
                  // to the legacy 5-digit default when the host hasn't set it.
                  pattern: new RegExp(
                    window?.globalConfigs?.getConfig?.("CORE_POSTAL_CONFIGS")?.postalCodePattern || "^[0-9]{5}$"
                  ),
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
                  // CCSD-1956 + QA #27: 20-1000 chars AND at least 3 letters, so
                  // "00000000000000000000" (20 digits) and all-whitespace are
                  // both rejected. The single error message covers both rules.
                  minLength: 20,
                  pattern: /^(?=[\s\S]{20,1000}$)(?=(?:[\s\S]*?\p{L}){3})[\s\S]*$/u,
                },
                error: "CS_DESC_MIN_CHARS",
              },
            },
          ],
        },

      ],
    }
  ],
}
