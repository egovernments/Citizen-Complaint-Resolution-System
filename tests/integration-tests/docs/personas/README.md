# Persona flow catalogues

Source-of-truth maps from **user journey** to **spec coverage**, one per
persona. Used to plan new tests, review coverage gaps, and keep the spec
tree (`tests/<persona>/`) in step with the live UI.

| Persona | Catalogue | Spec dir |
|---|---|---|
| Citizen | [citizen-flows.md](./citizen-flows.md) | `tests/citizen/` |
| Employee | _TODO_ | `tests/employee/` |
| Admin (configurator) | _TODO_ | `tests/admin/` |

When a flow changes (new wizard step, route rename, removed screen),
update the corresponding catalogue in the same PR as the spec change so
the map stays accurate.
