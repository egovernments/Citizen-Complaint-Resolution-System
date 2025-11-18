# Unified Loader Updates - Complete Summary

## ✅ Files Updated

1. **`unified_loader.py`** - Core data loading module
2. **`pgr_master_data_unified_schema.yaml`** - Validation schema

---

## 📋 Changes in unified_loader.py

### **1. read_tenants() - Updated column names**

**Changed from:**
- `Tenant Code` → `Tenant Code*`
- `Tenant Name` → `Tenant Name*`
- `Email` → `Email*`
- `City Code` → `City Code*`
- All other city fields updated with `*`

**Optional fields handling:**
- `Contact Number`, `Address`, `Logo URL` - Now properly handled as optional with `.get()`

---

### **2. read_city_modules() - Updated column names**

**Changed from:**
- `Module Code` → `Module Code*`
- `Module Name` → `Module Name*`
- `Order` → `Order*`
- `Enabled Tenant Codes` → `Enabled Tenant Codes*`

---

### **3. read_departments() - Updated column names**

**Changed from:**
- `Department Code` → `Department Code*`
- `Department Name` → `Department Name*`

---

### **4. read_designations() - Updated column names**

**Changed from:**
- `Designation Code` → `Designation Code*`
- `Designation Name` → `Designation Name*`
- `Department Code` → `Department Code*`

---

### **5. read_complaint_types() - ⭐ COMPLETELY REWRITTEN**

**Old Logic:**
```python
# Simple flat structure
serviceCode = row['Service Code']
name = row['Complaint Name']
menuPath = row['Category/Menu Path']
```

**New Hierarchical Logic:**
```python
# Handles Parent Type → Sub Types structure
# Tracks current parent across rows
# Auto-generates service codes from sub-type names
```

**Key Features:**
1. **Parent Tracking**: Remembers current parent category across rows
2. **Auto-Generate Service Codes**: 
   - Input: `"Streetlight not working"`
   - Output: `"StreetlightNotWorking"`
3. **Inherit Parent Properties**: Department, SLA, Keywords, Priority
4. **Menu Path**: Uses parent type name as menu path

**Excel Pattern Handling:**
```
Row 1: Street Lights | STREETLIGHTS | Light not working | DEPT_1 | 336 | keywords
  → Creates: serviceCode="LightNotWorking", menuPath="Street Lights", department=DEPT_1

Row 2: (empty) | (empty) | Water tap broken | (empty) | (empty) | (empty)
  → Creates: serviceCode="WaterTapBroken", menuPath="Street Lights", department=DEPT_1
```

---

### **6. read_localization() - ⭐ AUTO-DETERMINATION LOGIC**

**Old Structure:**
```python
# Expected Module and Locale columns in Excel
module = row['Module']
locale = row['Locale']
```

**New Auto-Detection:**
```python
# Determines module/locale from code pattern
if code.startswith('SERVICEDFS.'):
    module = 'rainmaker-pgr'
    locale = 'en_IN'
elif code.startswith('COMMON_MASTERS_'):
    module = 'rainmaker-common'
    locale = 'en_IN'
elif code.startswith('TENANT_TENANTS_'):
    module = 'rainmaker-dss'
    locale = 'en_IN'
else:
    module = 'rainmaker-common'  # default
    locale = 'en_IN'
```

**Code Pattern Examples:**
| Code | Module | Locale |
|------|--------|--------|
| `SERVICEDFS.STREETLIGHTNOTWORKING` | `rainmaker-pgr` | `en_IN` |
| `COMMON_MASTERS_DEPARTMENT_DEPT_1` | `rainmaker-common` | `en_IN` |
| `TENANT_TENANTS_PG` | `rainmaker-dss` | `en_IN` |

**Sheet Name Flexibility:**
- Tries `Localization` first
- Falls back to `localization` (lowercase)
- Returns empty list if neither exists

---

## 📋 Changes in pgr_master_data_unified_schema.yaml

### **1. All Column Names Updated**
- Added `*` asterisk to all required field names
- Updated all references to use new column names

### **2. Tenants Sheet**
- Made more fields required: `Image ID*`, `City District Code*`, `City DDR Name*`, etc.
- Made some optional: `Contact Number`, `Address`, `Logo URL`

### **3. ComplaintTypes Sheet - New Structure**

**Columns:**
```yaml
- Complaint Type* (Parent - first row only)
- Complaint Type Code (Parent code - first row only)
- Complaint Sub Type* (Always required)
- Complaint Sub Type Code (Auto-generated - leave empty)
- Department Code* (First row only)
- SLA Hours* (First row only - float type)
- DescriptionKeywords (comma separated)* (First row only)
- Priority (Optional - float type)
```

