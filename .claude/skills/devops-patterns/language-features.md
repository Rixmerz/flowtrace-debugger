# Platform Features & Emerging Tech

## Prometheus Alerting Rules

```yaml
# prometheus-rules.yaml
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: application-alerts
  namespace: monitoring
spec:
  groups:
    - name: pod-health
      rules:
        - alert: PodCrashLooping
          expr: rate(kube_pod_container_status_restarts_total[15m]) * 60 * 5 > 0
          for: 5m
          labels:
            severity: warning
          annotations:
            summary: "Pod {{ $labels.namespace }}/{{ $labels.pod }} is crash looping"
            runbook: "https://runbooks.example.com/pod-crash-looping"

        - alert: PodNotReady
          expr: kube_pod_status_ready{condition="true"} == 0
          for: 10m
          labels:
            severity: warning
          annotations:
            summary: "Pod {{ $labels.namespace }}/{{ $labels.pod }} not ready for 10m"

    - name: resource-usage
      rules:
        - alert: HighMemoryUsage
          expr: |
            container_memory_working_set_bytes{container!=""}
            / container_spec_memory_limit_bytes{container!=""}
            > 0.9
          for: 5m
          labels:
            severity: warning
          annotations:
            summary: "Container {{ $labels.container }} in {{ $labels.namespace }}/{{ $labels.pod }} using >90% memory"

        - alert: HighCPUThrottling
          expr: |
            rate(container_cpu_cfs_throttled_periods_total[5m])
            / rate(container_cpu_cfs_periods_total[5m])
            > 0.25
          for: 10m
          labels:
            severity: warning
          annotations:
            summary: "Container {{ $labels.container }} throttled >25% of the time"

    - name: slo-burn-rate
      rules:
        - alert: ErrorBudgetFastBurn
          expr: |
            (
              1 - sum(rate(http_requests_total{status=~"2.."}[1h]))
              / sum(rate(http_requests_total[1h]))
            ) > 14 * 0.001
          for: 2m
          labels:
            severity: critical
          annotations:
            summary: "Error budget burning at 14x rate (SLO: 99.9%)"

        - alert: ErrorBudgetSlowBurn
          expr: |
            (
              1 - sum(rate(http_requests_total{status=~"2.."}[6h]))
              / sum(rate(http_requests_total[6h]))
            ) > 3 * 0.001
          for: 30m
          labels:
            severity: warning
          annotations:
            summary: "Error budget burning at 3x rate (SLO: 99.9%)"
```

## PromQL Production Queries

```promql
# P99 latency per service (histogram)
histogram_quantile(0.99,
  sum(rate(http_request_duration_seconds_bucket[5m])) by (le, service)
)

# Error rate per service
sum by (service) (rate(http_requests_total{status=~"5.."}[5m]))
/
sum by (service) (rate(http_requests_total[5m]))

# CPU usage by namespace (percentage of requests)
sum by (namespace) (rate(container_cpu_usage_seconds_total[5m]))
/
sum by (namespace) (kube_pod_container_resource_requests{resource="cpu"})

# Top 10 memory-consuming pods
topk(10,
  sum by (namespace, pod) (container_memory_working_set_bytes{container!=""})
)

# Pods without resource requests
count by (namespace) (
  kube_pod_container_resource_requests{resource="cpu"} == 0
)

# Request rate trend (compare to 1 week ago)
sum(rate(http_requests_total[5m]))
/
sum(rate(http_requests_total[5m] offset 1w))

# Disk IOPS by PVC
sum by (persistentvolumeclaim) (
  rate(kubelet_volume_stats_inodes_used[5m])
)
```

## OpenTelemetry Collector Configuration

