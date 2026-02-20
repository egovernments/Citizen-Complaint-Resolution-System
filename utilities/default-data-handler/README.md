
# <Default Data Handler>

This service adds default data for new tenant in the Digit suite of services.

### Overview

The Default Data Handler service listens to the create-tenant Kafka topic and automatically provisions all required master data and configuration for the target tenant.
It ensures that the new tenant is fully set up with:

MDMS schema & MDMS data
Localization data
Boundary data
User creation with credentials
Employee creation
Workflow configurations


### How It Works

Trigger: The service starts after detecting a create-tenant event from Kafka.

# Wait Mechanism:
Waits 10 seconds after startup until dependent services are running:

mdms-v2
boundary-service
localisation service

# Execution Cycle:
Initializes StartupSchemaAndMasterDataInitializer after the 10-second wait.

Then, runs StartupUserAndEmployeeInitializer 4 times at 4-minute intervals.

Within 20 minutes of service initialization, all master data, localization data, workflow data, users, and employees are created or updated.

### Service Dependencies

mdms-v2
boundary-service
localisation service
user service
employee service
workflow service


### DB UML Diagram


