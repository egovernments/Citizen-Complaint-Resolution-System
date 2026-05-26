# Citizen-Complaint-Resolution-System
This repository houses the code, configuration and deployment configs necessary for deploying a fully functional DIGIT Citizen Complaint Resolution System (CCRS). 
Below diagram shows the high level architecture of the CCRS solution:
<img width="967" height="426" alt="Screenshot 2025-07-20 at 5 50 08 PM" src="https://github.com/user-attachments/assets/8e421d9c-09fb-4193-bec4-faea3bcb653b" />
For more details on the solution architecture, please refer to the [Architecture](https://docs.digit.org/complaints-resolution/design/architecture) section on this site.

## How to navigate the repository
- The `backend` folder contains the complaints backend service
- The `frontend` folder contains the frontend code for the complaints service
- The `configs` folder contains all DIGIT configuration files for the 2.9 LTS platform & the complaints solution to work
- The `devops` folder contains the 1-click installer will all requisite Helm charts for the 2.9 LTS platform & the CCRS solution.
- The `utilities` folder contains the `data-handler` service. This service loads all the default master data (present under `resources` folder) required for the CCRS solution to work out of the box. The default master data is only indicative, provided for ease-of-setup and use in development environments. 

## Local Setup
### Backend Service Setup
TBD
### Frontend Service Setup
[Refer this](https://github.com/egovernments/Citizen-Complaint-Resolution-System/blob/develop/frontend/micro-ui/README.md)


Aggressive 605
