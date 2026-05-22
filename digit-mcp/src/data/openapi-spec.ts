// Complete OpenAPI 3.0 specification for all DIGIT platform APIs.
// Built from endpoints.ts and digit-api.ts — the single source of truth.
// Returned by the api_catalog tool for UI developers and agent integrations.

export interface OpenApiSpec {
  openapi: string;
  info: Record<string, unknown>;
  servers: Record<string, unknown>[];
  tags: Record<string, unknown>[];
  paths: Record<string, Record<string, unknown>>;
  components: Record<string, unknown>;
}

export function buildOpenApiSpec(baseUrl: string): OpenApiSpec {
  return {
    openapi: '3.0.3',
    info: {
      title: 'DIGIT Platform API',
      description:
        'Complete API catalog for all DIGIT platform services. Covers authentication, master data (MDMS), ' +
        'boundary management, employee management (HRMS), public grievance redressal (PGR), workflow engine, ' +
        'localization, filestore, access control, ID generation, encryption, and more.\n\n' +
        '**Common pattern**: Almost all endpoints are POST with a `RequestInfo` header object in the JSON body. ' +
        'Search endpoints may also accept query parameters. Authentication uses OAuth2 password grant.',
      version: '2.0.0',
      contact: { name: 'DIGIT Platform', url: 'https://docs.digit.org' },
    },
    servers: [{ url: baseUrl, description: 'Current DIGIT environment' }],
    tags: TAGS,
    paths: buildPaths(),
    components: buildComponents(),
  };
}

// ── Service tags ──

const TAGS = [
  { name: 'Auth', description: 'Authentication via OAuth2 password grant. Returns access token and user info.' },
  { name: 'User', description: 'User search, creation, and update. Supports CITIZEN, EMPLOYEE, and SYSTEM user types.' },
  { name: 'MDMS', description: 'Master Data Management Service v2. CRUD for schemas and data records (departments, designations, tenants, complaint types, etc.).' },
  { name: 'Boundary', description: 'Boundary service — hierarchy definitions, boundary entities, and parent-child relationships. Used for administrative geography.' },
  { name: 'Boundary Management', description: 'Boundary management service (egov-bndry-mgmnt) — bulk upload/generate boundary data via filestore.' },
  { name: 'HRMS', description: 'Human Resource Management. Employee search, creation, and update with department/designation assignments and role management.' },
  { name: 'PGR', description: 'Public Grievance Redressal v2. Complaint lifecycle: create → assign → resolve/reject → rate. Core citizen-facing service.' },
  { name: 'Workflow', description: 'Workflow engine v2. State machine definitions (business services) and process instance audit trail.' },
  { name: 'Localization', description: 'UI label translations. Search and upsert localization messages by locale and module.' },
  { name: 'Filestore', description: 'File upload/download service. Multipart upload returns fileStoreId; URL retrieval returns signed download links.' },
  { name: 'Access Control', description: 'Role and action/permission management. Search defined roles and role-action mappings.' },
  { name: 'ID Generation', description: 'Unique ID generation service. Produces formatted IDs (complaint numbers, application IDs) from configured patterns.' },
  { name: 'Location', description: 'Legacy geographic boundary service (egov-location). Use Boundary service for newer deployments.' },
  { name: 'Encryption', description: 'Data encryption/decryption service. No authentication required — manages its own keys per tenant.' },
  { name: 'Inbox', description: 'Unified inbox for workflow-driven services. Aggregates complaints/tasks by status with Elasticsearch-backed search. Use v2 endpoint for PGR.' },
];

// ── All paths ──