**Validation:**
- `Complaint Sub Type*` - Always required
- Parent fields - Required=false (conditional on being first row)
- `SLA Hours*` - Changed from string to float
- `Priority` - Changed from string to float

### **4. Localization Sheet - Simplified**

**Old:**
```yaml
- Module (required)
- Code (required)
- Message (required)
- Locale (required)
```

**New:**
```yaml
- Code (required, pattern: ^[A-Z_.]+$)
- Message (required)
```

**Note:** Module and Locale are auto-determined by code pattern, not in Excel

### **5. Boundary Sheets - REMOVED FROM VALIDATION**

Removed validation for:
- `Hierarchy_Definition`
- `Boundary_Entities`
- `Boundary_Relationships`

**Reason:** Boundaries are handled separately in the unified dataloader, not validated in this schema.

---

## 🔄 Data Flow

### **Complaint Types Processing:**

```
Excel Row 1:
  Complaint Type*: "Street Lights"
  Complaint Type Code: "STREETLIGHTS"
  Complaint Sub Type*: "Streetlight not working"
  Department Code*: "DEPT_1"
  SLA Hours*: 336
  Keywords*: "light,repair"
  Priority: 1

Python Processing:
  1. Detects parent row (has Complaint Type filled)
  2. Stores parent info: {type, department, SLA, keywords, priority}
  3. Creates service code: "StreetlightNotWorking"
  4. Builds payload:
     {
       serviceCode: "StreetlightNotWorking",
       name: "Streetlight not working",
       menuPath: "Street Lights",
       department: "DEPT_1",
       slaHours: 336,
       keywords: "light,repair",
       priority: 1
     }

Excel Row 2:
  Complaint Type*: (empty)
  Complaint Sub Type*: "Water tap broken"
  (all other fields empty)

Python Processing:
  1. No new parent (uses previous parent)
  2. Creates service code: "WaterTapBroken"
  3. Inherits parent properties
  4. Builds payload:
     {
       serviceCode: "WaterTapBroken",
       name: "Water tap broken",
       menuPath: "Street Lights",
       department: "DEPT_1",
       slaHours: 336,
       keywords: "light,repair",
       priority: 1
     }
```

### **Localization Processing:**

```
Excel:
  Code: "SERVICEDFS.STREETLIGHTNOTWORKING"
  Message: "Streetlight not working"

Python Processing:
  1. Reads code: "SERVICEDFS.STREETLIGHTNOTWORKING"
  2. Detects pattern: starts with "SERVICEDFS."
  3. Auto-assigns:
     module = "rainmaker-pgr"
     locale = "en_IN"
  4. Builds payload:
     {
       code: "SERVICEDFS.STREETLIGHTNOTWORKING",
       message: "Streetlight not working",
       module: "rainmaker-pgr",
       locale: "en_IN"
     }
```

---

## ✅ Testing Checklist

- [ ] Test Tenants with asterisk columns
- [ ] Test City_Modules with asterisk columns
- [ ] Test Departments with asterisk columns
- [ ] Test Designations with asterisk columns
- [ ] Test hierarchical ComplaintTypes (parent + sub-types)
- [ ] Test auto-generated service codes
- [ ] Test Localization with SERVICEDFS.* codes → rainmaker-pgr
- [ ] Test Localization with COMMON_MASTERS_* codes → rainmaker-common
- [ ] Test Localization with TENANT_TENANTS_* codes → rainmaker-dss
- [ ] Test optional fields handling (Contact Number, Address, etc.)

---

## 🚨 Breaking Changes

1. **All column names must include asterisks** for required fields
2. **ComplaintTypes structure is completely different** - cannot use old templates
3. **Localization no longer needs Module/Locale columns** - auto-determined
4. **Service codes are auto-generated** from complaint sub-type names
5. **SLA Hours and Priority are now float** - use numbers, not strings

---

## 💡 Migration Guide

### From Old Template to New:

1. **Rename all required columns** - Add `*` asterisk
2. **Restructure ComplaintTypes:**
   - Group by parent category
   - First row: Fill parent fields + first sub-type
   - Subsequent rows: Only fill Complaint Sub Type*
3. **Update Localization:**
   - Remove Module column
   - Remove Locale column
   - Keep only Code and Message
4. **Update data types:**
   - SLA Hours: Use numbers (336) not strings ("336")
   - Priority: Use numbers (1) not strings ("1")

---

## 📞 Support

For issues or questions:
1. Check SCHEMA_UPDATES.md for detailed schema changes
2. Review sample data in Final_NEW_PGR_Master_Data_UNIFIED.xlsx
3. Run validation before uploading
4. Check error messages for specific field issues
