{{- define "novu.namespace" -}}
{{- default .Release.Namespace .Values.namespace -}}
{{- end }}

{{- /* Name of the Secret holding the signing/encryption keys: an
       out-of-band one when novu.secrets.existingSecret is set, otherwise the
       one templates/secret.yaml creates. Defined once so the Secret and every
       secretKeyRef that reads it cannot drift apart. */ -}}
{{- define "novu.secretName" -}}
{{- default (printf "%s-secrets" .Release.Name) .Values.novu.secrets.existingSecret -}}
{{- end -}}

{{- /* spec.replicas for a Deployment with an optional HPA. Call with
       (dict "component" .Values.<api|worker|ws|dashboard>).
       Without an HPA: the configured count. Under the HPA: left out, so the
       count is the HPA's and no upgrade resets it. A fixed value here reset it
       on every upgrade.
       One-time cost: on a release that rendered `replicas` before, Helm's
       three-way merge clears the field on the first upgrade without it, so
       Kubernetes sets the Deployment to 1 and the HPA scales it back up on its
       next sync (~15s plus pod start-up). Not `lookup` of the live count:
       helm-diff renders client-side, where lookup returns nothing, so every
       `helmfile diff` would show a reset and every apply a new revision. */ -}}
{{- define "novu.replicas" -}}
{{- if not .component.autoscaling.enabled -}}
replicas: {{ .component.replicas }}
{{- end -}}
{{- end -}}
