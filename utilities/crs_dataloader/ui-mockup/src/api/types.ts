// DIGIT API Types

// ============================================
// Common Types
// ============================================

export interface UserInfo {
  id?: number;
  uuid?: string;
  userName: string;
  name: string;
  mobileNumber?: string;
  emailId?: string;
  type?: string;
  tenantId: string;
  roles?: Role[];
}

export interface Role {
  code: string;
  name: string;
  tenantId?: string;
  description?: string;
}

export interface RequestInfo {
  apiId: string;
  ver?: string;
  ts?: number;
  action?: string;
  did?: string;
  key?: string;
  msgId: string;
  authToken: string;
  userInfo?: UserInfo;
  plainAccessRequest?: Record<string, unknown>;
}

export interface ApiError {
  code: string;
  message: string;
  description?: string;
  params?: string[];
}

export interface ApiResponse<T = unknown> {
  ResponseInfo?: {
    apiId: string;
    ver: string;
    ts: number;
    resMsgId: string;
    msgId: string;
    status: string;
  };
  Errors?: ApiError[];
  [key: string]: T | ApiError[] | unknown;
}

// ============================================
// Authentication Types
// ============================================

export interface LoginRequest {
  username: string;
  password: string;
  tenantId: string;
  userType?: 'EMPLOYEE' | 'CITIZEN';
}

export interface LoginResponse {
  access_token: string;
  token_type: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  UserRequest: UserInfo;
}

export interface AuthState {
  isAuthenticated: boolean;
  token: string | null;
  user: UserInfo | null;
  environment: string;
  tenantId: string;
}

// ============================================
// MDMS Types
// ============================================

export interface MdmsSearchRequest {
  RequestInfo: RequestInfo;
  MdmsCriteria: {
    tenantId: string;
    schemaCode: string;
    uniqueIdentifiers?: string[];
    limit?: number;
    offset?: number;
  };
}

export interface MdmsCreateRequest {
  RequestInfo: RequestInfo;
  Mdms: {
    tenantId: string;
    schemaCode: string;
    uniqueIdentifier: string;
    data: Record<string, unknown>;
    isActive: boolean;
  };
}

export interface MdmsRecord {
  id: string;
  tenantId: string;
  schemaCode: string;
  uniqueIdentifier: string;
  data: Record<string, unknown>;
  isActive: boolean;
  auditDetails?: {
    createdBy: string;
    createdTime: number;
    lastModifiedBy: string;
    lastModifiedTime: number;
  };
}

// Department
export interface Department {
  code: string;
  name: string;
  active: boolean;
  tenantId?: string;
}

// Designation
export interface Designation {
  code: string;
  name: string;
  department?: string;
  active: boolean;
  tenantId?: string;
}

// Complaint Type / Service Definition
export interface ComplaintType {
  serviceCode: string;
  serviceName: string;
  department: string;
  slaHours: number;
  menuPath?: string;
  active: boolean;
  order?: number;
}

// Tenant
export interface Tenant {
  code: string;
  name: string;
  description?: string;
  logoId?: string;
  emailId?: string;
  address?: string;
  contactNumber?: string;
  city?: {
    name: string;
    code: string;
    districtCode?: string;
    districtName?: string;
    latitude?: number;
    longitude?: number;
  };
}

// ============================================
// Boundary Types
// ============================================

export interface BoundaryHierarchy {
  tenantId: string;
  hierarchyType: string;
  boundaryHierarchy: BoundaryLevel[];
}

export interface BoundaryLevel {
  boundaryType: string;
  parentBoundaryType?: string;
  active: boolean;
}

export interface Boundary {
  id?: string;
  tenantId: string;
  code: string;
  name: string;
  boundaryType: string;
  parent?: string;
  hierarchyType: string;
  latitude?: number;
  longitude?: number;
  children?: Boundary[];
}

export interface BoundarySearchRequest {
  RequestInfo: RequestInfo;
  Boundary: {
    tenantId: string;
    hierarchyType?: string;
    boundaryType?: string;
    codes?: string[];
    limit?: number;
    offset?: number;
  };
}

export interface BoundarySearchResponse {
  TenantBoundary: {
    tenantId: string;
    hierarchyType: string;
    boundary: Boundary;
  }[];
}

