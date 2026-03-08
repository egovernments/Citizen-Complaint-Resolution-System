// DIGIT API - Main Export
export { apiClient, ApiClientError, DigitApiClient } from './client';
export { ENVIRONMENTS, ENDPOINTS, MDMS_SCHEMAS, OAUTH_CONFIG, DEFAULT_PASSWORD, PGR_ROLES } from './config';
export type { Environment } from './config';

// Services
export { mdmsService } from './services/mdms';
export { boundaryService } from './services/boundary';
export { hrmsService } from './services/hrms';
export { localizationService } from './services/localization';

// Types
export type {
  // Common
  UserInfo,
  Role,
  RequestInfo,
  ApiError,
  ApiResponse,

  // Auth
  LoginRequest,
  LoginResponse,
  AuthState,

  // MDMS
  MdmsSearchRequest,
  MdmsCreateRequest,
  MdmsRecord,
  Department,
  Designation,
  ComplaintType,
  Tenant,

  // Boundary
  BoundaryHierarchy,
  BoundaryLevel,
  Boundary,
  BoundarySearchRequest,
  BoundarySearchResponse,

  // HRMS
  Employee,
  EmployeeUser,
  EmployeeJurisdiction,
  EmployeeAssignment,
  EmployeeDocument,
  EmployeeCreateRequest,
  EmployeeSearchRequest,

  // Localization
  LocalizationMessage,
  LocalizationUpsertRequest,

  // File Upload
  FileUploadResponse,

  // Excel Data Types
  TenantExcelRow,
  BoundaryExcelRow,
  DepartmentExcelRow,
  DesignationExcelRow,
  ComplaintTypeExcelRow,
  EmployeeExcelRow,

  // Validation
  ValidationResult,
  ValidationError,
  ValidationWarning,

  // Progress
  PhaseStatus,
  SetupProgress,
} from './types';
