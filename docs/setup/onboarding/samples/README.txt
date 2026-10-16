CCRS / Mozambique PGR — Onboarding Excels (populated, ready to upload)
=====================================================================
Upload via the Configurator onboarding wizard: http://localhost/configurator/
(Log in ADMIN / eGov@123, target tenant = your city e.g. ke.bomet)

ORDER:
  Phase 3 · Step 3.1  ->  1_Departments_and_Designations.xlsx
        (Department + Designation sheets; designations reference dept codes)
  Phase 3 · Step 3.2  ->  2_Complaint_Hierarchy.xlsx
        (define 4 levels: AUTHORITY_TYPE, MAIN_CATEGORY, SECTOR, SUB_TYPE, then upload)
        Produces: IGE/IGSAE -> Complaint/Grievance/Petition -> Sectors -> 13 sub-types
        Department Name* column references the dept codes from file 1.
  Phase 4             ->  3_Employees.xlsx
        (employees reference the dept + designation codes above; PGR roles set)

NOTES:
- Department codes: MUN_* (IGE municipalities), *_OPS (IGSAE operations depts).
- mobileNumber is 9 digits (Kenya/Bomet validation ^[17][0-9]{8}$). Adjust for other tenants.
- jurisdictions use boundary code COUNTY_001 (Bomet). Change to your tenant's boundary codes.
- NOT included: Phase 1 (Tenant & Branding) and Phase 2 (Boundary) workbooks — ask if you want those too.
- Values follow the "Detailed Enhancements and Solution Design" doc (IGE/IGSAE, sectors, example sub-types).
