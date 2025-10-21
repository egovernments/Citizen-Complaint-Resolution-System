# Localization Uploader

A Python script to upload localization messages from an Excel file to a DIGIT/UPYOG environment using the **_upsert API_**.


---

## Prerequisites

- **Python 3.8+** installed  
- **pip** for package management  
- Required dependencies:

pip install pandas requests openpyxl

*Note: `openpyxl` is required to read `.xlsx` Excel files.*

---

## Setup

1. **Download or clone** the repository containing:
 - `upload_localizations.py` – The main script  
 - `localizations_default.xlsx` – Sample Excel file with localization messages  

2. **Ensure your Python environment** has all dependencies installed (see [Prerequisites](#prerequisites)).

---

## Excel File Format

Each sheet in the Excel file must contain the following columns:

| Column Name | Description |
|--------------|-------------|
| **code**     | Unique code for the message |
| **message**  | The message text |
| **module**   | The module this message belongs to |
| **locale**   | Locale code (e.g., `en_IN`, `hi_IN`) |

**Example:**

| code | message | module | locale |
|------|----------|---------|--------|
| PT_NOTIF_WF_STATE_OPEN | Open | rainmaker-pt | en_IN |
| PT_NOTIF_WF_STATE_CLOSE | Closed | rainmaker-pt | en_IN |

---

## How to Run

python3 upload_localizations.py <excel_file> <host> <tenant_id> <auth_token> [batch_size]



---

## Arguments

| Argument | Description |
|-----------|--------------|
| `<excel_file>` | Path to the Excel file containing localization messages |
| `<host>` | Host URL of your DIGIT environment (e.g., `https://pgr-demo.digit.org`) |
| `<tenant_id>` | Tenant ID (e.g., `pg`, `ethopia`) |
| `<auth_token>` | Authentication token to access the API |
| `[batch_size]` | *(Optional)* Number of messages per batch (default: `100`) |

---

## Example Run

python3 upload_localizations.py localizations_default.xlsx https://unified-demo.digit.org pg abe81d17-a4ed-44d2-925d-dc7cacce1107 200
