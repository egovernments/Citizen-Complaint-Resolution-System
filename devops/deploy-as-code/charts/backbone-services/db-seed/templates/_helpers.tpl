{{/*
Connection resolution.

Each value comes from db-seed's own values if set, otherwise from the shared
environment values helmfile merges in — the same keys core-services' configmaps
chart renders `egov-config` and the `db` Secret from.

Resolving here rather than via configMapKeyRef/secretKeyRef is deliberate: those
objects belong to a tier that is applied after this one.

Written with index/default chains rather than `dig`, which cannot walk
chartutil.Values ("interface conversion: interface {} is chartutil.Values, not
map[string]interface {}"). Each level defaults to an empty dict so a standalone
`helm install ./db-seed` — with no environment values merged in — still renders
and fails with the explicit message in secret.yaml rather than a nil pointer.
*/}}

{{- define "db-seed.egovConfigData" -}}
{{- $cm := (.Values.configmaps | default dict) -}}
{{- $ec := (index $cm "egov-config" | default dict) -}}
{{- index $ec "data" | default dict | toYaml -}}
{{- end -}}

{{- define "db-seed.secretsDb" -}}
{{- $s := (.Values.secrets | default dict) -}}
{{- index $s "db" | default dict | toYaml -}}
{{- end -}}

{{- define "db-seed.dbHost" -}}
{{- $own := ((.Values.db | default dict).host | default "") -}}
{{- $data := include "db-seed.egovConfigData" . | fromYaml -}}
{{- $own | default (index $data "db-host" | default "") -}}
{{- end -}}

{{- define "db-seed.dbName" -}}
{{- $own := ((.Values.db | default dict).name | default "") -}}
{{- $data := include "db-seed.egovConfigData" . | fromYaml -}}
{{- $own | default (index $data "db-name" | default "") -}}
{{- end -}}

{{- define "db-seed.dbUser" -}}
{{- $own := ((.Values.db | default dict).user | default "") -}}
{{- $db := include "db-seed.secretsDb" . | fromYaml -}}
{{- $own | default (index $db "flywayUsername" | default "") -}}
{{- end -}}

{{- define "db-seed.dbPassword" -}}
{{- $own := ((.Values.db | default dict).password | default "") -}}
{{- $db := include "db-seed.secretsDb" . | fromYaml -}}
{{- $own | default (index $db "flywayPassword" | default "") -}}
{{- end -}}
