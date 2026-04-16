# Changelog
All notable changes to this module will be documented in this file.

## 3.0.0 - 2026-04-16

### Features
- Domain events integration: PGR service now publishes structured domain events on complaint create/update for downstream notification pipelines (Novu, WhatsApp, SMS)
- Enrich domain events with Twilio/WhatsApp template variables: `submittedDate`, `assigneeName`, `assigneeDesignation`
- Replace assignee UUID with workflow role in complaint domain events
- Resolve service display name from MDMS for domain event notifications
- Enrich service request with department name instead of department code

### Improvements
- Refactored domain event enrichment pipeline for cleaner separation of concerns
- Added topics for inbox integration

## 2.9.0 - 2023-08-10

- Central Instance Library Integration

## 2.8.2 - 2023-02-01

- Transition from 2.8.2-beta version to 2.8.2 version

## 2.8.2-beta - 2022-11-03

- Incorporated privacy decryption for notification flow

## 2.8.1 - 2022-08-03

- Added channel based notification

## 2.8.0 - 2022-01-13

- Updated to log4j2 version 2.17.1

## 1.1.8 - 2023-08-10

- Central Instance Library Integration

## 1.1.7 - 2023-02-01

- Transition from 1.1.7-beta version to 1.1.7 version

## 1.1.7-beta - 2022-11-03

- Incorporated privacy decryption for notification flow

## 1.1.6 - 2022-08-03

- Added channel based notification

## 1.1.4 - 2022-01-13

- Updated to log4j2 version 2.17.1

## 1.1.3 - 2021-07-23

- Fixed HRMS multi-tenant department validation

## 1.1.2 - 2021-05-11

- Fixed security issue of untrusted data pass as user input.

## 1.1.1 - 2021-02-26

- Updated domain name in application.properties.
- Fixed security issue for throwable statement.

## 1.1.0 - 2020-01-15

- PGR v2 API integration with PGR UI/UX revamp

## 1.0.0 - 2020-09-01

- Baseline version released