```yaml
# otel-collector-config.yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318
  prometheus:
    config:
      scrape_configs:
        - job_name: 'kubernetes-pods'
          kubernetes_sd_configs:
            - role: pod
          relabel_configs:
            - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_scrape]
              action: keep
              regex: true

processors:
  memory_limiter:
    check_interval: 5s
    limit_mib: 512
    spike_limit_mib: 128

  batch:
    send_batch_size: 1024
    timeout: 5s

  attributes:
    actions:
      - key: environment
        value: production
        action: upsert

  filter:
    # Drop health check spans (noisy)
    traces:
      span:
        - 'attributes["http.target"] == "/health"'
        - 'attributes["http.target"] == "/metrics"'

  transform:
    # Redact sensitive data
    trace_statements:
      - context: span
        statements:
          - replace_pattern(attributes["http.url"], "token=[^&]*", "token=REDACTED")
          - replace_pattern(attributes["db.statement"], "'[^']*'", "'***'")

exporters:
  otlp/mimir:
    endpoint: mimir.monitoring:4317
    tls:
      insecure: false

  otlp/tempo:
    endpoint: tempo.monitoring:4317

  loki:
    endpoint: http://loki.monitoring:3100/loki/api/v1/push

service:
  pipelines:
    metrics:
      receivers: [otlp, prometheus]
      processors: [memory_limiter, batch, attributes]
      exporters: [otlp/mimir]
    traces:
      receivers: [otlp]
      processors: [memory_limiter, filter, transform, batch]
      exporters: [otlp/tempo]
    logs:
      receivers: [otlp]
      processors: [memory_limiter, batch, attributes]
      exporters: [loki]
```

## OPA/Gatekeeper Constraint Templates

### No latest tag policy
```yaml
apiVersion: templates.gatekeeper.sh/v1
kind: ConstraintTemplate
metadata:
  name: k8sdisallowedtags
spec:
  crd:
    spec:
      names:
        kind: K8sDisallowedTags
      validation:
        openAPIV3Schema:
          type: object
          properties:
            tags:
              type: array
              items:
                type: string
  targets:
    - target: admission.k8s.gatekeeper.sh
      rego: |
        package k8sdisallowedtags

        violation[{"msg": msg}] {
          container := input.review.object.spec.containers[_]
          tag := [contains(container.image, ":")]
          not all(tag)
          msg := sprintf("Container '%v' uses image without tag", [container.name])
        }

        violation[{"msg": msg}] {
          container := input.review.object.spec.containers[_]
          tag := split(container.image, ":")[1]
          tag == input.parameters.tags[_]
          msg := sprintf("Container '%v' uses disallowed tag '%v'", [container.name, tag])
        }
---
apiVersion: constraints.gatekeeper.sh/v1beta1
kind: K8sDisallowedTags
metadata:
  name: no-latest-tag
spec:
  match:
    kinds:
      - apiGroups: [""]
        kinds: ["Pod"]
      - apiGroups: ["apps"]
        kinds: ["Deployment", "StatefulSet", "DaemonSet"]
    namespaces: ["production", "staging"]
  parameters:
    tags: ["latest"]
```

### Require resource limits
```yaml
apiVersion: templates.gatekeeper.sh/v1
kind: ConstraintTemplate
metadata:
  name: k8srequiredresources
spec:
  crd:
    spec:
      names:
        kind: K8sRequiredResources
  targets:
    - target: admission.k8s.gatekeeper.sh
      rego: |
        package k8srequiredresources

        violation[{"msg": msg}] {
          container := input.review.object.spec.containers[_]
          not container.resources.requests.memory
          msg := sprintf("Container '%v' must specify memory request", [container.name])
        }

        violation[{"msg": msg}] {
          container := input.review.object.spec.containers[_]
          not container.resources.limits.memory
          msg := sprintf("Container '%v' must specify memory limit", [container.name])
        }
```

## External Secrets Operator (AWS)

