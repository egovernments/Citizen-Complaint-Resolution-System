# Trade License (TL) Flow Testing Guide

## Prerequisites - Port Forwarding

Run these kubectl port-forward commands in separate terminals:

```bash
# MDMS Service
kubectl port-forward svc/egov-mdms-service -n egov 8081:8080

# User Service
kubectl port-forward svc/egov-user -n egov 8083:8080

# HRMS Service
kubectl port-forward svc/egov-hrms -n egov 8084:8080

# Workflow Service
kubectl port-forward svc/egov-workflow-v2 -n egov 8082:8080

# TL Service
kubectl port-forward svc/tl-services -n egov 8088:8080

# TL Calculator
kubectl port-forward svc/tl-calculator -n egov 8089:8080

# Billing Service
kubectl port-forward svc/billing-service -n egov 8090:8080
```

---

## Step 1: Get Auth Token

First, login to get an auth token:

```bash
curl -X POST 'http://localhost:8083/user/oauth/token' \
  -H 'Authorization: Basic ZWdvdi11c2VyLWNsaWVudDo=' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d 'grant_type=password&scope=read&username=9999999401&password=eGov@123&tenantId=stated.citya&userType=EMPLOYEE'
```

Save the `access_token` from the response.

---

## Step 2: Verify MDMS TL Data

### 2.1 Check TradeType Master

```bash
curl -X POST 'http://localhost:8081/egov-mdms-service/v2/_search' \
  -H 'Content-Type: application/json' \
  -d '{
    "RequestInfo": {
      "apiId": "Rainmaker",
      "ver": ".01",
      "ts": "",
      "action": "_search",
      "did": "1",
      "key": "",
      "msgId": "20170310130900|en_IN",
      "authToken": "YOUR_AUTH_TOKEN"
    },
    "MdmsCriteria": {
      "tenantId": "stated",
      "schemaCode": "TradeLicense.TradeType"
    }
  }'
```

Expected: Should return trade types like `RETAIL.ECOM.ONFA`, `RETAIL.ELEC.ELST`, etc.

### 2.2 Check StructureType Master

```bash
curl -X POST 'http://localhost:8081/egov-mdms-service/v2/_search' \
  -H 'Content-Type: application/json' \
  -d '{
    "RequestInfo": {
      "apiId": "Rainmaker",
      "ver": ".01",
      "ts": "",
      "action": "_search",
      "did": "1",
      "key": "",
      "msgId": "20170310130900|en_IN",
      "authToken": "YOUR_AUTH_TOKEN"
    },
    "MdmsCriteria": {
      "tenantId": "stated",
      "schemaCode": "common-masters.StructureType"
    }
  }'
```

Expected: Should return `MOVABLE.MOVVH`, `IMMOVABLE.IMMSH`, etc.

### 2.3 Check OwnerShipCategory Master

```bash
curl -X POST 'http://localhost:8081/egov-mdms-service/v2/_search' \
  -H 'Content-Type: application/json' \
  -d '{
    "RequestInfo": {
      "apiId": "Rainmaker",
      "ver": ".01",
      "ts": "",
      "action": "_search",
      "did": "1",
      "key": "",
      "msgId": "20170310130900|en_IN",
      "authToken": "YOUR_AUTH_TOKEN"
    },
    "MdmsCriteria": {
      "tenantId": "stated",
      "schemaCode": "common-masters.OwnerShipCategory"
    }
  }'
```

Expected: Should return `INDIVIDUAL.SINGLEOWNER`, `INSTITUTIONALPRIVATE.PRIVATECOMPANY`, etc.

---

## Step 3: Verify TL Workflow Business Service

```bash
curl -X POST 'http://localhost:8082/egov-workflow-v2/egov-wf/businessservice/_search?tenantId=stated&businessServices=TL' \
  -H 'Content-Type: application/json' \
  -d '{
    "RequestInfo": {
      "apiId": "Rainmaker",
      "ver": ".01",
      "ts": "",
      "action": "_search",
      "did": "1",
      "key": "",
      "msgId": "20170310130900|en_IN",
      "authToken": "YOUR_AUTH_TOKEN"
    }
  }'
```

