# PGR Service
The objective of this service is to provide a functionality to raise a complaint/grievance by citizen in the system. The progress of complaint/grievance can be tracked by
the citizen and will be updated by notifications whenever the status of the complaint progresses further.
### DB UML Diagram

```mermaid
erDiagram
    eg_pgr_service_v2 {
        varchar(64)  id PK
        varchar(256) tenantId PK
        varchar(256) serviceCode
        varchar(256) serviceRequestId
        varchar(4000) description
        varchar(256) accountId
        jsonb        additionalDetails
        varchar(128) applicationStatus
        smallint     rating
        varchar(256) source
        boolean      active
        varchar(256) createdby
        bigint       createdtime
        varchar(256) lastmodifiedby
        bigint       lastmodifiedtime
    }

    eg_pgr_address_v2 {
        varchar(256) id PK
        varchar(256) tenantId
        varchar(256) parentid FK
        varchar(128) doorno
        varchar(256) plotno
        varchar(1024) buildingName
        varchar(1024) street
        varchar(1024) landmark
        varchar(512) city
        varchar(16)  pincode
        varchar(128) locality
        varchar(256) district
        varchar(256) region
        varchar(256) state
        varchar(512) country
        numeric(9_6) latitude
        numeric(10_7) longitude
        jsonb        additionaldetails
        varchar(128) createdby
        bigint       createdtime
        varchar(128) lastmodifiedby
        bigint       lastmodifiedtime
    }

    eg_pgr_document_v2 {
        varchar(64) id PK
        varchar(64) document_type
        varchar(64) filestore_id
        varchar(64) document_uid
        varchar(64) service_id FK
        jsonb       additional_details
        varchar(64) created_by
        varchar(64) last_modified_by
        bigint      created_time
        bigint      last_modified_time
    }

    eg_pgr_service_v2 ||--o{ eg_pgr_address_v2 : "has"
    eg_pgr_service_v2 ||--o{ eg_pgr_document_v2 : "has"
```

### Service Dependencies
- egov-user
- egov-idgen
- mdms-v2
- egov-persister
- egov-hrms
- egov-workflow-v2
- egov-url-shortening
- novu-bridge (asynchronous, over Kafka — see **Notification** below)

pgr-services no longer calls egov-localization or digit-user-preferences-service for
notifications; novu-bridge does.


### Swagger API Contract
- Please refer to the [Swagger API contarct](https://raw.githubusercontent.com/egovernments/municipal-services/master/docs/pgr-services.yml) for PGR service to understand the structure of APIs and to have visualization of all internal APIs.


## Service Details
**Details of all the entities involved:**

**a) PGREntity:** The top level wrapper object containing the Service and Workflow

**b) Service:** The Service object contains the details of the complaint including the owner of the complaint.

**c) Workflow:** The Workflow object contains the action which is to be performed on the complaint and other associated inforamtion like documents and comments given while performing the action.

**d) Citizen:** The Citizen object is of type(class) User  and contains the info about the person who has filed the complaint or on whose behalf the complaint is filled.

**e) Address:** Captures details of the address of the complaint.



**Notification:**

pgr-services only produces notification events. On every workflow transition
`NotificationConsumer` publishes one **thin event** to `complaints.domain.events`; novu-bridge
decides recipients, channels, language and text from the `NOTIFICATIONS.*` masters. There is no
flag: rollback means redeploying the previous image.

| Field | Carries |
|---|---|
| `eventName` / `ledgerEventName` | `COMPLAINTS.WORKFLOW.<ACTION>.<TOSTATE>` (config key) / `COMPLAINTS.WORKFLOW.<ACTION>` (dispatch-log name) |
| `transactionSeed` | `<complaintNo>:<action>:<toState>` |
| `actors` | `citizen` (inline contact from the complaint) and `assignee` (uuid only; the bridge looks up contacts) |
| `data` | complaint number, date, service code, status, comments, rating, citizen name, short download link, assignee name |
| `localized` | localization codes for `complaint_type`, `status`, `ulb`, `ao_designation`, `emp_department`, `emp_designation` |

A token PGR cannot fill is omitted, not blanked; `download_link` is blanked to `""` on a
shortener outage. The event must stay valid against
[`thin-event-v1.schema.json`](../../docs/2.20/notifications/contract/thin-event-v1.schema.json)
([examples](../../docs/2.20/notifications/contract/examples/thin/)); see the
[notifications developer guide](../../docs/2.20/notifications/developer-guide.md).


### Configurable properties

| Environment Variables                     | Description                                                                                                                                               | Value                                             |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------|---------------------------------------------------|
| `pgr.complain.idle.time`                  | **Fallback only.** The reopen window is MDMS `RAINMAKER-PGR.UIConstants.REOPENSLA`, per tenant; this applies only when MDMS has no usable value. Do not set `PGR_COMPLAIN_IDLE_TIME` — see `docs/reopen-window.md`. | 259200000                                         |
| `pgr.default.offset`                      | The default offset in any search                                                                                                                          | 0                                                 |
| `pgr.default.limit`                       | The default limit in any search call.                                                                                                                     | 100                                               |
| `pgr.search.max.limit`                    | The maximum number of record returned in any search call                                                                                                  | 200                                               |
| `kafka.topics.complaints.domain.events`   | Topic the thin notification event is published to; `novu-bridge` consumes it and dispatches on the event's `kind`                                          | complaints.domain.events                          |
| `pgr.notification.mdms.cache.ttl.ms`      | Shared MDMS cache window (SLA map, reopen window, department code→name). Named for the notification masters it was introduced for; those are novu-bridge's now | 60000                                          |

Removed notification properties are listed in
[docs/2.20/notifications/migration.md](../../docs/2.20/notifications/migration.md#removed-settings).

### API Details

`BasePath` /pgr-services/v2/[API endpoint]

##### Method
**a) Create Complaint `POST /_create` :** API to create/raise a complaint in the system

**b) Update Complaint `POST /_update` :** API to update the details of complaint.(Used primarily to perform actions on the complaint)

**c) Search Complaints `POST /_search` :** API to search the complaints based on certain predefined params. Default offset and limit will be applied on every search call if not provided in the search call

**c) Count Complaints `POST /_search` :** API to return the count of total number of complaints satisfying the given criteria

### Kafka Consumers

- **save-pgr-request / update-pgr-request** (pattern `pgr.kafka.notification.topic.pattern`) :-
  `NotificationConsumer` reads every complaint transition back off its own topics and publishes the
  thin notification event for it.

### Kafka Producers

- Following are the Producer topic.
    - **save-pgr-request** :- This topic is used to create new complaint in the system.
    - **update-pgr-request** :- This topic is used to update the existing complaint in the systen.
    - **complaints.domain.events** :- One thin notification event per workflow transition, consumed
      by `novu-bridge`.

### note
all master data, localisation data, boundary data, users, employees, workflow config will be update by a service in utilities/default-data-handler which update all these data which is maintained in resource folder.

and all the configs which are required for pgr are maintained in configs folder.