```yaml
# ClusterSecretStore (cluster-wide, uses IRSA)
apiVersion: external-secrets.io/v1beta1
kind: ClusterSecretStore
metadata:
  name: aws-secrets-store
spec:
  provider:
    aws:
      service: SecretsManager
      region: us-east-1
      auth:
        jwt:
          serviceAccountRef:
            name: external-secrets-sa
            namespace: external-secrets
---
# ExternalSecret (per-namespace)
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: app-secrets
  namespace: production
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: aws-secrets-store
    kind: ClusterSecretStore
  target:
    name: app-secrets
    creationPolicy: Owner
    template:
      type: Opaque
      data:
        DATABASE_URL: "postgres://{{ .db_user }}:{{ .db_password }}@{{ .db_host }}:5432/{{ .db_name }}"
  data:
    - secretKey: db_user
      remoteRef:
        key: production/database
        property: username
    - secretKey: db_password
      remoteRef:
        key: production/database
        property: password
    - secretKey: db_host
      remoteRef:
        key: production/database
        property: host
    - secretKey: db_name
      remoteRef:
        key: production/database
        property: dbname
```

## Ansible Playbook Patterns

### Server hardening playbook
```yaml
---
- name: Harden Linux servers
  hosts: all
  become: true
  vars:
    ssh_port: 22
    allowed_users:
      - deploy
      - admin

  tasks:
    - name: Update all packages
      ansible.builtin.package:
        name: "*"
        state: latest
      tags: [packages]

    - name: Disable root login via SSH
      ansible.builtin.lineinfile:
        path: /etc/ssh/sshd_config
        regexp: "^PermitRootLogin"
        line: "PermitRootLogin no"
      notify: Restart sshd

    - name: Set SSH password authentication to no
      ansible.builtin.lineinfile:
        path: /etc/ssh/sshd_config
        regexp: "^PasswordAuthentication"
        line: "PasswordAuthentication no"
      notify: Restart sshd

    - name: Configure firewall (allow SSH and HTTP/HTTPS)
      ansible.posix.firewalld:
        service: "{{ item }}"
        permanent: true
        state: enabled
        immediate: true
      loop:
        - ssh
        - http
        - https
      tags: [firewall]

    - name: Set sysctl security parameters
      ansible.posix.sysctl:
        name: "{{ item.key }}"
        value: "{{ item.value }}"
        sysctl_set: true
        reload: true
      loop:
        - { key: "net.ipv4.conf.all.rp_filter", value: "1" }
        - { key: "net.ipv4.conf.default.rp_filter", value: "1" }
        - { key: "net.ipv4.icmp_echo_ignore_broadcasts", value: "1" }
        - { key: "net.ipv4.conf.all.accept_redirects", value: "0" }
      tags: [sysctl]

    - name: Deploy sudoers template
      ansible.builtin.template:
        src: templates/sudoers.j2
        dest: /etc/sudoers.d/custom
        mode: "0440"
        validate: "visudo -cf %s"

  handlers:
    - name: Restart sshd
      ansible.builtin.service:
        name: sshd
        state: restarted
```

Key Ansible patterns:
- Use `ansible.builtin.*` fully qualified collection names
- Use handlers for service restarts (only triggered on change)
- Use `validate` for critical config files (sudoers, nginx)
- Use `tags` for selective execution
- Use `become: true` (not `become: yes`) for privilege escalation
- Use `ansible-vault` for sensitive variables

## AWS CLI Essential Commands

```bash
# EKS: update kubeconfig
aws eks update-kubeconfig --name my-cluster --region us-east-1

# EC2: list running instances
aws ec2 describe-instances --filters "Name=instance-state-name,Values=running" \
  --query "Reservations[].Instances[].{ID:InstanceId,Type:InstanceType,IP:PrivateIpAddress,Name:Tags[?Key=='Name']|[0].Value}" \
  --output table

# Lambda: tail logs
aws logs tail /aws/lambda/my-function --follow --since 1h

# ECS: force new deployment
aws ecs update-service --cluster production --service api --force-new-deployment

# Secrets Manager: rotate secret
aws secretsmanager rotate-secret --secret-id production/database

# S3: sync with delete
aws s3 sync ./dist s3://my-bucket/assets --delete --cache-control "max-age=31536000"

# SSM: connect to instance (no SSH keys needed)
aws ssm start-session --target i-0123456789abcdef0

# Cost: get monthly spend
aws ce get-cost-and-usage \
  --time-period Start=2025-01-01,End=2025-02-01 \
  --granularity MONTHLY \
  --metrics BlendedCost \
  --group-by Type=DIMENSION,Key=SERVICE
```

