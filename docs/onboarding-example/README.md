# Onboarding example — walkthrough & sample sheets

Reference material for setting up DIGIT and onboarding a tenant. All the sheet
data below is **sample / randomised** — copy these and replace the values with
your own before using them.

## Walkthrough video

- **[ansible-setup-walkthrough.mp4](ansible-setup-walkthrough.mp4)** — a
  screen-recorded run through the single-machine (Ansible) setup. (Compressed for
  the repo; original was a Retina recording.)

## Example onboarding sheets

The four-file kit used to onboard a city (Maputo, in this example). The
Configurator / dataloader consumes these:

| File | What it holds |
|---|---|
| [Boundary_Template_divisao_administrativa_IGE.xlsx](Boundary_Template_divisao_administrativa_IGE.xlsx) | The administrative boundary hierarchy (province → district → …) with codes and lat/long. |
| [Common_and_Complaint_Master_IGE.xlsx](Common_and_Complaint_Master_IGE.xlsx) | Departments, designations, and the complaint-type catalogue. |
| [Complaint_Hierarchy_reclamacoes.xlsx](Complaint_Hierarchy_reclamacoes.xlsx) | The complaint category → type → subtype hierarchy with SLAs and search words. |
| [Employees.xlsx](Employees.xlsx) | Sample employees (GRO / screening / reception, etc.) to seed via HRMS. |

> These are examples to adapt, not production data. Keep real employee names and
> phone numbers out of this public repo.
