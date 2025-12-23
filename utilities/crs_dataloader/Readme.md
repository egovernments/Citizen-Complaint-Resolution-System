# CRS Data Loader

A comprehensive tool for loading master data into the CRS (Citizen Complaint Resolution System) platform through an interactive, phase-based workflow.

---

## Overview

The CRS Data Loader provides a streamlined approach to setting up a new tenant with all required master data. It features:

- **4-Phase Workflow** for structured data loading
- **Interactive Jupyter Notebooks** with user-friendly widgets
- **Gateway Authentication** with OAuth2 support
- **Auto-generated Codes** for departments, designations, and complaint types
- **Comprehensive Validation** against MDMS schemas
- **Localization Support** with auto-generated translations

---

## Table of Contents

1. [System Requirements](#system-requirements)
2. [Installation](#installation)
3. [Quick Start](#quick-start)
4. [4-Phase Workflow](#4-phase-workflow)
5. [File Structure](#file-structure)
6. [Templates Guide](#templates-guide)
7. [Authentication](#authentication)
8. [Usage Guide](#usage-guide)
9. [Features](#features)

---

## System Requirements

- **Python:** 3.8 or higher
- **Operating System:** Windows 10+, macOS 10.14+, Ubuntu 18.04+
- **RAM:** 4GB minimum, 8GB recommended
- **Disk Space:** 500MB free space
- **Network:** Internet connection for API calls

---



## Quick Start

### Main DataLoader (All Phases)

```bash
jupyter notebook DataLoader.ipynb
```

This notebook provides a unified interface for all 4 phases with gateway authentication.

### Phase-Specific Notebooks

```bash
cd Notebooks

# Choose a specific phase:
jupyter notebook 1_TenantAndCommonMaster.ipynb
jupyter notebook 2_BoundarySetup.ipynb
jupyter notebook 3_EmployeeOnboarding.ipynb
```

---

## 4-Phase Workflow

### **Phase 1: Tenant & Branding Setup**
- **Template:** `Tenant And Branding Master.xlsx`
- **Purpose:** Create tenant configuration and branding
- **Outputs:** Tenant master data, city configuration, branding settings, localizations

### **Phase 2: Boundary Master**
- **Input:** User provides boundary hierarchy via UI
- **Purpose:** Define geographic boundaries
- **Outputs:** Boundary hierarchy, entities with GeoJSON, parent-child relationships

### **Phase 3: Common Masters**
- **Template:** `Common and Complaint Master.xlsx`
- **Purpose:** Load departments, designations, and complaint types
- **Outputs:** Departments, designations, complaint types, localizations

### **Phase 4: Employee Master**
- **Input:** Employee details via UI form
- **Purpose:** Onboard employees with roles and jurisdictions
- **Outputs:** Employee records, user accounts, role assignments, jurisdiction mappings

---

## File Structure

```
crs_dataloader/
├── DataLoader.ipynb                 # Main unified notebook
├── fetch_localization_ui.ipynb     # Localization management
├── unified_loader.py               # Core data loading logic
├── mdms_validator.py               # MDMS schema validation
├── requirements.txt                # Python dependencies
├── .env.example                    # Environment config template
│
├── Notebooks/                      # Phase-specific notebooks
│   ├── 1_TenantAndCommonMaster.ipynb
│   ├── 2_BoundarySetup.ipynb
│   └── 3_EmployeeOnboarding.ipynb
│
├── templates/                      # Excel templates
│   ├── Tenant And Branding Master.xlsx
│   ├── Common and Complaint Master.xlsx
│   ├── Employee_Master_Dynamic_statea.xlsx
│   └── localization.xlsx
│
└── upload/                         # User uploaded files
```

---

## Templates Guide

### 1. Tenant And Branding Master.xlsx

**Sheet: Tenant Info**
- Tenant Display Name*
- Tenant Code* (assigned by admin)
- Tenant Type* (ADMIN0/ADMIN1/ADMIN2)
- Logo File Path*
- City Name, District Name
- Latitude, Longitude
- Address, Tenant Website

**Sheet: Tenant Branding Details**
- Banner URL
- Logo URL
- Logo URL (White)
- State Logo

### 2. Common and Complaint Master.xlsx

**Sheet: Department And Designation Master**
- Department Name* (auto-generates DEPT_1, DEPT_2...)
- Designation Name* (auto-generates DESIG_01, DESIG_02...)

**Sheet: Complaint Type Master**
- Complaint Type* (parent category)
- Complaint sub type* (service code auto-generated)
- Department Name*
- Resolution Time (Hours)*
- Search Words (comma separated)*
- Priority

### 3. Employee Master

**Fields:**
- User Name*
- Mobile Number*
- Password (default: eGov@123)
- Department Name*
- Designation Name*
- Role Name*
- Assignment From Date*, To Date
- Date of Appointment*
- Boundary selections

---

## Authentication

The CRS Data Loader uses OAuth2 authentication:

1. Click "Authenticate with Gateway" button
2. Enter username and password
3. System fetches auth token and user info
4. Proceed with data loading

**Required Roles:** MDMS_ADMIN, SUPERUSER, or LOC_ADMIN

---

## Usage Guide

### Phase 1: Tenant & Branding

1. Fill `Tenant And Branding Master.xlsx`
2. Open `DataLoader.ipynb`
3. Authenticate with gateway
4. Upload Excel file
5. Click "Load Tenant & Branding Data"
6. Review success/error messages

### Phase 2: Boundary Setup

1. Open `2_BoundarySetup.ipynb`
2. Select hierarchy type (ADMIN/REVENUE)
3. Add boundary levels via UI
4. Define parent-child relationships
5. Click "Upload Boundaries"

### Phase 3: Common Masters

1. Fill `Common and Complaint Master.xlsx`
2. Open `DataLoader.ipynb`
3. Upload Excel file
4. Click "Load Departments & Designations"
5. Click "Load Complaint Types"

### Phase 4: Employee Onboarding

1. Open `3_EmployeeOnboarding.ipynb`
2. Fill employee details in UI form
3. Select department, designation, role (by name)
4. Select jurisdiction boundaries
5. Click "Create Employee"

---

## Features

### Auto Code Generation
- Departments: DEPT_1, DEPT_2, DEPT_3...
- Designations: DESIG_01, DESIG_02, DESIG_03...
- Service Codes: Derived from complaint names
- Employee Codes: Derived from user names

### Localization Support
- Auto-generates localization entries
- Supports multiple locales (en_IN default)
- Bulk upload/download via UI

### Validation
- Excel schema validation
- MDMS schema validation
- Reference integrity checks
- Duplicate detection

### Interactive UI
- File upload widgets
- Progress indicators
- Success/error notifications
- Data preview tables

### Advanced Capabilities
- Incremental loading (continues from existing data)
- Batch processing for multiple records
- Relationship mapping (departments to designations)
- Hierarchical structures (parent-child complaint types)
- Cross-platform support (Windows, macOS, Linux)
- Multi-tenant support (ADMIN0/ADMIN1/ADMIN2)

## Support

For issues or questions, please create an issue in the repository or contact the development team.

---

**Last Updated:** December 2024
