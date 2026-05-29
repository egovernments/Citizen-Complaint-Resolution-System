# Citizen Complaints — design (T1 + map widget)

**Date:** 2026-05-17
**Repo:** `/root/code/digit-citizen-ui/`
**Deploy target:** `/var/www/citizen/` on naipepea

## Goal

Add the citizen complaint **list + detail + create** flows to the citizen UI fork. Same data contracts as `digit-ui-esbuild`'s citizen PGR module (same APIs, same field shape), rebuilt on our stack (Vite + Tailwind + Radix + react-admin's `ra-core` resource framework). Multi-step create wizard with a custom Stepper. Real Leaflet map widget for picking and viewing the complaint location.

## Scope (T1 + map)

- `/citizen/complaints` — "My Complaints" list (react-admin `<Resource list>`)
- `/citizen/complaints/:id/show` — complaint detail with status, fields, photos, location map, workflow timeline
- `/citizen/complaints/create` — 4-step wizard:
  1. Complaint type (parent serviceCode)
  2. Sub-type + description + landmark
  3. Location (Leaflet map, draggable marker, "use my GPS", reverse-geocode) + photos
  4. Review + submit
- After successful submit → redirect to `/complaints/:newServiceRequestId/show`
- Sidebar grows from one item ("Citizen Dashboard") to two ("My Complaints" added)

**Out of scope for T1:** reopen flow, rating flow, filtering, pagination, draft persistence. Carved out as T2 later.

## Stack additions

| Dep | Why |
|---|---|
| `ra-core` (restore) | Resource framework — `<Resource>`, `<List>`, `<Show>`, `<Create>` slots. Same package the configurator uses. |
| `leaflet` + `react-leaflet` + `@types/leaflet` | Map widget for location pick/view. OSM tiles, no API key. |
| `react-hook-form` (already a transitive dep) | Cross-step form state for the wizard. |

## API contracts (verified live on naipepea)

```
POST /pgr-services/v2/request/_search?tenantId=ke.nairobi&mobileNumber=<m>
  body: { RequestInfo: { authToken } }
  → { ServiceWrappers: [{ service: {...}, workflow: {...} }] }

POST /pgr-services/v2/request/_search?tenantId=ke.nairobi&serviceRequestId=<id>
  → single-item ServiceWrappers[]

POST /pgr-services/v2/request/_create?tenantId=ke.nairobi
  body: {
    RequestInfo: { authToken },
    service: {
      tenantId: "ke.nairobi",
      serviceCode: "<parent or leaf code>",
      description: "<text>",
      source: "WEB",
      address: { city, locality, landmark, geoLocation: { latitude, longitude } },
      accountId: "<citizen uuid>",
    },
    workflow: { action: "APPLY" },
  }
  → { ServiceWrappers: [{ service: { serviceRequestId, ... } }] }

POST /filestore/v1/files (multipart) → { files: [{ fileStoreId }] }
GET  /filestore/v1/files/url?tenantId=...&fileStoreIds=...,...  → { fileStoreIds: [...], fileStoreUrls: { id: url } }

POST /egov-mdms-service/v1/_search
  body: filter for RAINMAKER-PGR.ServiceDefs at root ke
  → list of complaint types with parent/child structure
```

## Data shape (citizen-side model)

```ts
type Complaint = {
  id: string;                  // serviceRequestId (acts as react-admin id)
  serviceRequestId: string;
  serviceCode: string;
  serviceName: string;         // resolved via MDMS, falls back to serviceCode
  description: string;
  applicationStatus: string;   // OPEN, PENDINGFORASSIGNMENT, ..., RESOLVED, REJECTED, CLOSED_*
  createdTime: number;
  lastModifiedTime: number;
  address: { city; locality; landmark; geoLocation: { latitude; longitude } };
  photos: string[];            // fileStoreIds from service.additionalDetail.images
  workflow: { processInstances: [{ state; action; assignee; auditDetails; comments; documents }] };
};
```

DataProvider flattens `ServiceWrappers[]` → `Complaint[]` so react-admin's `<List>` and `<Show>` work directly.

