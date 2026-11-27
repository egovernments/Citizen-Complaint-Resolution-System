import Urls from "../atoms/urls";

// Which endpoint serves a complaint's workflow history for the current caller.
//
// A citizen reads it through pgr-services' requester-filtered chronology endpoint,
// never the raw workflow search: the workflow service answers per tenant and
// business id with no notion of who owns the complaint, and the CITIZEN role no
// longer holds that action (ACCESSCONTROL-ROLEACTIONS). Decided by the token the
// request will carry (the signed-in user's type), not by the app path; employee
// tokens keep the raw search, which their screens read unfiltered. Other modules'
// workflows are not complaints and stay on the raw search.
export const processSearchUrl = (moduleCode) => {
  if (moduleCode !== "PGR") return Urls.WorkFlowProcessSearch;
  return Digit.UserService.getUser()?.info?.type === "EMPLOYEE" ? Urls.WorkFlowProcessSearch : Urls.PGRChronology;
};
