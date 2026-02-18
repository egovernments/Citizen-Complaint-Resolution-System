# Changelog
All notable changes to this module will be documented in this file.

## [1.0.1] - 2026-02-18
### Fixed
- CCSD-1616: Citizen header logo override — rewrote script with persistent dual-observer approach to survive React re-renders; added citizen-route guard so override only applies on `/citizen` pages

## [1.0.0] - 2026-02-09
### Added
- feat: Introduce new Public Grievance Redressal (PGR) module and update example application dependencies ([db546ef](https://github.com/egovernments/Citizen-Complaint-Resolution-System/commit/db546ef))
- ci: Add GitHub Actions workflow to automate NPM package publishing for the `pgr` module ([8fad163](https://github.com/egovernments/Citizen-Complaint-Resolution-System/commit/8fad163))
- Add automated publishing workflow and configuration for CMS package ([0506efe](https://github.com/egovernments/Citizen-Complaint-Resolution-System/commit/0506efe))
- semantic-release dependency version reduced to `^18.0.0` ([9d6f4a7](https://github.com/egovernments/Citizen-Complaint-Resolution-System/commit/9d6f4a7))
- node version 14 fix ([b4c692d](https://github.com/egovernments/Citizen-Complaint-Resolution-System/commit/b4c692d))
- readme updated ([b2705c9](https://github.com/egovernments/Citizen-Complaint-Resolution-System/commit/b2705c9))

## [0.0.1] - 2026-02-06
### Added
- PGR to CMS Name Change and Publish ([5ed8d2d](https://github.com/egovernments/Citizen-Complaint-Resolution-System/commit/5ed8d2d))
- feat(dataloader): Add load_hierarchy() for Phase 2a boundary template ([560cb76](https://github.com/egovernments/Citizen-Complaint-Resolution-System/commit/560cb76))
- Initial commit with pgr module