// ============================================
// HRMS / Employee Types
// ============================================

export interface Employee {
  id?: string;
  uuid?: string;
  code: string;
  tenantId: string;
  user: EmployeeUser;
  dateOfAppointment?: number;
  employeeStatus: string;
  employeeType: string;
  jurisdictions: EmployeeJurisdiction[];
  assignments: EmployeeAssignment[];
  documents?: EmployeeDocument[];
  auditDetails?: {
    createdBy: string;
    createdTime: number;
    lastModifiedBy: string;
    lastModifiedTime: number;
  };
}

export interface EmployeeUser {
  id?: number;
  uuid?: string;
  userName: string;
  password?: string;
  name: string;
  mobileNumber: string;
  emailId?: string;
  gender?: string;
  dob?: number;
  type?: string;
  active?: boolean;
  tenantId?: string;
  roles: Role[];
}

export interface EmployeeJurisdiction {
  id?: string;
  boundary: string;
  boundaryType: string;
  hierarchyType: string;
  isActive?: boolean;
}

export interface EmployeeAssignment {
  id?: string;
  position?: string;
  designation: string;
  department: string;
  fromDate: number;
  toDate?: number;
  govtOrderNumber?: string;
  isCurrentAssignment: boolean;
  isHod?: boolean;
}

export interface EmployeeDocument {
  documentType: string;
  fileName: string;
  fileStoreId: string;
}

export interface EmployeeCreateRequest {
  RequestInfo: RequestInfo;
  Employees: Employee[];
}

export interface EmployeeSearchRequest {
  RequestInfo: RequestInfo;
  criteria: {
    tenantId: string;
    codes?: string[];
    departments?: string[];
    designations?: string[];
    roles?: string[];
    limit?: number;
    offset?: number;
  };
}

// ============================================
// Localization Types
// ============================================

export interface LocalizationMessage {
  code: string;
  message: string;
  module: string;
  locale: string;
}

export interface LocalizationUpsertRequest {
  RequestInfo: RequestInfo;
  tenantId: string;
  locale: string;
  messages: LocalizationMessage[];
}

// ============================================
// File Upload Types
// ============================================

export interface FileUploadResponse {
  files: {
    fileStoreId: string;
    fileName: string;
    tenantId: string;
  }[];
}

// ============================================
// Excel Data Types (for parsing uploads)
// ============================================

export interface TenantExcelRow {
  tenantCode: string;
  tenantName: string;
  displayName: string;
  tenantType: string;
  cityName?: string;
  districtName?: string;
  latitude?: number;
  longitude?: number;
  logoPath?: string;
}

export interface BoundaryExcelRow {
  code: string;
  name: string;
  boundaryType: string;
  parentCode?: string;
  latitude?: number;
  longitude?: number;
}

export interface DepartmentExcelRow {
  code: string;
  name: string;
  active: boolean;
}

export interface DesignationExcelRow {
  code: string;
  name: string;
  department?: string;
  active: boolean;
}

export interface ComplaintTypeExcelRow {
  serviceCode: string;
  serviceName: string;
  department: string;
  slaHours: number;
  active: boolean;
}

export interface EmployeeExcelRow {
  employeeCode: string;
  name: string;
  userName: string;
  mobileNumber: string;
  emailId?: string;
  gender?: string;
  department: string;
  designation: string;
  roles: string; // comma-separated
  jurisdictions: string; // comma-separated boundary codes
  dateOfAppointment?: string;
}

// ============================================
// Validation Types
// ============================================

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  row?: number;
  field: string;
  value?: string;
  message: string;
  code: string;
}

export interface ValidationWarning {
  row?: number;
  field: string;
  value?: string;
  message: string;
}

// ============================================
// Phase Status Types
// ============================================

export interface PhaseStatus {
  phase: number;
  name: string;
  status: 'pending' | 'in_progress' | 'completed' | 'error';
  itemsCreated?: number;
  itemsFailed?: number;
  errorMessage?: string;
}

export interface SetupProgress {
  currentPhase: number;
  phases: PhaseStatus[];
  tenant?: Tenant;
  hierarchyType?: string;
  totalBoundaries?: number;
  totalDepartments?: number;
  totalDesignations?: number;
  totalComplaintTypes?: number;
  totalEmployees?: number;
}
