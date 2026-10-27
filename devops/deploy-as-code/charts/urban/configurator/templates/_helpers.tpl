{{- /* config.js, shared by the ConfigMap and the Deployment's checksum/config
       annotation (values.yaml additionalAnnotations), so a runtimeConfig change
       rolls the pods: config.js is a subPath mount, which never sees a ConfigMap
       update on its own. */ -}}
{{- define "configurator.runtimeConfigJs" -}}
{{- $cfg := merge (dict) ((index .Values .Chart.Name | default dict).runtimeConfig | default dict) (.Values.runtimeConfig | default dict) -}}
// Rendered by the configurator Helm chart from `runtimeConfig`
// (charts/urban/configurator/values.yaml). Edit the environment's values,
// not this file. Precedence in the app: this file > build-time VITE_* >
// in-code default; a blank value falls through.
window.__CONFIGURATOR_CONFIG__ = {
{{- range $key := list "STATE_TENANT_ID" "OVERPASS_URL" "TURBOPASS_URL" "BOUNDARY_SEARCH_LIMIT" "SENTRY_DSN" "POSTHOG_KEY" "POSTHOG_HOST" }}
  {{ $key }}: {{ index $cfg $key | default "" | toString | toJson }},
{{- end }}
};
{{- end -}}
