{{- define "common.name" -}}
{{- $envOverrides := index .Values (tpl (default .Chart.Name .Values.name) .) -}} 
{{- $baseCommonValues := .Values.common | deepCopy -}}
{{- $values := dict "Values" (mustMergeOverwrite $baseCommonValues .Values $envOverrides) -}}
{{- with mustMergeOverwrite . $values -}}
{{- default .Chart.Name .Values.name -}}    
{{- end }}
{{- end }}

{{- define "common.labels" -}}
app: {{ template "common.name" . }}
{{- if .Values.labels.group }}      
group: {{ .Values.labels.group }}  
{{- end }}  
{{- range $key, $val := .Values.additionalLabels }}
{{ $key }}: {{ $val | quote }}
{{- end }}    
{{- end }}

{{- define "common.image" -}}
{{- if contains "/" .repository -}}      
{{- printf "%s:%s" .repository  ( required "Tag is mandatory" .tag ) -}}
{{- else -}}
{{- printf "%s/%s:%s" $.Values.global.containerRegistry .repository ( required "Tag is mandatory" .tag ) -}}
{{- end -}}
{{- end -}}

{{- /* Image pull policy: Always for a rolling tag (latest, nightly-*, develop,
       main, master), else .Values.image.pullPolicy. A node that already holds
       a rolling tag would otherwise keep running whatever it pointed at when
       first pulled. Same rule as common-services/novu-bridge. */ -}}
{{- define "common.pullPolicy" -}}
{{- if regexMatch "^(latest|nightly-.*|develop|main|master)$" (toString .Values.image.tag) -}}
Always
{{- else -}}
{{- .Values.image.pullPolicy -}}
{{- end -}}
{{- end -}}

{{- /* Validates the keys a chart renders into its own Secret (the
       secret.values escape hatch beside existingSecret), as
       charts/backbone-services/novu/templates/secret.yaml does: each required
       key must be set, and no value may still be a published placeholder. A
       forgotten override is not blank, it is the example string, and a known
       secret is a working credential for anyone who reads this repository.
       Renders nothing; fails the render on a bad value.
       `secrets` is where env-secrets.yaml holds the chart's block.
       Usage: include "common.refuseSecretPlaceholders" (dict "chart" "<name>"
         "secrets" "secrets.<block>" "values" $values "required" $requiredKeys) */ -}}
{{- define "common.refuseSecretPlaceholders" -}}
{{- $chart := .chart -}}
{{- $block := .secrets -}}
{{- $values := .values | default dict -}}
{{- range $key := .required -}}
{{- if not (index $values $key) -}}
{{- fail (printf "%s: secret key %q is required. Set %s.values.%s in environments/env-secrets.yaml, or point %s.existingSecret at a Secret created out of band." $chart $key $block $key $block) -}}
{{- end -}}
{{- end -}}
{{- range $key, $value := $values -}}
{{- if regexMatch "^<.*>$" (toString $value) -}}
{{- fail (printf "%s: secret key %q is still the placeholder %q." $chart $key (toString $value)) -}}
{{- end -}}
{{- if regexMatch "(?i)^(dev-only-)?change-me" (toString $value) -}}
{{- fail (printf "%s: secret key %q is still an example value published in this repository." $chart $key) -}}
{{- end -}}
{{- end -}}
{{- end -}}