Expected: Should return TL business service with states: INITIATED, APPLIED, FIELDINSPECTION, PENDINGAPPROVAL, PENDINGPAYMENT, APPROVED, REJECTED

---

## Step 4: Verify TL Employees

```bash
curl -X POST 'http://localhost:8084/egov-hrms/employees/_search?tenantId=stated.citya' \
  -H 'Content-Type: application/json' \
  -d '{
    "RequestInfo": {
      "apiId": "Rainmaker",
      "ver": ".01",
      "ts": "",
      "action": "_search",
      "did": "1",
      "key": "",
      "msgId": "20170310130900|en_IN",
      "authToken": "YOUR_AUTH_TOKEN"
    }
  }'
```

Expected employees:
| Code | Phone | Role |
|------|-------|------|
| TL_DOC_VERIFIER | 9999999401 | Document Verification |
| TL_APPROVER | 9999999403 | Final Approval |
| TL_FIELD_INSPECTOR | 9999999404 | Field Inspection |
| TL_CEMP | 9999999405 | Counter Employee |

---

## Step 5: Test TL Application Flow

### 5.1 Create TL Application (INITIATE)

Login as TL_CEMP (9999999405):

```bash
curl -X POST 'http://localhost:8088/tl-services/v1/_create' \
  -H 'Content-Type: application/json' \
  -d '{
    "RequestInfo": {
      "apiId": "Rainmaker",
      "ver": ".01",
      "ts": 1234567890,
      "action": "_create",
      "did": "1",
      "key": "",
      "msgId": "20170310130900|en_IN",
      "authToken": "YOUR_AUTH_TOKEN",
      "userInfo": {
        "id": 1,
        "userName": "TL_CEMP",
        "name": "TL Counter Employee",
        "type": "EMPLOYEE",
        "mobileNumber": "9999999405",
        "tenantId": "stated.citya",
        "roles": [
          {"code": "TL_CEMP", "name": "TL Counter Employee", "tenantId": "stated.citya"},
          {"code": "EMPLOYEE", "name": "Employee", "tenantId": "stated.citya"}
        ]
      }
    },
    "Licenses": [
      {
        "tenantId": "stated.citya",
        "licenseType": "PERMANENT",
        "applicationType": "NEW",
        "businessService": "TL",
        "action": "INITIATE",
        "tradeName": "Test Electronics Store",
        "tradeLicenseDetail": {
          "subOwnerShipCategory": "INDIVIDUAL.SINGLEOWNER",
          "structureType": "IMMOVABLE.IMMSH",
          "channel": "COUNTER",
          "owners": [
            {
              "tenantId": "stated.citya",
              "name": "Test Owner",
              "mobileNumber": "9876543210",
              "emailId": "testowner@example.com",
              "isPrimaryOwner": true,
              "ownerShipPercentage": 100.0,
              "ownerType": "NONE",
              "userActive": true,
              "relationship": "FATHER",
              "fatherOrHusbandName": "Father Name"
            }
          ],
          "address": {
            "tenantId": "stated.citya",
            "doorNo": "123",
            "addressLine1": "Main Street",
            "addressLine2": "Near Bus Stand",
            "city": "City A",
            "pincode": "143001",
            "locality": {
              "code": "SUN01"
            }
          },
          "tradeUnits": [
            {
              "tenantId": "stated.citya",
              "active": true,
              "tradeType": "RETAIL.ELEC.ELST",
              "uom": "GROSSUNITS",
              "uomValue": "100"
            }
          ]
        }
      }
    ]
  }'
```

Save the `applicationNumber` from response.

### 5.2 Apply (Submit Application)

```bash
curl -X POST 'http://localhost:8088/tl-services/v1/_update' \
  -H 'Content-Type: application/json' \
  -d '{
    "RequestInfo": { ... },
    "Licenses": [
      {
        "applicationNumber": "YOUR_APPLICATION_NUMBER",
        "action": "APPLY",
        ... (include full license object from create response)
      }
    ]
  }'
```

