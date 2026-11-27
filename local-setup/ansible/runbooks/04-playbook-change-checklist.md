# Playbook change checklist

Questions to answer, in writing, before a `playbook-deploy.yml` change is
proposed for review. They come from the review of #2788 (issue #2783): every
round of that review found a defect in one of these classes, and none of them
is caught by `--syntax-check`, the linters, the static tests or a mocked
render. Run `scripts/preflight.py --self-test`, `tests/pg-storage-guard-*.yml`
and `tests/static/` as well; they are necessary, not sufficient.

## 1. The second run

- What does every new or changed task do on a redeploy, with the services
  already live? A task that is correct on first creation can be destructive on
  the next run (chowning a running Postgres data directory; resetting a mode
  the service manages; re-adding an SELinux rule that now conflicts).
- Does the task report `changed` on every run? If so, either it is flapping
  with something the service does, or `changed_when` is missing.

## 2. Fresh box versus existing box

- Which checks are fatal and which only warn, and what decides between them?
  `_existing_box` is derived from THIS compose project's postgres volume; a
  check that must stay fail-closed on a fresh box cannot depend on a file the
  same run writes earlier.
- Can a value the operator has been running on (a placeholder from
  `_example.yml`, a published compose default) be refused on an existing box?
  If so, say what the operator must do first, and what breaks if they rotate
  only one side (egov-enc-service's master password cannot be rotated without
  re-encrypting).

## 3. Several stacks on one host

- Does anything match on a suffix (`*_postgres_data`), a fixed container name,
  or an unlabelled volume? Another `digit_dir` on the same host has another
  compose project prefix and must not be mistaken for ours, nor we for it.
- Is the project name derived in one place (`_compose_project`,
  `pg-storage-guard`'s `this_proj`) and the same way Compose derives it?

## 4. The tenant shapes that exist

Render or reason through each of these, not only the one you are deploying:

| shape | file | what differs |
| --- | --- | --- |
| pg-rooted | `localhost-*.yml.example` | `state_root` and `state_tenant_id` both pg |
| switched root | `_example.yml`, `bomet.yml.example` | `state_root: ke`, the bootstrap seeds it |
| maputo-style | `maputo.yml.example` | `state_root: pg` but `state_tenant_id: mz`: pg keeps the dump's rules, `core_mobile_configs` describes mz |
| empty default | group_vars | `state_tenant_id: ""`; `default(x)` does not fire on an empty string, `default(x, true)` does |

Anything keyed on "the tenant" must say which of `state_root`,
`state_tenant_id`'s root, `tenant_id` and `pg` it means, and why.

## 5. Ordering relative to the bootstrap

- Does a probe or decision run before or after `/v1/tenant/bootstrap`? A count
  of users under `state_root` taken after the call counts what the call just
  created.
- The compose copy resets `STATE_LEVEL_TENANT_ID` to pg on every run and
  "Start DIGIT stack" recreates the services on pg. Any `fail` between that
  point and the post-bootstrap re-switch leaves a live tenant on the wrong
  root; an already-switched box must reach the re-switch.

## 6. Tolerated errors

- List every `ignore_errors`, `failed_when`, `|| true`, rc allow-list and
  retry loop the change adds or touches. For each: what real failure could hide
  behind it, and what is the first visible symptom? "rc 3 means the tool is
  missing, continue" was a silent nginx 403 later.
- Retries: what is the final answer that stops them? A definitive 4xx retried
  with backoff is only a slower failure.

## 7. Moved paths and RHEL

- Defaults derive from each other (`brand_www_dir` is under `www_root`).
  Does the change hold when the parent is moved and the children follow it,
  and when a child is moved alone?
- SELinux enforcing on the RedHat family is a first-class path: labels,
  equivalences (`tasks/selinux-equivalence.yml`), booleans. Changing a path
  without its label is a 403 or EACCES only there.

## 8. The examples still pass

- `scripts/preflight.py` on every `host_vars/*.example` and `_example.yml`
  trips only the known fast-path findings.
- `docker compose config` on `docker-compose.egov-digit.yaml` and
  `docker-compose.deploy.yaml` renders with the `.env` the playbook writes
  (`${VAR:?}` aborts before profiles are applied; a profile-gated service
  cannot require a variable).

## 9. What was not run

State it. A change in this playbook that has not been run on a throwaway box
(one Rocky 9 with SELinux enforcing, one Ubuntu; first run, then a second run
on the same box) is untested, whatever else passed. Put that sentence in the
PR, and list which of the questions above were answered by reading only.
