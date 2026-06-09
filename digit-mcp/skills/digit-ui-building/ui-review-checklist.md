# UI Review Checklist

Review EVERY item against screenshots before shipping. Mark each as pass/fail.

## Data Display
- [ ] Human-readable labels (not raw codes like `StreetLightNotWorking`)
- [ ] Proper date formatting (not epoch timestamps)
- [ ] SLA shown only on active complaints (not resolved/closed)
- [ ] Status shown as colored badge with plain English text
- [ ] Locality shown as human name (not boundary code)

## Wizard / Multi-Step Forms
- [ ] Progress indicator showing current step
- [ ] Back navigation works on every step
- [ ] Step labels are descriptive
- [ ] Review step pre-fills all entered data
- [ ] Submit button disabled during API call

## Employee Inbox
- [ ] Column alignment consistent
- [ ] Search filters work (by status, complaint type, date)
- [ ] Filter counts match displayed results
- [ ] Empty state message when no results
- [ ] Pagination or infinite scroll for large lists

## Complaint Detail
- [ ] Timeline shows all workflow transitions
- [ ] Citizen info visible (name, mobile, address)
- [ ] Action buttons are role-aware (GRO sees Assign/Reject, LME sees Resolve/Reassign)
- [ ] Comment history displayed with author and timestamp
- [ ] Attachments (if any) downloadable

## Navigation
- [ ] Active tab/page highlighted in nav
- [ ] Breadcrumbs on detail pages
- [ ] Consistent TopBar across all pages
- [ ] Back button behavior predictable
- [ ] Logout accessible from every page

## Mobile (375px viewport)
- [ ] Bottom nav has all navigation items
- [ ] Cards don't overflow horizontally
- [ ] Touch targets >= 44px
- [ ] Text readable without zooming
- [ ] Forms usable with mobile keyboard

## General Polish
- [ ] No raw JSON anywhere in the UI
- [ ] Loading spinners on every data-fetching view
- [ ] Error states with retry option on every data-fetching view
- [ ] Consistent spacing and alignment
- [ ] No console errors in browser dev tools

## API Contract
- [ ] No hand-written fetch calls (all through SDK)
- [ ] Required parameters present on every API call
- [ ] Request body shapes match OpenAPI spec
- [ ] Error responses handled gracefully (400, 401, 500)
- [ ] Auth token refreshed/redirected on 401
