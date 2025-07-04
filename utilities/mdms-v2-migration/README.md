# mdmsv2-migration

**Steps:**

*   Update env\_config and add URL and credentials for the env.
    
    *   Credentials can be of any user if port forwarding the MDMSv2 service
        
    *   Ensure that url contains env specific suffix, example: [www.naljal.digit.org/uat](http://www.naljal.digit.org/uat)
        
*   Under schema folder, add json file containing array of schemas
    
    *   The file name can be anything, example one file for unified-qa.json could contain all the schema, or we can divide it module-wise as in screenshot
        
    *   Tenant id can be anything because we can pass correct tenant id for schemas while running the script later
        
*   Under the data folder, add MDMSv2 data that needs to be migrated
    
    *   The data file names should be module\_name.master\_data.json as in the screenshot. The file name is used to map the data to specific schema, so ensure it is correct (refer screenshot)
        
    *   Each file will have array of data objects
        
*   Run the exec.py file
    
    *   It contains examples in comment, pass the specific schema name or folder name and tenant id
        
    *   Similar thing for data as well , refer the commented code in screenshots
        
    *   Make sure to port-forward the MDMSv2 service and update “localhost” in env\_config file. By default the script is configured to run with port forwarded service
        
    *   If not doing port forwarding, then set is\_portforward=False in exec.py (refer screenshot)
