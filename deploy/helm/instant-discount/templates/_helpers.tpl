{{- define "id.fullname" -}}
{{- printf "%s" .Release.Name | trunc 50 | trimSuffix "-" -}}
{{- end -}}

{{- define "id.labels" -}}
app.kubernetes.io/name: instant-discount
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
{{- end -}}

{{- define "id.selector" -}}
app.kubernetes.io/name: instant-discount
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{/* Image reference; a digest, when set, wins over the tag. */}}
{{- define "id.image" -}}
{{- $img := .image -}}
{{- if $img.digest -}}
{{ printf "%s/%s@%s" .root.Values.image.registry $img.repository $img.digest }}
{{- else -}}
{{ printf "%s/%s:%s" .root.Values.image.registry $img.repository $img.tag }}
{{- end -}}
{{- end -}}

{{- define "id.apiEnv" -}}
envFrom:
  - configMapRef:
      name: {{ include "id.fullname" . }}-config
  - secretRef:
      name: {{ .Values.existingSecret }}
{{- end -}}

{{- define "id.preStop" -}}
lifecycle:
  preStop:
    exec:
      command: ["sleep", "{{ .Values.preStopSleepSeconds }}"]
{{- end -}}