## Components

```
src/
├── providers/
│   └── citizenBridge.ts          new — dataProvider + authProvider
├── components/
│   ├── digit/
│   │   ├── ComplaintMap.tsx      new — react-leaflet, pick + view modes
│   │   └── Stepper.tsx           new — horizontal stepper primitive
│   └── ui/                       existing primitives
├── pages/
│   ├── CitizenComplaintsListPage.tsx    new — react-admin <List>
│   ├── CitizenComplaintShowPage.tsx     new — react-admin <Show>
│   ├── CitizenComplaintCreatePage.tsx   new — multi-step wizard
│   └── CitizenDashboardPage.tsx         existing — re-export PgrDashboard
├── hooks/
│   ├── useServiceDefs.ts          new — fetch RAINMAKER-PGR.ServiceDefs via MDMS
│   └── usePgrDashboardData.ts     existing
└── App.tsx                        update — wire <CoreAdminContext> + <Resource> for complaints
```

## DataProvider mapping

| react-admin call | PGR API |
|---|---|
| `getList('complaints', ...)` | POST `_search?mobileNumber=<citizen.mobile>` → flatten `ServiceWrappers` |
| `getOne('complaints', { id })` | POST `_search?serviceRequestId=<id>` → first ServiceWrapper |
| `create('complaints', { data })` | POST `_create` with the assembled `service` object |
| `update / delete / getMany / getManyReference` | throw "not supported" |

## Stepper component contract

```tsx
<Stepper
  steps={['Type', 'Details', 'Location & photos', 'Review']}
  current={step}
  onNext={() => trigger(fieldsForCurrentStep).then(ok => ok && setStep(s => s + 1))}
  onBack={() => setStep(s => s - 1)}
>
  {step === 0 && <TypeStep />}
  {step === 1 && <DetailsStep />}
  ...
</Stepper>
```

Single `useForm()` at the wizard root; steps use `useFormContext()` to read/write. Per-step validation via `trigger([...fieldNames])`.

## ComplaintMap contract

```tsx
<ComplaintMap
  mode="pick" | "view"
  lat={number | null}
  lng={number | null}
  onChange?={(lat, lng) => void}     // only used in pick mode
/>
```

- Tiles: OpenStreetMap (`https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png`)
- Default center: Nairobi `(-1.2864, 36.8172)`, zoom 12
- "Use my GPS" button calls `navigator.geolocation.getCurrentPosition()`, recenters map, places marker
- On marker drag/drop: emit `onChange(lat, lng)`, also fetch Nominatim reverse-geocode to suggest locality (debounced to respect 1 req/s rate limit)
- View mode: no controls, marker locked, zoom 16

## Testing

Extend existing playwright spec (`tests/citizen-login.spec.ts`):

```
✓ login + real PGR dashboard render end-to-end       (existing)
✓ unauthenticated /dashboard redirects to /login    (existing)
+ My Complaints empty state                          new — fresh citizen, list shows empty card + CTA
+ Raise complaint end-to-end                         new — step through 4 steps, assert redirect to detail page
+ Detail page renders map + status + serviceRequestId new — visit /complaints/:id/show post-create
```

## Trade-offs / known limitations

- **Nominatim rate limit**: 1 req/s. We debounce reverse-geocode and only fire on `marker dragend`, not on map pan. Production-scale should switch to a self-hosted geocoder.
- **No offline draft persistence**: closing the tab mid-wizard loses form state. T3 if needed.
- **No photo previews in step 3 yet**: filename chips with remove only. Adding `<img>` thumbnails is a follow-up.
- **No pagination on list**: default 50 latest. Citizens typically have <10 complaints; pagination is T3.
- **Reverse-geocode failure is non-blocking**: locality stays user-typed if Nominatim doesn't answer.

## Build cost projection

| | Current | T1 + map |
|---|---|---|
| JS gz | 323 KB | ~395 KB (+ leaflet 42 + ra-core 18 + react-leaflet 12) |
| CSS gz | 6 KB | ~17 KB (+ leaflet CSS) |
