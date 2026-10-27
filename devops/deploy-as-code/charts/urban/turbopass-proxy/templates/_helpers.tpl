{{- /* nginx default.conf, shared by the ConfigMap and the checksum/config pod
       annotation. env.yaml's per-chart override (turbopass-proxy.upstream)
       arrives in the wholesale values; merge it explicitly. */ -}}
{{- define "turbopass-proxy.conf" -}}
{{- $up := merge (dict) ((index .Values .Chart.Name | default dict).upstream | default dict) (.Values.upstream | default dict) -}}
{{- $host := required "turbopass-proxy.upstream.host is required" $up.host -}}
server {
  listen {{ .Values.httpPort }};
  resolver {{ $up.resolver }} valid=5s ipv6=off;
  set $turbopass_host {{ $host }};

  location /turbopass {
    # This site's session and credentials stay here: the upstream is another
    # deployment.
    proxy_set_header Cookie "";
    proxy_set_header Authorization "";
    proxy_set_header Host $turbopass_host;
    proxy_ssl_server_name on;
    proxy_ssl_name $turbopass_host;
    rewrite ^/turbopass(.*)$ {{ $up.path }}$1 break;
    proxy_pass https://$turbopass_host;
    proxy_read_timeout 60s;
    proxy_connect_timeout 10s;
    # Nor may the upstream set a cookie on this site.
    proxy_hide_header Set-Cookie;
  }

  location = /health {
    default_type text/plain;
    return 200 'OK';
  }
}
{{- end -}}