function buildPaths(): Record<string, Record<string, unknown>> {
  return {
    // ════════════════════════════════════════════
    // AUTH
    // ════════════════════════════════════════════
    '/user/oauth/token': {
      post: {
        tags: ['Auth'],
        operationId: 'login',
        summary: 'Authenticate and get access token',
        description:
          'OAuth2 password grant. Returns an access token and full UserRequest object. ' +
          'The token is used as Bearer token in all subsequent API calls via RequestInfo.authToken. ' +
          'Uses Basic Auth header with client credentials (egov-user-client).',
        requestBody: {
          required: true,
          content: {
            'application/x-www-form-urlencoded': {
              schema: {
                type: 'object',
                required: ['username', 'password', 'userType', 'tenantId', 'grant_type', 'scope'],
                properties: {
                  username: { type: 'string', description: 'Username (mobile number for CITIZEN, code for EMPLOYEE)' },
                  password: { type: 'string', description: 'User password' },
                  userType: { type: 'string', enum: ['EMPLOYEE', 'CITIZEN'], description: 'User type for login scope' },
                  tenantId: { type: 'string', description: 'Tenant ID (e.g. "pg.citya")', example: 'pg.citya' },
                  grant_type: { type: 'string', enum: ['password'], default: 'password' },
                  scope: { type: 'string', enum: ['read'], default: 'read' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Successful authentication',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    access_token: { type: 'string', description: 'Bearer token for API calls' },
                    token_type: { type: 'string', example: 'bearer' },
                    expires_in: { type: 'integer' },
                    UserRequest: { $ref: '#/components/schemas/UserInfo' },
                  },
                },
              },
            },
          },
        },
        security: [{ basicAuth: [] }],
      },
    },

    // ════════════════════════════════════════════
    // USER
    // ════════════════════════════════════════════
    '/user/_search': {
      post: {
        tags: ['User'],
        operationId: 'userSearch',
        summary: 'Search users by username, mobile, UUID, role, or type',
        description:
          'Search DIGIT platform users. Supports filtering by userName, mobileNumber, uuid array, ' +
          'roleCodes, and userType (CITIZEN/EMPLOYEE/SYSTEM). Returns full user records with roles.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['RequestInfo', 'tenantId'],
                properties: {
                  RequestInfo: { $ref: '#/components/schemas/RequestInfo' },
                  tenantId: { type: 'string', example: 'pg.citya' },
                  userName: { type: 'string' },
                  mobileNumber: { type: 'string', pattern: '^[0-9]{10}$' },
                  uuid: { type: 'array', items: { type: 'string' } },
                  roleCodes: { type: 'array', items: { type: 'string' }, example: ['GRO', 'PGR_LME'] },
                  userType: { type: 'string', enum: ['CITIZEN', 'EMPLOYEE', 'SYSTEM'] },
                  pageSize: { type: 'integer', default: 100 },
                  pageNumber: { type: 'integer', default: 0 },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'List of matching users',
            content: { 'application/json': { schema: { type: 'object', properties: { user: { type: 'array', items: { $ref: '#/components/schemas/UserInfo' } } } } } },
          },
        },
      },
    },

    '/user/users/_createnovalidate': {
      post: {
        tags: ['User'],
        operationId: 'userCreate',
        summary: 'Create a new user (admin, no OTP validation)',
        description:
          'Creates a user without OTP validation. Use for CITIZEN users (PGR complaints) or EMPLOYEE users. ' +
          'For employees with department/designation, prefer employee_create in HRMS which creates the user automatically.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['RequestInfo', 'user'],
                properties: {
                  RequestInfo: { $ref: '#/components/schemas/RequestInfo' },
                  user: {
                    type: 'object',
                    required: ['name', 'mobileNumber', 'tenantId'],
                    properties: {
                      name: { type: 'string' },
                      userName: { type: 'string', description: 'Defaults to mobileNumber for CITIZEN' },
                      mobileNumber: { type: 'string', pattern: '^[0-9]{10}$' },
                      emailId: { type: 'string', format: 'email' },
                      gender: { type: 'string', enum: ['MALE', 'FEMALE', 'TRANSGENDER'] },
                      type: { type: 'string', enum: ['CITIZEN', 'EMPLOYEE'], default: 'CITIZEN' },
                      password: { type: 'string', default: 'eGov@123' },
                      tenantId: { type: 'string' },
                      roles: { type: 'array', items: { $ref: '#/components/schemas/Role' } },
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Created user', content: { 'application/json': { schema: { type: 'object', properties: { user: { type: 'array', items: { $ref: '#/components/schemas/UserInfo' } } } } } } },
        },
      },
    },

    '/user/users/_updatenovalidate': {
      post: {
        tags: ['User'],
        operationId: 'userUpdate',
        summary: 'Update an existing user (admin, no OTP validation)',
        description: 'Updates user details. Fetch the user first via user/_search, modify fields, then send the full object.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['RequestInfo', 'user'],
                properties: {
                  RequestInfo: { $ref: '#/components/schemas/RequestInfo' },
                  user: { $ref: '#/components/schemas/UserInfo' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Updated user', content: { 'application/json': { schema: { type: 'object', properties: { user: { type: 'array', items: { $ref: '#/components/schemas/UserInfo' } } } } } } },
        },
      },
    },

    // ════════════════════════════════════════════
    // MDMS v2
    // ════════════════════════════════════════════
    '/mdms-v2/v2/_search': {
      post: {
        tags: ['MDMS'],
        operationId: 'mdmsSearch',
        summary: 'Search MDMS v2 records by schema code',
        description:
          'Search master data records. Common schemas: common-masters.Department, common-masters.Designation, ' +
          'RAINMAKER-PGR.ServiceDefs, tenant.tenants, ACCESSCONTROL-ROLES.roles, egov-hrms.EmployeeType. ' +
          'Returns the data field of each record.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['RequestInfo', 'MdmsCriteria'],
                properties: {
                  RequestInfo: { $ref: '#/components/schemas/RequestInfo' },
                  MdmsCriteria: {
                    type: 'object',
                    required: ['tenantId', 'schemaCode'],
                    properties: {
                      tenantId: { type: 'string', example: 'pg' },
                      schemaCode: { type: 'string', example: 'common-masters.Department', description: 'MDMS schema code' },
                      limit: { type: 'integer', default: 100 },
                      offset: { type: 'integer', default: 0 },
                      uniqueIdentifiers: { type: 'array', items: { type: 'string' }, description: 'Filter by specific record identifiers' },
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'MDMS records', content: { 'application/json': { schema: { type: 'object', properties: { mdms: { type: 'array', items: { $ref: '#/components/schemas/MdmsRecord' } } } } } } },
        },
      },
    },

    '/mdms-v2/v2/_create/{schemaCode}': {
      post: {
        tags: ['MDMS'],
        operationId: 'mdmsCreate',
        summary: 'Create a new MDMS v2 record',
        description: 'Creates a master data record under the specified schema. The unique identifier is typically the "code" field in the data payload.',
        parameters: [
          { name: 'schemaCode', in: 'path', required: true, schema: { type: 'string' }, description: 'Schema code (e.g. "common-masters.Department")' },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['RequestInfo', 'Mdms'],
                properties: {
                  RequestInfo: { $ref: '#/components/schemas/RequestInfo' },
                  Mdms: {
                    type: 'object',
                    required: ['tenantId', 'schemaCode', 'uniqueIdentifier', 'data'],
                    properties: {
                      tenantId: { type: 'string' },
                      schemaCode: { type: 'string' },
                      uniqueIdentifier: { type: 'string', description: 'Unique ID for the record (usually the code field)' },
                      data: { type: 'object', description: 'Record payload — must conform to the schema definition' },
                      isActive: { type: 'boolean', default: true },
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Created MDMS record', content: { 'application/json': { schema: { type: 'object', properties: { mdms: { type: 'array', items: { $ref: '#/components/schemas/MdmsRecord' } } } } } } },
        },
      },
    },

    '/mdms-v2/schema/v1/_search': {
      post: {
        tags: ['MDMS'],
        operationId: 'mdmsSchemaSearch',
        summary: 'Search MDMS v2 schema definitions',
        description: 'Lists registered schema definitions for a tenant. Shows what schemas are available for creating data records.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['RequestInfo', 'SchemaDefCriteria'],
                properties: {
                  RequestInfo: { $ref: '#/components/schemas/RequestInfo' },
                  SchemaDefCriteria: {
                    type: 'object',
                    required: ['tenantId'],
                    properties: {
                      tenantId: { type: 'string', description: 'State-level root tenant (e.g. "pg")' },
                      codes: { type: 'array', items: { type: 'string' }, description: 'Filter by specific schema codes' },
                      limit: { type: 'integer', default: 200 },
                      offset: { type: 'integer', default: 0 },
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Schema definitions', content: { 'application/json': { schema: { type: 'object', properties: { SchemaDefinitions: { type: 'array', items: { type: 'object' } } } } } } },
        },
      },
    },

    '/mdms-v2/schema/v1/_create': {
      post: {
        tags: ['MDMS'],
        operationId: 'mdmsSchemaCreate',
        summary: 'Register a new MDMS v2 schema definition',
        description: 'Registers a JSON Schema definition at the state-level root tenant. Required before data records can be created for this schema.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['RequestInfo', 'SchemaDefinition'],
                properties: {
                  RequestInfo: { $ref: '#/components/schemas/RequestInfo' },
                  SchemaDefinition: {
                    type: 'object',
                    required: ['tenantId', 'code', 'description', 'definition'],
                    properties: {
                      tenantId: { type: 'string' },
                      code: { type: 'string', example: 'common-masters.Department' },
                      description: { type: 'string' },
                      definition: { type: 'object', description: 'JSON Schema definition with type, properties, required, x-unique' },
                      isActive: { type: 'boolean', default: true },
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Created schema definition', content: { 'application/json': { schema: { type: 'object', properties: { SchemaDefinition: { type: 'object' } } } } } },
        },
      },
    },

    // ════════════════════════════════════════════
    // BOUNDARY
    // ════════════════════════════════════════════
    '/boundary-service/boundary/_search': {
      post: {
        tags: ['Boundary'],
        operationId: 'boundarySearch',
        summary: 'Search boundary entities',
        description: 'Search for boundary entities (administrative areas) by tenant and optional hierarchy type.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['RequestInfo', 'Boundary'],
                properties: {
                  RequestInfo: { $ref: '#/components/schemas/RequestInfo' },
                  Boundary: {
                    type: 'object',
                    required: ['tenantId'],
                    properties: {
                      tenantId: { type: 'string' },
                      hierarchyType: { type: 'string', example: 'ADMIN' },
                      limit: { type: 'integer', default: 100 },
                      offset: { type: 'integer', default: 0 },
                    },
                  },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Boundary entities', content: { 'application/json': { schema: { type: 'object', properties: { Boundary: { type: 'array', items: { type: 'object' } } } } } } } },
      },
    },

    '/boundary-service/boundary/_create': {
      post: {
        tags: ['Boundary'],
        operationId: 'boundaryCreate',
        summary: 'Create boundary entities',
        description: 'Creates one or more boundary entities with optional geometry.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['RequestInfo', 'Boundary'],
                properties: {
                  RequestInfo: { $ref: '#/components/schemas/RequestInfo' },
                  Boundary: {
                    type: 'array',
                    items: {
                      type: 'object',
                      required: ['tenantId', 'code'],
                      properties: {
                        tenantId: { type: 'string' },
                        code: { type: 'string', description: 'Unique boundary code' },
                        geometry: {
                          type: 'object',
                          properties: {
                            type: { type: 'string', example: 'Point' },
                            coordinates: { type: 'array', items: { type: 'number' } },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Created boundaries', content: { 'application/json': { schema: { type: 'object', properties: { Boundary: { type: 'array', items: { type: 'object' } } } } } } } },
      },
    },

    '/boundary-service/boundary-hierarchy-definition/_search': {
      post: {
        tags: ['Boundary'],
        operationId: 'boundaryHierarchySearch',
        summary: 'Search boundary hierarchy definitions',
        description: 'Returns hierarchy type structures showing boundary levels (e.g. Country > State > District > City > Ward > Locality).',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['RequestInfo', 'BoundaryTypeHierarchySearchCriteria'],
                properties: {
                  RequestInfo: { $ref: '#/components/schemas/RequestInfo' },
                  BoundaryTypeHierarchySearchCriteria: {
                    type: 'object',
                    required: ['tenantId'],
                    properties: {
                      tenantId: { type: 'string' },
                      hierarchyType: { type: 'string', example: 'ADMIN' },
                      limit: { type: 'integer', default: 100 },
                      offset: { type: 'integer', default: 0 },
                    },
                  },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Hierarchy definitions', content: { 'application/json': { schema: { type: 'object', properties: { BoundaryHierarchy: { type: 'array', items: { type: 'object' } } } } } } } },
      },
    },

    '/boundary-service/boundary-hierarchy-definition/_create': {
      post: {
        tags: ['Boundary'],
        operationId: 'boundaryHierarchyCreate',
        summary: 'Create a boundary hierarchy definition',
        description: 'Defines the hierarchy of boundary types for a tenant (e.g. Country → State → District → City → Ward → Locality).',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['RequestInfo', 'BoundaryHierarchy'],
                properties: {
                  RequestInfo: { $ref: '#/components/schemas/RequestInfo' },
                  BoundaryHierarchy: {
                    type: 'object',
                    required: ['tenantId', 'hierarchyType', 'boundaryHierarchy'],
                    properties: {
                      tenantId: { type: 'string' },
                      hierarchyType: { type: 'string', example: 'ADMIN' },
                      boundaryHierarchy: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            boundaryType: { type: 'string', example: 'Ward' },
                            parentBoundaryType: { type: 'string', example: 'City', nullable: true },
                            active: { type: 'boolean', default: true },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Created hierarchy', content: { 'application/json': { schema: { type: 'object', properties: { BoundaryHierarchy: { type: 'object' } } } } } } },
      },
    },

    '/boundary-service/boundary-relationships/_create': {
      post: {
        tags: ['Boundary'],
        operationId: 'boundaryRelationshipCreate',
        summary: 'Create boundary parent-child relationships',
        description: 'Links boundary entities into parent-child relationships within a hierarchy.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['RequestInfo', 'BoundaryRelationship'],
                properties: {
                  RequestInfo: { $ref: '#/components/schemas/RequestInfo' },
                  BoundaryRelationship: {
                    type: 'object',
                    required: ['tenantId', 'code', 'hierarchyType', 'boundaryType'],
                    properties: {
                      tenantId: { type: 'string' },
                      code: { type: 'string', description: 'Boundary code' },
                      hierarchyType: { type: 'string', example: 'ADMIN' },
                      boundaryType: { type: 'string', example: 'Ward' },
                      parent: { type: 'string', description: 'Parent boundary code (null for root)', nullable: true },
                    },
                  },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Created relationship', content: { 'application/json': { schema: { type: 'object', properties: { BoundaryRelationship: { type: 'object' } } } } } } },
      },
    },

    '/boundary-service/boundary-relationships/_search': {
      post: {
        tags: ['Boundary'],
        operationId: 'boundaryRelationshipSearch',
        summary: 'Search boundary relationship tree',
        description: 'Returns the boundary tree structure showing parent-child relationships. Use to find locality codes for PGR complaints.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['RequestInfo', 'BoundaryRelationship'],
                properties: {
                  RequestInfo: { $ref: '#/components/schemas/RequestInfo' },
                  BoundaryRelationship: {
                    type: 'object',
                    required: ['tenantId', 'hierarchyType'],
                    properties: {
                      tenantId: { type: 'string' },
                      hierarchyType: { type: 'string', example: 'ADMIN' },
                      boundaryType: { type: 'string' },
                      parent: { type: 'string' },
                      code: { type: 'array', items: { type: 'string' } },
                    },
                  },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Boundary tree', content: { 'application/json': { schema: { type: 'object', properties: { TenantBoundary: { type: 'array', items: { type: 'object' } } } } } } } },
      },
    },

    // ════════════════════════════════════════════
    // BOUNDARY MANAGEMENT
    // ════════════════════════════════════════════
    '/egov-bndry-mgmnt/v1/_process': {
      post: {
        tags: ['Boundary Management'],
        operationId: 'boundaryMgmtProcess',
        summary: 'Process (upload/update) boundary data from file',
        description: 'Submits boundary data from a previously uploaded file (via filestore) for processing. Used for bulk boundary creation.',
        parameters: [{ name: 'tenantId', in: 'query', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['RequestInfo', 'ResourceDetails'],
                properties: {
                  RequestInfo: { $ref: '#/components/schemas/RequestInfo' },
                  ResourceDetails: {
                    type: 'object',
                    properties: {
                      tenantId: { type: 'string' },
                      type: { type: 'string', example: 'boundary' },
                      fileStoreId: { type: 'string', description: 'Filestore ID from file upload' },
                      hierarchyType: { type: 'string', example: 'ADMIN' },
                      action: { type: 'string', enum: ['create', 'update'] },
                    },
                  },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Processing result' } },
      },
    },

    '/egov-bndry-mgmnt/v1/_process-search': {
      post: {
        tags: ['Boundary Management'],
        operationId: 'boundaryMgmtProcessSearch',
        summary: 'Search processed boundary uploads',
        parameters: [{ name: 'tenantId', in: 'query', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { RequestInfo: { $ref: '#/components/schemas/RequestInfo' } } } } } },
        responses: { '200': { description: 'Processed boundary records', content: { 'application/json': { schema: { type: 'object', properties: { ResourceDetails: { type: 'array', items: { type: 'object' } } } } } } } },
      },
    },

    '/egov-bndry-mgmnt/v1/_generate': {
      post: {
        tags: ['Boundary Management'],
        operationId: 'boundaryMgmtGenerate',
        summary: 'Generate boundary code mappings',
        description: 'Creates boundary code mappings after processing. Typically the second step after _process.',
        parameters: [{ name: 'tenantId', in: 'query', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  RequestInfo: { $ref: '#/components/schemas/RequestInfo' },
                  ResourceDetails: {
                    type: 'object',
                    properties: {
                      tenantId: { type: 'string' },
                      type: { type: 'string', example: 'boundary' },
                      hierarchyType: { type: 'string', example: 'ADMIN' },
                    },
                  },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Generation result' } },
      },
    },

    '/egov-bndry-mgmnt/v1/_generate-search': {
      post: {
        tags: ['Boundary Management'],
        operationId: 'boundaryMgmtDownload',
        summary: 'Download generated boundary data',
        parameters: [{ name: 'tenantId', in: 'query', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { RequestInfo: { $ref: '#/components/schemas/RequestInfo' } } } } } },
        responses: { '200': { description: 'Generated boundary records', content: { 'application/json': { schema: { type: 'object', properties: { ResourceDetails: { type: 'array', items: { type: 'object' } } } } } } } },
      },
    },

    // ════════════════════════════════════════════
    // HRMS
    // ════════════════════════════════════════════
    '/egov-hrms/employees/_search': {
      post: {
        tags: ['HRMS'],
        operationId: 'employeeSearch',
        summary: 'Search employees',
        description:
          'Search HRMS employees by tenant, employee codes, or department. ' +
          'Query parameters are appended to the URL; RequestInfo is sent in the body.',
        parameters: [
          { name: 'tenantId', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'codes', in: 'query', schema: { type: 'string', description: 'Comma-separated employee codes' } },
          { name: 'departments', in: 'query', schema: { type: 'string', description: 'Comma-separated department codes' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 100 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
        ],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { RequestInfo: { $ref: '#/components/schemas/RequestInfo' } } } } } },
        responses: { '200': { description: 'Employee list', content: { 'application/json': { schema: { type: 'object', properties: { Employees: { type: 'array', items: { $ref: '#/components/schemas/Employee' } } } } } } } },
      },
    },

    '/egov-hrms/employees/_create': {
      post: {
        tags: ['HRMS'],
        operationId: 'employeeCreate',
        summary: 'Create a new employee',
        description:
          'Creates an employee with department, designation, jurisdiction, and roles. ' +
          'Automatically creates the underlying user account. Requires EMPLOYEE role at minimum.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['RequestInfo', 'Employees'],
                properties: {
                  RequestInfo: { $ref: '#/components/schemas/RequestInfo' },
                  Employees: {
                    type: 'array',
                    items: { $ref: '#/components/schemas/Employee' },
                  },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Created employee', content: { 'application/json': { schema: { type: 'object', properties: { Employees: { type: 'array', items: { $ref: '#/components/schemas/Employee' } } } } } } } },
      },
    },

    '/egov-hrms/employees/_update': {
      post: {
        tags: ['HRMS'],
        operationId: 'employeeUpdate',
        summary: 'Update an existing employee',
        description: 'Updates employee details. Fetch employee first, modify, then send the full object.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['RequestInfo', 'Employees'],
                properties: {
                  RequestInfo: { $ref: '#/components/schemas/RequestInfo' },
                  Employees: { type: 'array', items: { $ref: '#/components/schemas/Employee' } },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Updated employee', content: { 'application/json': { schema: { type: 'object', properties: { Employees: { type: 'array', items: { $ref: '#/components/schemas/Employee' } } } } } } } },
      },
    },

    // ════════════════════════════════════════════
    // PGR
    // ════════════════════════════════════════════
    '/pgr-services/v2/request/_search': {
      post: {
        tags: ['PGR'],
        operationId: 'pgrSearch',
        summary: 'Search PGR complaints/service requests',
        description:
          'Search complaints by tenant, service request ID, or status. ' +
          'Returns full complaint details including service code, description, status, workflow state, and address.',
        parameters: [
          { name: 'tenantId', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'serviceRequestId', in: 'query', schema: { type: 'string' } },
          { name: 'applicationStatus', in: 'query', schema: { type: 'string', enum: ['PENDINGFORASSIGNMENT', 'PENDINGATLME', 'PENDINGFORREASSIGNMENT', 'RESOLVED', 'REJECTED', 'CLOSEDAFTERRESOLUTION'] } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
        ],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { RequestInfo: { $ref: '#/components/schemas/RequestInfo' } } } } } },
        responses: {
          '200': {
            description: 'Service request wrappers',
            content: { 'application/json': { schema: { type: 'object', properties: { ServiceWrappers: { type: 'array', items: { $ref: '#/components/schemas/ServiceWrapper' } } } } } },
          },
        },
      },
    },

    '/pgr-services/v2/request/_create': {
      post: {
        tags: ['PGR'],
        operationId: 'pgrCreate',
        summary: 'Create a new PGR complaint',
        description:
          'Creates a citizen complaint. Requires a valid service code (from MDMS RAINMAKER-PGR.ServiceDefs), ' +
          'address with locality boundary code, and citizen info. The complaint enters PENDINGFORASSIGNMENT status.',
        parameters: [{ name: 'tenantId', in: 'query', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['RequestInfo', 'service', 'workflow'],
                properties: {
                  RequestInfo: { $ref: '#/components/schemas/RequestInfo' },
                  service: {
                    type: 'object',
                    required: ['tenantId', 'serviceCode', 'description', 'address', 'citizen'],
                    properties: {
                      tenantId: { type: 'string', example: 'pg.citya' },
                      serviceCode: { type: 'string', example: 'StreetLightNotWorking', description: 'From MDMS RAINMAKER-PGR.ServiceDefs' },
                      description: { type: 'string', example: 'Street light not working on Main Street' },
                      address: { $ref: '#/components/schemas/Address' },
                      citizen: {
                        type: 'object',
                        required: ['name', 'mobileNumber'],
                        properties: {
                          name: { type: 'string' },
                          mobileNumber: { type: 'string', pattern: '^[0-9]{10}$' },
                          type: { type: 'string', default: 'CITIZEN' },
                          roles: { type: 'array', items: { $ref: '#/components/schemas/Role' } },
                          tenantId: { type: 'string' },
                        },
                      },
                      source: { type: 'string', default: 'web' },
                      active: { type: 'boolean', default: true },
                      additionalDetail: { type: 'object' },
                    },
                  },
                  workflow: {
                    type: 'object',
                    properties: {
                      action: { type: 'string', enum: ['APPLY'], default: 'APPLY' },
                    },
                  },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Created complaint', content: { 'application/json': { schema: { type: 'object', properties: { ServiceWrappers: { type: 'array', items: { $ref: '#/components/schemas/ServiceWrapper' } } } } } } } },
      },
    },

    '/pgr-services/v2/request/_update': {
      post: {
        tags: ['PGR'],
        operationId: 'pgrUpdate',
        summary: 'Update a PGR complaint via workflow action',
        description:
          'Advances a complaint through its lifecycle. Actions: ASSIGN (GRO → LME), REASSIGN, ' +
          'RESOLVE (LME marks done), REJECT (GRO rejects), REOPEN (citizen), RATE (citizen rates 1-5 and closes). ' +
          'Fetch the complaint first via _search, then send the full service object with the workflow action.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['RequestInfo', 'service', 'workflow'],
                properties: {
                  RequestInfo: { $ref: '#/components/schemas/RequestInfo' },
                  service: { type: 'object', description: 'Full service object from _search response' },
                  workflow: {
                    type: 'object',
                    required: ['action'],
                    properties: {
                      action: { type: 'string', enum: ['ASSIGN', 'REASSIGN', 'RESOLVE', 'REJECT', 'REOPEN', 'RATE'] },
                      assignes: { type: 'array', items: { type: 'string' }, description: 'Employee UUIDs for ASSIGN/REASSIGN' },
                      comments: { type: 'string' },
                      rating: { type: 'integer', minimum: 1, maximum: 5, description: 'Citizen rating for RATE action' },
                      verificationDocuments: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            documentType: { type: 'string' },
                            fileStoreId: { type: 'string' },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Updated complaint', content: { 'application/json': { schema: { type: 'object', properties: { ServiceWrappers: { type: 'array', items: { $ref: '#/components/schemas/ServiceWrapper' } } } } } } } },
      },
    },

    // ════════════════════════════════════════════
    // WORKFLOW
    // ════════════════════════════════════════════
    '/egov-workflow-v2/egov-wf/businessservice/_search': {
      post: {
        tags: ['Workflow'],
        operationId: 'workflowBusinessServiceSearch',
        summary: 'Search workflow business service definitions',
        description: 'Returns state machine definitions showing states, actions, roles, and SLA for services like PGR.',
        parameters: [
          { name: 'tenantId', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'businessServices', in: 'query', schema: { type: 'string', description: 'Comma-separated service codes (e.g. "PGR")' } },
        ],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { RequestInfo: { $ref: '#/components/schemas/RequestInfo' } } } } } },
        responses: { '200': { description: 'Business service definitions', content: { 'application/json': { schema: { type: 'object', properties: { BusinessServices: { type: 'array', items: { type: 'object' } } } } } } } },
      },
    },

    '/egov-workflow-v2/egov-wf/businessservice/_create': {
      post: {
        tags: ['Workflow'],
        operationId: 'workflowBusinessServiceCreate',
        summary: 'Create a workflow business service definition',
        description: 'Registers a state machine (states, actions, transitions, roles, SLA) for a service. Required before PGR or other services work on a new tenant.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['RequestInfo', 'BusinessServices'],
                properties: {
                  RequestInfo: { $ref: '#/components/schemas/RequestInfo' },
                  BusinessServices: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        tenantId: { type: 'string' },
                        businessService: { type: 'string', example: 'PGR' },
                        business: { type: 'string', example: 'pgr-services' },
                        businessServiceSla: { type: 'integer', example: 259200000, description: 'SLA in milliseconds' },
                        states: {
                          type: 'array',
                          items: {
                            type: 'object',
                            properties: {
                              state: { type: 'string' },
                              applicationStatus: { type: 'string' },
                              isStartState: { type: 'boolean' },
                              isTerminateState: { type: 'boolean' },
                              actions: {
                                type: 'array',
                                items: {
                                  type: 'object',
                                  properties: {
                                    action: { type: 'string' },
                                    nextState: { type: 'string' },
                                    roles: { type: 'array', items: { type: 'string' } },
                                  },
                                },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Created business service', content: { 'application/json': { schema: { type: 'object', properties: { BusinessServices: { type: 'array', items: { type: 'object' } } } } } } } },
      },
    },

    '/egov-workflow-v2/egov-wf/process/_search': {
      post: {
        tags: ['Workflow'],
        operationId: 'workflowProcessSearch',
        summary: 'Search workflow process instances (audit trail)',
        description:
          'Returns the workflow transition history for specific business IDs (e.g. PGR complaint numbers). ' +
          'Shows who did what and when. NOTE: tenantId, businessIds, and history must be passed as query params, not in the body. ' +
          'Set history=true to get the full audit trail (all transitions); without it only the latest transition is returned.',
        parameters: [
          { name: 'tenantId', in: 'query' as const, required: true, schema: { type: 'string' as const } },
          { name: 'businessIds', in: 'query' as const, schema: { type: 'string' as const }, description: 'Comma-separated business IDs (e.g. PGR service request IDs)' },
          { name: 'history', in: 'query' as const, schema: { type: 'boolean' as const, default: false }, description: 'If true, returns all process instances (full audit trail). If false, returns only the latest.' },
          { name: 'limit', in: 'query' as const, schema: { type: 'integer' as const, default: 50 } },
          { name: 'offset', in: 'query' as const, schema: { type: 'integer' as const, default: 0 } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['RequestInfo'],
                properties: {
                  RequestInfo: { $ref: '#/components/schemas/RequestInfo' },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Process instances', content: { 'application/json': { schema: { type: 'object', properties: { ProcessInstances: { type: 'array', items: { type: 'object' } } } } } } } },
      },
    },

    // ════════════════════════════════════════════
    // LOCALIZATION
    // ════════════════════════════════════════════
    '/localization/messages/v1/_search': {
      post: {
        tags: ['Localization'],
        operationId: 'localizationSearch',
        summary: 'Search localization messages',
        description: 'Returns translated UI strings by locale and module. Used for verifying labels exist for departments, complaint types, etc.',
        parameters: [
          { name: 'tenantId', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'locale', in: 'query', required: true, schema: { type: 'string', default: 'en_IN' } },
          { name: 'module', in: 'query', schema: { type: 'string', example: 'rainmaker-pgr', description: 'Module filter' } },
        ],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { RequestInfo: { $ref: '#/components/schemas/RequestInfo' } } } } } },
        responses: { '200': { description: 'Localization messages', content: { 'application/json': { schema: { type: 'object', properties: { messages: { type: 'array', items: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' }, module: { type: 'string' }, locale: { type: 'string' } } } } } } } } } },
      },
    },

    '/localization/messages/v1/_upsert': {
      post: {
        tags: ['Localization'],
        operationId: 'localizationUpsert',
        summary: 'Create or update localization messages',
        description: 'Upserts translated strings — if a code exists it is updated, otherwise created. Use for adding UI labels for departments, complaint types, etc.',
        parameters: [
          { name: 'tenantId', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'locale', in: 'query', schema: { type: 'string', default: 'en_IN' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['RequestInfo', 'messages'],
                properties: {
                  RequestInfo: { $ref: '#/components/schemas/RequestInfo' },
                  messages: {
                    type: 'array',
                    items: {
                      type: 'object',
                      required: ['code', 'message', 'module', 'locale'],
                      properties: {
                        code: { type: 'string', example: 'DEPT_HEALTH' },
                        message: { type: 'string', example: 'Health Department' },
                        module: { type: 'string', example: 'rainmaker-common' },
                        locale: { type: 'string', example: 'en_IN' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Upserted messages', content: { 'application/json': { schema: { type: 'object', properties: { messages: { type: 'array', items: { type: 'object' } } } } } } } },
      },
    },

    // ════════════════════════════════════════════
    // FILESTORE
    // ════════════════════════════════════════════
    '/filestore/v1/files': {
      post: {
        tags: ['Filestore'],
        operationId: 'filestoreUpload',
        summary: 'Upload a file to DIGIT filestore',
        description: 'Multipart form upload. Returns a fileStoreId for use with other services (PGR attachments, boundary data, etc.).',
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['file', 'tenantId', 'module'],
                properties: {
                  file: { type: 'string', format: 'binary', description: 'File to upload' },
                  tenantId: { type: 'string' },
                  module: { type: 'string', example: 'PGR', description: 'Module name (PGR, HRMS, boundary, rainmaker-pgr)' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Upload result', content: { 'application/json': { schema: { type: 'object', properties: { files: { type: 'array', items: { type: 'object', properties: { fileStoreId: { type: 'string' } } } } } } } } },
        },
      },
    },

    '/filestore/v1/files/url': {
      get: {
        tags: ['Filestore'],
        operationId: 'filestoreGetUrls',
        summary: 'Get download URLs for files',
        description: 'Returns signed download URLs for one or more fileStoreIds.',
        parameters: [
          { name: 'tenantId', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'fileStoreIds', in: 'query', required: true, schema: { type: 'string', description: 'Comma-separated fileStoreIds' } },
        ],
        responses: {
          '200': { description: 'File URLs', content: { 'application/json': { schema: { type: 'object', properties: { fileStoreIds: { type: 'array', items: { type: 'object' } } } } } } },
        },
      },
    },

    // ════════════════════════════════════════════
    // ACCESS CONTROL
    // ════════════════════════════════════════════
    '/access/v1/roles/_search': {
      post: {
        tags: ['Access Control'],
        operationId: 'accessRolesSearch',
        summary: 'Search all defined roles',
        description: 'Returns all role codes, names, and descriptions. Used to verify role codes for employee assignments.',
        parameters: [{ name: 'tenantId', in: 'query', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { RequestInfo: { $ref: '#/components/schemas/RequestInfo' } } } } } },
        responses: { '200': { description: 'Roles list', content: { 'application/json': { schema: { type: 'object', properties: { roles: { type: 'array', items: { $ref: '#/components/schemas/Role' } } } } } } } },
      },
    },

    '/access/v1/actions/_search': {
      post: {
        tags: ['Access Control'],
        operationId: 'accessActionsSearch',
        summary: 'Search actions/permissions for specific roles',
        description: 'Shows which API endpoints and UI actions each role can access. Useful for debugging permission issues.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['RequestInfo', 'roleCodes', 'tenantId'],
                properties: {
                  RequestInfo: { $ref: '#/components/schemas/RequestInfo' },
                  roleCodes: { type: 'array', items: { type: 'string' }, example: ['GRO', 'PGR_LME'] },
                  tenantId: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Actions/permissions', content: { 'application/json': { schema: { type: 'object', properties: { actions: { type: 'array', items: { type: 'object' } } } } } } } },
      },
    },

    // ════════════════════════════════════════════
    // ID GENERATION
    // ════════════════════════════════════════════
    '/egov-idgen/id/_generate': {
      post: {
        tags: ['ID Generation'],
        operationId: 'idgenGenerate',
        summary: 'Generate unique formatted IDs',
        description: 'Produces formatted IDs (complaint numbers, application IDs) based on pre-configured patterns. Common idNames: pgr.servicerequestid, rainmaker.pgr.count.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['RequestInfo', 'idRequests'],
                properties: {
                  RequestInfo: { $ref: '#/components/schemas/RequestInfo' },
                  idRequests: {
                    type: 'array',
                    items: {
                      type: 'object',
                      required: ['idName', 'tenantId'],
                      properties: {
                        idName: { type: 'string', example: 'pgr.servicerequestid' },
                        tenantId: { type: 'string' },
                        format: { type: 'string', description: 'Custom ID format (e.g. "PG-PGR-[cy:yyyy-MM-dd]-[SEQ_PGR]")' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Generated IDs', content: { 'application/json': { schema: { type: 'object', properties: { idResponses: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' } } } } } } } } } },
      },
    },

    // ════════════════════════════════════════════
    // LOCATION (Legacy)
    // ════════════════════════════════════════════
    '/egov-location/location/v11/boundarys/_search': {
      post: {
        tags: ['Location'],
        operationId: 'locationSearch',
        summary: 'Search geographic boundaries (legacy)',
        description: 'Legacy egov-location service. Not available in all environments. Prefer boundary-service for newer deployments.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['RequestInfo', 'tenantId'],
                properties: {
                  RequestInfo: { $ref: '#/components/schemas/RequestInfo' },
                  tenantId: { type: 'string' },
                  boundaryType: { type: 'string', example: 'City' },
                  hierarchyType: { type: 'string', example: 'ADMIN' },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Boundary data', content: { 'application/json': { schema: { type: 'object', properties: { TenantBoundary: { type: 'array', items: { type: 'object' } } } } } } } },
      },
    },

    // ════════════════════════════════════════════
    // ENCRYPTION
    // ════════════════════════════════════════════
    '/egov-enc-service/crypto/v1/_encrypt': {
      post: {
        tags: ['Encryption'],
        operationId: 'encryptData',
        summary: 'Encrypt sensitive data',
        description: 'Encrypts plain text values. No authentication required — the service manages its own keys per tenant.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['encryptionRequests'],
                properties: {
                  encryptionRequests: {
                    type: 'array',
                    items: {
                      type: 'object',
                      required: ['tenantId', 'type', 'value'],
                      properties: {
                        tenantId: { type: 'string' },
                        type: { type: 'string', enum: ['Normal'], default: 'Normal' },
                        value: { type: 'string', description: 'Plain text to encrypt' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Encrypted values (flat string array)', content: { 'application/json': { schema: { type: 'array', items: { type: 'string' } } } } } },
      },
    },

    '/egov-enc-service/crypto/v1/_decrypt': {
      post: {
        tags: ['Encryption'],
        operationId: 'decryptData',
        summary: 'Decrypt encrypted data',
        description:
          'Decrypts previously encrypted values. Accepts a flat JSON array of encrypted strings ' +
          '(the same format returned by the encrypt endpoint). The encrypted string contains an ' +
          'embedded key reference so no tenantId is needed.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'array',
                items: { type: 'string', description: 'Encrypted value (e.g. "595525|xBCN...")' },
                description: 'Array of encrypted strings to decrypt',
              },
            },
          },
        },
        responses: { '200': { description: 'Decrypted values (flat string array)', content: { 'application/json': { schema: { type: 'array', items: { type: 'string' } } } } } },
      },
    },

    // ════════════════════════════════════════════
    // INBOX
    // ════════════════════════════════════════════

    '/inbox/v2/_search': {
      post: {
        tags: ['Inbox'],
        operationId: 'inboxV2Search',
        summary: 'Search inbox items for workflow-driven services',
        description:
          'Unified inbox search aggregating workflow items by status. Returns status counts (statusMap), ' +
          'total count, and paginated items with their workflow ProcessInstance and business object. ' +
          'Requires Elasticsearch to be running. Use v2 — v1 requires module-specific inbox configuration ' +
          'that may not be present for all services.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['RequestInfo', 'inbox'],
                properties: {
                  RequestInfo: { '$ref': '#/components/schemas/RequestInfo' },
                  inbox: {
                    type: 'object',
                    required: ['tenantId', 'processSearchCriteria'],
                    properties: {
                      tenantId: { type: 'string', description: 'City-level tenant ID (e.g. "pg.citya")', example: 'pg.citya' },
                      processSearchCriteria: {
                        type: 'object',
                        required: ['businessService', 'moduleName'],
                        properties: {
                          businessService: {
                            type: 'array',
                            items: { type: 'string' },
                            description: 'Business service codes to search',
                            example: ['PGR'],
                          },
                          moduleName: {
                            type: 'string',
                            description: 'Module name for the service',
                            example: 'pgr-services',
                          },
                        },
                      },
                      moduleSearchCriteria: {
                        type: 'object',
                        description: 'Module-specific filter criteria (empty object for unfiltered)',
                        additionalProperties: true,
                      },
                      limit: { type: 'integer', description: 'Page size', default: 10 },
                      offset: { type: 'integer', description: 'Pagination offset', default: 0 },
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Inbox search results with status aggregation',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    statusMap: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          statusid: { type: 'string', format: 'uuid' },
                          count: { type: 'integer' },
                          state: { type: 'string', example: 'PENDINGFORASSIGNMENT' },
                          applicationstatus: { type: 'string' },
                          businessservice: { type: 'string', example: 'PGR' },
                        },
                      },
                      description: 'Aggregated complaint counts by workflow state',
                    },
                    totalCount: { type: 'integer', description: 'Total matching items' },
                    items: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          ProcessInstance: {
                            type: 'object',
                            description: 'Workflow state for this item',
                            properties: {
                              state: {
                                type: 'object',
                                properties: {
                                  state: { type: 'string', example: 'PENDINGFORASSIGNMENT' },
                                  applicationStatus: { type: 'string' },
                                },
                              },
                              action: { type: 'string', example: 'ASSIGN' },
                              businessService: { type: 'string', example: 'PGR' },
                              businessId: { type: 'string', example: 'PG-PGR-2026-01-15-000001' },
                            },
                          },
                          businessObject: {
                            type: 'object',
                            description: 'The actual service object (e.g. PGR ServiceWrapper)',
                            properties: {
                              service: { '$ref': '#/components/schemas/ServiceWrapper' },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  };
}

// ── Shared component schemas ──

function buildComponents(): Record<string, unknown> {
  return {
    securitySchemes: {
      basicAuth: {
        type: 'http',
        scheme: 'basic',
        description: 'OAuth2 client credentials: egov-user-client (no secret)',
      },
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        description: 'Access token from /user/oauth/token, passed in RequestInfo.authToken',
      },
    },
    schemas: {
      RequestInfo: {
        type: 'object',
        description: 'Standard DIGIT request header. Included in the JSON body of every API call.',
        required: ['apiId', 'msgId'],
        properties: {
          apiId: { type: 'string', example: 'Rainmaker', description: 'Fixed API identifier' },
          ver: { type: 'string', example: '1.0' },
          ts: { type: 'integer', description: 'Current epoch timestamp in milliseconds' },
          action: { type: 'string' },
          did: { type: 'string' },
          key: { type: 'string' },
          msgId: { type: 'string', example: '1234567890|en_IN', description: 'Message ID, format: timestamp|locale' },
          authToken: { type: 'string', description: 'Bearer token from OAuth login' },
          userInfo: { $ref: '#/components/schemas/UserInfo' },
        },
      },

      UserInfo: {
        type: 'object',
        description: 'DIGIT user object',
        properties: {
          id: { type: 'integer' },
          uuid: { type: 'string', format: 'uuid' },
          userName: { type: 'string' },
          name: { type: 'string' },
          mobileNumber: { type: 'string' },
          emailId: { type: 'string', format: 'email' },
          type: { type: 'string', enum: ['CITIZEN', 'EMPLOYEE', 'SYSTEM'] },
          tenantId: { type: 'string' },
          roles: { type: 'array', items: { $ref: '#/components/schemas/Role' } },
        },
      },

      Role: {
        type: 'object',
        description: 'User role assignment',
        required: ['code', 'name'],
        properties: {
          code: { type: 'string', example: 'GRO', description: 'Role code (e.g. GRO, PGR_LME, DGRO, EMPLOYEE, CITIZEN, SUPERUSER)' },
          name: { type: 'string', example: 'Grievance Routing Officer' },
          tenantId: { type: 'string', description: 'Tenant scope for this role assignment' },
          description: { type: 'string' },
        },
      },

      MdmsRecord: {
        type: 'object',
        description: 'Master data record from MDMS v2',
        properties: {
          id: { type: 'string' },
          tenantId: { type: 'string' },
          schemaCode: { type: 'string' },
          uniqueIdentifier: { type: 'string' },
          data: { type: 'object', description: 'Record payload (varies by schema)' },
          isActive: { type: 'boolean' },
          auditDetails: {
            type: 'object',
            properties: {
              createdBy: { type: 'string' },
              createdTime: { type: 'integer' },
              lastModifiedBy: { type: 'string' },
              lastModifiedTime: { type: 'integer' },
            },
          },
        },
      },

      Employee: {
        type: 'object',
        description: 'HRMS employee record',
        properties: {
          id: { type: 'integer' },
          uuid: { type: 'string' },
          code: { type: 'string', description: 'Employee code (auto-generated)' },
          tenantId: { type: 'string' },
          user: { $ref: '#/components/schemas/UserInfo' },
          employeeStatus: { type: 'string', example: 'EMPLOYED' },
          employeeType: { type: 'string', example: 'PERMANENT' },
          dateOfAppointment: { type: 'integer', description: 'Epoch millis' },
          assignments: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                department: { type: 'string', example: 'DEPT_1' },
                designation: { type: 'string', example: 'DESIG_1' },
                fromDate: { type: 'integer' },
                toDate: { type: 'integer', nullable: true },
                isCurrentAssignment: { type: 'boolean' },
              },
            },
          },
          jurisdictions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                hierarchy: { type: 'string', example: 'ADMIN' },
                boundaryType: { type: 'string', example: 'City' },
                boundary: { type: 'string', example: 'pg.citya' },
              },
            },
          },
        },
      },

      ServiceWrapper: {
        type: 'object',
        description: 'PGR complaint wrapper with service and workflow',
        properties: {
          service: {
            type: 'object',
            properties: {
              serviceRequestId: { type: 'string', example: 'PG-PGR-2026-01-15-000001' },
              tenantId: { type: 'string' },
              serviceCode: { type: 'string', example: 'StreetLightNotWorking' },
              description: { type: 'string' },
              applicationStatus: { type: 'string', enum: ['PENDINGFORASSIGNMENT', 'PENDINGATLME', 'PENDINGFORREASSIGNMENT', 'RESOLVED', 'REJECTED', 'CLOSEDAFTERRESOLUTION'] },
              address: { $ref: '#/components/schemas/Address' },
              citizen: { $ref: '#/components/schemas/UserInfo' },
              active: { type: 'boolean' },
              auditDetails: { type: 'object' },
            },
          },
          workflow: {
            type: 'object',
            properties: {
              action: { type: 'string' },
              assignes: { type: 'array', items: { type: 'string' } },
              comments: { type: 'string' },
            },
          },
        },
      },

      Address: {
        type: 'object',
        description: 'Address with locality boundary reference',
        properties: {
          tenantId: { type: 'string' },
          landmark: { type: 'string' },
          city: { type: 'string' },
          district: { type: 'string' },
          region: { type: 'string' },
          pincode: { type: 'string' },
          locality: {
            type: 'object',
            required: ['code'],
            properties: {
              code: { type: 'string', description: 'Boundary locality code (from boundary-service)' },
              name: { type: 'string' },
            },
          },
          geoLocation: {
            type: 'object',
            properties: {
              latitude: { type: 'number' },
              longitude: { type: 'number' },
            },
          },
        },
      },
    },
  };
}

// ── Utility: get unique tag names ──

export function getServiceTags(): string[] {
  return TAGS.map((t) => t.name as string);
}

// ── Utility: count endpoints per tag ──

export function getServiceSummary(spec: OpenApiSpec): Array<{ service: string; description: string; endpointCount: number; endpoints: string[] }> {
  const tagMap = new Map<string, { description: string; endpoints: string[] }>();

  for (const tag of TAGS) {
    tagMap.set(tag.name as string, { description: tag.description as string, endpoints: [] });
  }

  for (const [path, methods] of Object.entries(spec.paths)) {
    for (const [method, op] of Object.entries(methods)) {
      const operation = op as Record<string, unknown>;
      const tags = (operation.tags || []) as string[];
      const summary = (operation.summary || '') as string;
      for (const tag of tags) {
        const entry = tagMap.get(tag);
        if (entry) {
          entry.endpoints.push(`${method.toUpperCase()} ${path} — ${summary}`);
        }
      }
    }
  }

  return Array.from(tagMap.entries()).map(([service, data]) => ({
    service,
    description: data.description,
    endpointCount: data.endpoints.length,
    endpoints: data.endpoints,
  }));
}
