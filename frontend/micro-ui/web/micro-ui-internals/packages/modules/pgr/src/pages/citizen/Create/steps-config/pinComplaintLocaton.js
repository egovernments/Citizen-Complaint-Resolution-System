export const pinComplaintLocaton = {
  head: "CS_ADDCOMPLAINT_SELECT_GEOLOCATION_HEADER",
  body: [
    {
      "type": "component",
      "isMandatory": false,
      "component": "GeoLocations",
      "key": "GeoLocationsPoint",
      "withoutLabel": true,
      "populators": {
        "name": "GeoLocationsPoint",
        "styles": {
          "maxWidth": "37.5rem",
        },
      }
    },
  ],
};
