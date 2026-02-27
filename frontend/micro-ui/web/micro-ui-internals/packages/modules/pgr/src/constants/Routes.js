export const PGR_BASE = `/${window?.contextPath}/pgr/citizen/`;

const CREATE_COMPLAINT_PATH = "/complaint/create/";
const REOPEN_COMPLAINT_PATH = "/reopen/";

export const PgrRoutes = {
  ComplaintsPage: "/complaints",
  RatingAndFeedBack: "/rate/:id*",
  ComplaintDetailsPage: "/complaint/details/:id",
  ReasonPage: `/:id`,
  UploadPhoto: `/upload-photo/:id`,
  AddtionalDetails: `/addional-details/:id`,
  CreateComplaint: "/complaint/create",
  ReopenComplaint: "/reopen",
  Response: "/response",

  CreateComplaintStart: "",
  SubType: `/subtype`,
  LocationSearch: `/location`,
  Pincode: `/pincode`,
  Address: `/address`,
  Landmark: `/landmark`,
  UploadPhotos: `/upload-photos`,
  Details: `/details`,
  CreateComplaintResponse: `/response`,
};

export const getRoute = (match, route) => `${match.path}${route}`;
