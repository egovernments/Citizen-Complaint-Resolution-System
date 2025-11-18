# Schema Updates Summary

## ✅ Changes Made to pgr_master_data_unified_schema.yaml

### 1. **Column Names Updated with Asterisk (*) for Required Fields**

All column names now match the Excel template exactly, including asterisks for required fields.

---

### 2. **Tenants Sheet**
- Updated all column names to include `*` for required fields
- Made several fields **required** that were optional:
  - `Image ID*` - Now required
  - `City District Code*` - Now required
  - `City District Name*` - Now required
  - `City DDR Name*` - Now required
  - `City Region Name*` - Now required
  - `City Local Name*` - Now required
  - `City Shape File Location*` - Now required
  - `City Captcha*` - Now required

- Made several fields **optional** that were required:
  - `Contact Number` - Now optional
  - `Address` - Now optional
  - `Logo URL` - Now optional

---

### 3. **City_Modules Sheet**
- Updated column names: `Module Code*`, `Module Name*`, `Order*`, `Enabled Tenant Codes*`
- Reference updated to use `Tenant Code*`

---

### 4. **Departments Sheet**
- Updated column names: `Department Code*`, `Department Name*`

---

### 5. **Designations Sheet**
- Updated column names: `Designation Code*`, `Designation Name*`, `Department Code*`
- Reference updated to use `Department Code*`

---

### 6. **ComplaintTypes Sheet** ⭐ MAJOR CHANGE

**Old Structure:**
```yaml
- Complaint Name
- Service Code
- Category/Menu Path
- Department Code
- SLA Hours
- DescriptionKeywords
- Priority
```

**New Hierarchical Structure:**
```yaml
- Complaint Type* (Parent category - required for first row, empty for sub-types)
- Complaint Type Code (Parent code - required for first row, empty for sub-types)
- Complaint Sub Type* (Specific complaint - always required)
- Complaint Sub Type Code (Auto-generated - leave empty)
- Department Code* (Required for first row only)
- SLA Hours* (Required for first row only - now accepts float)
- DescriptionKeywords (comma separated)* (Required for first row only)
- Priority (Optional - now accepts float)
```

**Key Changes:**
1. **Hierarchical structure** - Parent type → Sub-types
2. **Complaint Sub Type Code** - Marked as optional, will be auto-generated
3. **SLA Hours** - Changed from string to float
4. **Priority** - Changed from string to float
5. **First row pattern** - First row of each type has all fields, subsequent rows only have sub-type fields

**Excel Pattern:**
```
Row 1: Street Lights | STREETLIGHTS | Streetlight not working | (empty) | DEPT_1 | 336 | keywords | 1
Row 2: (empty)       | (empty)      | Water Tap Broken        | (empty) | (empty) | (empty) | (empty) | (empty)
```

---

### 7. **Localization Sheet** ⭐ SIMPLIFIED

**Old Structure:**
```yaml
- Module (required)
- Code (required)
- Message (required)
- Locale (required)
```

**New Auto-Generated Structure:**
```yaml
- Code (required)
- Message (required)
```

**Module and Locale Auto-Determination:**
The module and locale are now automatically determined by the Code pattern:

| Code Pattern | Module | Locale |
|--------------|--------|--------|
| `SERVICEDFS.*` | `rainmaker-pgr` | `en_IN` |
| `COMMON_MASTERS_*` | `rainmaker-common` | `en_IN` |
| `TENANT_TENANTS_*` | `rainmaker-dss` | `en_IN` |

**Examples:**
```
SERVICEDFS.STREETLIGHTNOTWORKING → module: rainmaker-pgr, locale: en_IN
COMMON_MASTERS_DEPARTMENT_DEPT_1 → module: rainmaker-common, locale: en_IN
TENANT_TENANTS_PG → module: rainmaker-dss, locale: en_IN
```

---

### 8. **Validation Rules Updated**

All validation rules updated to use new column names with asterisks:
- `Tenant Code*`
- `Department Code*`
- `Designation Code*`

---

## 📝 Implementation Notes

### **For unified_loader.py:**

The loader needs to be updated to handle:

1. **Complaint Types Hierarchical Structure:**
   - Group rows by Complaint Type
   - First row contains parent info (type, code, department, SLA, keywords, priority)
   - Subsequent rows contain only sub-type info
   - Auto-generate Service Code from Complaint Sub Type

2. **Localization Module/Locale Logic:**
   ```python
   def determine_module_locale(code):
       if code.startswith('SERVICEDFS.'):
           return 'rainmaker-pgr', 'en_IN'
       elif code.startswith('COMMON_MASTERS_'):
           return 'rainmaker-common', 'en_IN'
       elif code.startswith('TENANT_TENANTS_'):
           return 'rainmaker-dss', 'en_IN'
       else:
           return 'rainmaker-common', 'en_IN'  # default
   ```

3. **Service Code Generation:**
   - Convert "Complaint Sub Type" to "ComplaintSubTypeCode" format
   - Remove spaces, capitalize each word
   - Example: "Streetlight not working" → "StreetlightNotWorking"

---

## ✅ Validation Checklist

Before uploading Excel:
- [ ] All required (*) columns are filled
- [ ] Tenant codes are lowercase (pg, pg.citya)
- [ ] Department/Designation codes are UPPERCASE
- [ ] ComplaintTypes first row has all parent fields
- [ ] ComplaintTypes sub-rows have empty parent fields
- [ ] Localization codes follow proper pattern
- [ ] No duplicate codes

---

## 🚨 Breaking Changes

1. **ComplaintTypes structure is completely different** - Old templates won't work
2. **Localization no longer has Module/Locale columns** - These are auto-determined
3. **SLA Hours is now float** - Use numbers like 336, not strings
4. **Several Tenant fields now required** - Must fill all City-related fields

---

## 📞 Next Steps

1. Update `unified_loader.py` to handle new structures
2. Test validation with sample data
3. Update DataLoader.ipynb documentation
4. Create user guide for ComplaintTypes hierarchical structure
