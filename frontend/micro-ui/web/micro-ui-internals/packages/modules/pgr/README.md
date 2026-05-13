# egovernments/digit-ui-module-cms

## Install

```bash
npm install --save egovernments/digit-ui-module-cms
```

## Limitation

```bash
This Package is more specific to DIGIT-UI's can be used across mission's
```

## Usage

After adding the dependency make sure you have this dependency in

```bash
frontend/micro-ui/web/package.json
```

```json
"@egovernments/digit-ui-module-cms" :"0.0.1",
```

then navigate to App.js

```bash
 frontend/micro-ui/web/src/App.js
```

```jsx
/** add this import **/

import { initPGRComponents } from "egovernments/digit-ui-module-cms"

/** inside enabledModules add this new module key **/

const enabledModules = ["PGR"];

/** inside init Function call this function **/

const initDigitUI = () => {
  initPGRComponents();
};

```

## List of features available in this package were as follows

1. Create Complaint
2. Search Complaint Inbox.
3. View/Update Complaint.

## Configuration

### Feature Flags

This module reads runtime flags from the deployment's `globalConfigs.js` via `window.globalConfigs.getConfig("KEY")`. Flags are environment-controlled — set them in the `globalConfigs.js` shipped by the host environment (e.g. `local-setup/nginx/globalConfigs.js` for local, the equivalent asset in `configs/assets/` for deployed environments).

| Key | Default behavior | Effect when set to `true` |
|-----|------------------|---------------------------|
| `USE_INBOX_V1` | **V2 inbox** (`PGRSearchInboxV2`, InboxSearchComposer-based) renders when the flag is `false`, missing, or `globalConfigs.js` is absent | Renders the legacy `PGRInboxV1` on the Employee PGR inbox route |

**How it's wired**
- Declaration: add `var useInboxV1 = true;` inside the `globalConfigs` IIFE and a matching `} else if (key === "USE_INBOX_V1") { return useInboxV1; }` branch in `getConfig`.
- Consumer: [`src/pages/employee/PGRInbox.js`](src/pages/employee/PGRInbox.js) — reads the flag at render time and mounts either `PGRInboxV1` or `PGRSearchInboxV2`.
- Only add the entry when you explicitly want V1. Removing the entry (or shipping a `globalConfigs.js` without it) falls back to V2.


### Contributors

- [Hariprasad](https://github.com/hari-egov)

## License

[MIT](https://choosealicense.com/licenses/mit/)

## Documentation

Documentation Site (https://core.digit.org/guides/developer-guide/ui-developer-guide/digit-ui)


## Maintainer

- [Hariprasad](https://github.com/hari-egov)


### Published from DIGIT Frontend 
DIGIT Frontend Repo (https://github.com/egovernments/Citizen-Complaint-Resolution-System)


![Logo](https://s3.ap-south-1.amazonaws.com/works-dev-asset/mseva-white-logo.png)

