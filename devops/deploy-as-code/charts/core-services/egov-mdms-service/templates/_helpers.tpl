{{- /* env.yaml's per-chart override (egov-mdms-service.upstream) arrives in the
       wholesale values; merge it here rather than rely on common.name having
       merged it by the time this file renders. */ -}}
{{- /* nginx default.conf, shared by the ConfigMap and the checksum/config
       annotation (values.yaml), so an upstream change rolls the pod: nginx does
       not reload a changed conf by itself. */ -}}
{{- define "egov-mdms-service.conf" -}}
{{- $up := merge (dict) ((index .Values .Chart.Name | default dict).upstream | default dict) (.Values.upstream | default dict) -}}
server {
  listen {{ .Values.httpPort }};
  # Re-resolve the upstream every 5 s: proxy_pass takes a variable, so nginx
  # does not pin the address it saw at startup.
  resolver {{ $up.resolver }} valid=5s ipv6=off;
  set $mdms_upstream {{ $up.host }}:{{ $up.port }};
  location /egov-mdms-service/ {
    rewrite ^/egov-mdms-service/(.*)$ /mdms-v2/$1 break;
    proxy_pass http://$mdms_upstream;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_read_timeout 60s;
    proxy_connect_timeout 10s;
  }
  location /mdms-v2/ {
    proxy_pass http://$mdms_upstream;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_read_timeout 60s;
    proxy_connect_timeout 10s;
  }
  location = /health {
    default_type text/plain;
    return 200 'OK';
  }
}
{{- end -}}