## CNCF Project Maturity Table

| Project | Status | Category |
|---------|--------|----------|
| Kubernetes | Graduated | Orchestration |
| Prometheus | Graduated | Monitoring |
| Envoy | Graduated | Proxy |
| CoreDNS | Graduated | Service Discovery |
| containerd | Graduated | Container Runtime |
| Helm | Graduated | Package Management |
| Argo | Graduated | CI/CD, GitOps |
| Flux | Graduated | GitOps |
| Cilium | Graduated | Networking, Security |
| Istio | Graduated | Service Mesh |
| OPA | Graduated | Policy |
| etcd | Graduated | Key-Value Store |
| OpenTelemetry | Incubating | Observability |
| Backstage | Incubating | Developer Portal |
| Crossplane | Incubating | IaC |
| Dapr | Incubating | Application Runtime |
| Falco | Incubating | Runtime Security |
| KEDA | Incubating | Autoscaling |
| Knative | Incubating | Serverless |
| Kyverno | Incubating | Policy |
| Linkerd | Incubating | Service Mesh |
| Kepler | Sandbox | Sustainability |
| SpinKube | Sandbox | Wasm Workloads |

## Kubernetes Managed Comparison

| Feature | EKS (AWS) | GKE (GCP) | AKS (Azure) |
|---------|-----------|-----------|-------------|
| **Control plane cost** | $0.10/hr (~$73/mo) | Free (Autopilot: per pod) | Free |
| **Default CNI** | AWS VPC CNI | Calico / Dataplane V2 | Azure CNI |
| **Node autoscaling** | Karpenter (recommended) | GKE Autopilot / NAP | KEDA + Cluster Autoscaler |
| **Managed Istio** | No (use add-on) | Anthos Service Mesh | Istio-based (OSM deprecated) |
| **GPU support** | NVIDIA (P4, V100, A100, H100) | NVIDIA (T4, A100, H100, TPU) | NVIDIA (T4, A100, H100) |
| **Max nodes** | 5000 | 15000 (Autopilot: 1000) | 5000 |
| **Fargate/Serverless** | Fargate (per pod) | Autopilot | Virtual Nodes (ACI) |
| **Maturity** | High | Highest | High |
| **Best for** | AWS-heavy orgs | Best K8s experience | Azure/MS ecosystem |

## Emerging Tools & Trends (2024-2025)

### Dagger (portable CI)
- Write CI pipelines in Go, Python, or TypeScript
- Run identically locally and in any CI system
- Container-native: every step runs in a container
- Caching built-in, dramatically faster than traditional CI

### KEDA (event-driven autoscaling)
- Scale K8s workloads based on event sources (SQS, Kafka, Prometheus, cron)
- Scale to zero when idle (cost savings)
- 60+ built-in scalers

### Karpenter (node provisioning)
- Just-in-time node provisioning for K8s
- Selects optimal instance type based on pending pod requirements
- Faster than Cluster Autoscaler (seconds vs minutes)
- Consolidates underutilized nodes automatically

### Cilium (eBPF networking)
- Replaces kube-proxy with eBPF (higher performance)
- Network policies at L3/L4/L7 without sidecars
- Service mesh without sidecars (per-node proxy)
- Hubble for network observability

### Platform Engineering
- Internal Developer Platforms (IDPs) abstract infrastructure complexity
- Golden paths: opinionated, pre-built templates for common patterns
- Self-service: developers provision infra without tickets
- Tools: Backstage (Spotify), Port, Kratix, Humanitec

### eBPF
- Kernel-level programmability without kernel modules
- Used by: Cilium (networking), Falco (security), Kepler (energy), Pixie (observability)
- Enables observability and security without code changes or sidecars

### WebAssembly (Wasm) in Kubernetes
- SpinKube: run Wasm workloads alongside containers in K8s
- Sub-millisecond cold start (vs seconds for containers)
- Smaller footprint than containers
- Early-stage but promising for edge and serverless workloads