### 5.3 Forward to Field Inspection (TL_DOC_VERIFIER)

Login as TL_DOC_VERIFIER (9999999401):

```bash
curl -X POST 'http://localhost:8088/tl-services/v1/_update' \
  -H 'Content-Type: application/json' \
  -d '{
    "RequestInfo": { ... with TL_DOC_VERIFIER userInfo },
    "Licenses": [
      {
        "applicationNumber": "YOUR_APPLICATION_NUMBER",
        "action": "FORWARD",
        "comment": "Documents verified, forwarding for field inspection",
        ... (include full license object)
      }
    ]
  }'
```

### 5.4 Forward to Approval (TL_FIELD_INSPECTOR)

Login as TL_FIELD_INSPECTOR (9999999404):

```bash
curl -X POST 'http://localhost:8088/tl-services/v1/_update' \
  -H 'Content-Type: application/json' \
  -d '{
    "RequestInfo": { ... with TL_FIELD_INSPECTOR userInfo },
    "Licenses": [
      {
        "applicationNumber": "YOUR_APPLICATION_NUMBER",
        "action": "FORWARD",
        "comment": "Field inspection completed successfully",
        ... (include full license object)
      }
    ]
  }'
```

### 5.5 Approve (TL_APPROVER)

Login as TL_APPROVER (9999999403):

```bash
curl -X POST 'http://localhost:8088/tl-services/v1/_update' \
  -H 'Content-Type: application/json' \
  -d '{
    "RequestInfo": { ... with TL_APPROVER userInfo },
    "Licenses": [
      {
        "applicationNumber": "YOUR_APPLICATION_NUMBER",
        "action": "APPROVE",
        "comment": "Application approved",
        ... (include full license object)
      }
    ]
  }'
```

### 5.6 Make Payment

```bash
curl -X POST 'http://localhost:8090/billing-service/bill/v2/_fetchbill?tenantId=stated.citya&consumerCode=YOUR_APPLICATION_NUMBER&businessService=TL' \
  -H 'Content-Type: application/json' \
  -d '{
    "RequestInfo": { ... }
  }'
```

---

## Workflow Summary

```
CITIZEN/TL_CEMP → INITIATE → INITIATED
       ↓
CITIZEN/TL_CEMP → APPLY → APPLIED
       ↓
TL_DOC_VERIFIER → FORWARD → FIELDINSPECTION
       ↓
TL_FIELD_INSPECTOR → FORWARD → PENDINGAPPROVAL
       ↓
TL_APPROVER → APPROVE → PENDINGPAYMENT
       ↓
CITIZEN/TL_CEMP → PAY → APPROVED ✅
```

---

## MDMS Data Values Reference

| Master | Valid Codes |
|--------|-------------|
| TradeType | `RETAIL.ECOM.ONFA`, `RETAIL.ELEC.ELST`, `SERVICES.HEAL.DIAG`, `SERVICES.HEAL.PHAR`, `SERVICES.HOTL.CAFE`, `SERVICES.HOTL.SPA`, `MANUFACTURING.CONS.LITE`, `MANUFACTURING.INDU.CONS` |
| StructureType | `MOVABLE.MOVVH`, `MOVABLE.MOVTS`, `IMMOVABLE.IMMWH`, `IMMOVABLE.IMMSH` |
| OwnerShipCategory | `INDIVIDUAL.SINGLEOWNER`, `INDIVIDUAL.MULTIPLEOWNERS`, `INSTITUTIONALPRIVATE.PRIVATECOMPANY`, `INSTITUTIONALPRIVATE.NGO` |
| UOM | `GROSSUNITS` |

---

## Employee Credentials

| Employee | Phone | Password | Role |
|----------|-------|----------|------|
| TL Document Verifier | 9999999401 | eGov@123 | TL_DOC_VERIFIER |
| TL Approver | 9999999403 | eGov@123 | TL_APPROVER |
| TL Field Inspector | 9999999404 | eGov@123 | TL_FIELD_INSPECTOR |
| TL Counter Employee | 9999999405 | eGov@123 | TL_CEMP |
