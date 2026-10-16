{{- define "identity-bff.secretName" -}}
{{- .Values.secret.existingSecret | default (printf "%s-secrets" .Release.Name) -}}
{{- end -}}

{{- /* Secret key -> environment variable. Required keys are plain
       secretKeyRefs: a missing one stops the pod (CreateContainerConfigError)
       instead of starting a BFF that fails every sign-in. */ -}}
{{- define "identity-bff.requiredSecrets" -}}
keycloak-bff-client-secret: KEYCLOAK_BFF_CLIENT_SECRET
keycloak-admin-client-secret: KEYCLOAK_ADMIN_CLIENT_SECRET
keycloak-employee-client-secret: KEYCLOAK_EMPLOYEE_CLIENT_SECRET
keycloak-citizen-client-secret: KEYCLOAK_CITIZEN_CLIENT_SECRET
digit-admin-password: DIGIT_ADMIN_PASSWORD
{{- end -}}
{{- define "identity-bff.optionalSecrets" -}}
keycloak-magic-link-client-secret: KEYCLOAK_MAGIC_LINK_CLIENT_SECRET
identity-control-plane-token: IDENTITY_CONTROL_PLANE_TOKEN
identity-session-introspection-token: IDENTITY_SESSION_INTROSPECTION_TOKEN
identity-onboarding-token: IDENTITY_ONBOARDING_TOKEN
pgr-onboarding-worker-token: PGR_ONBOARDING_WORKER_TOKEN
identity-citizen-otp-secret: IDENTITY_CITIZEN_OTP_SECRET
identity-credential-keys: IDENTITY_CREDENTIAL_KEYS
identity-credential-key-current: IDENTITY_CREDENTIAL_KEY_CURRENT
digit-provisioner-password: DIGIT_PROVISIONER_PASSWORD
identity-surfaces-json: IDENTITY_SURFACES_JSON
{{- end -}}

{{- /* The container environment: derived Keycloak/redirect settings, the
       non-empty `config` entries, then the Secret references. */ -}}
{{- define "identity-bff.env" -}}
{{- $config := .Values.config | default dict -}}
{{- range $key := list "KEYCLOAK_ISSUER" "KEYCLOAK_OIDC_BACKCHANNEL_URL" "KEYCLOAK_JWKS_URI" "KEYCLOAK_ADMIN_URL" "KEYCLOAK_ADMIN_REALM" "KEYCLOAK_ORGANIZATION_REALM" "IDENTITY_REDIRECT_URI" "IDENTITY_POST_LOGIN_REDIRECT" "IDENTITY_ALLOWED_ORIGINS" "IDENTITY_ALLOWED_ORIGIN" -}}
{{- if index $config $key -}}
{{- fail (printf "identity-bff: config.%s is derived from identity.* (the keycloak chart's realm-configure Job writes the same values onto Keycloak's clients); set those instead" $key) -}}
{{- end -}}
{{- end -}}
{{- $public := include "common.identity.publicUrl" . -}}
{{- $realm := required "identity.realm must be set" .Values.identity.realm -}}
{{- $kc := include "common.identity.keycloakUrl" . -}}
{{- $derived := dict
      "KEYCLOAK_ORGANIZATION_REALM" $realm
      "KEYCLOAK_ISSUER" (printf "%s/auth/realms/%s" $public $realm)
      "KEYCLOAK_OIDC_BACKCHANNEL_URL" (printf "%s/realms/%s" $kc $realm)
      "KEYCLOAK_JWKS_URI" (printf "%s/realms/%s/protocol/openid-connect/certs" $kc $realm)
      "KEYCLOAK_ADMIN_URL" $kc
      "KEYCLOAK_ADMIN_REALM" $realm
      "IDENTITY_REDIRECT_URI" (printf "%s/identity/v1/callback" $public)
      "IDENTITY_POST_LOGIN_REDIRECT" (.Values.identity.postLoginRedirect | default (printf "%s/configurator/login" $public))
      "IDENTITY_ALLOWED_ORIGINS" (.Values.identity.allowedOrigins | default $public)
      "IDENTITY_COOKIE_SECURE" (ternary "true" "false" (hasPrefix "https://" $public))
-}}
{{- $env := merge (dict) (omit $config "DIGIT_ADMIN_TENANT_ID") -}}
{{- range $key, $value := $derived -}}
{{- if not (index $env $key) -}}{{- $_ := set $env $key $value -}}{{- end -}}
{{- end -}}
{{- range $key := keys $env | sortAlpha -}}
{{- $value := index $env $key | toString -}}
{{- if $value }}
- name: {{ $key }}
  value: {{ $value | quote }}
{{- end -}}
{{- end }}
- name: DIGIT_ADMIN_TENANT_ID
{{- if index $config "DIGIT_ADMIN_TENANT_ID" }}
  value: {{ index $config "DIGIT_ADMIN_TENANT_ID" | toString | quote }}
{{- else }}
  valueFrom:
    configMapKeyRef:
      name: egov-config
      key: state-level-tenant-id
{{- end }}
{{- $secret := include "identity-bff.secretName" . -}}
{{- range $key, $name := include "identity-bff.requiredSecrets" . | fromYaml }}
- name: {{ $name }}
  valueFrom:
    secretKeyRef:
      name: {{ $secret }}
      key: {{ $key }}
{{- end }}
{{- range $key, $name := include "identity-bff.optionalSecrets" . | fromYaml }}
- name: {{ $name }}
  valueFrom:
    secretKeyRef:
      name: {{ $secret }}
      key: {{ $key }}
      optional: true
{{- end }}
{{- end -}}
