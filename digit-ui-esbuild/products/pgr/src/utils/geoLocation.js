/**
 * Return true when a complaint has coordinates that can be safely displayed
 * or sent to PGR.
 *
 * Older PGR responses represented a missing database location as (0, 0).
 * Keep treating that exact pair as absent during the backend rollout, while
 * allowing valid locations on either the equator or prime meridian.
 */
export const hasUsableGeoLocation = (location) => {
  const latitude = location?.latitude ?? location?.lat;
  const longitude = location?.longitude ?? location?.lng;

  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180 &&
    !(latitude === 0 && longitude === 0)
  );
};

/** Convert the map picker's {lat, lng} shape to the PGR API shape. */
export const serializeGeoLocation = (location) => {
  if (!hasUsableGeoLocation(location)) return {};

  return {
    latitude: location.latitude ?? location.lat,
    longitude: location.longitude ?? location.lng,
  };
};
