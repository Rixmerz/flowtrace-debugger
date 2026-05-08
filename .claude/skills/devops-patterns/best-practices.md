# DevOps Best Practices (2024-2025)

## Container Security

### Dockerfile checklist
- Use distroless or alpine base images (not `ubuntu:latest`)
- Pin base image versions: `FROM node:22.12-alpine3.20`
- Run as non-root: `USER 1000` or named user
- Use COPY, not ADD (ADD has implicit URL fetch + tar extraction)
- Never embed secrets in Dockerfile (no `ENV SECRET=...`, no `COPY .env`)
- Order layers by change frequency: OS deps -> language deps -> source code
- Use `.dockerignore`: exclude `.git`, `node_modules`, `__pycache__`, tests, docs
- Include HEALTHCHECK directive
- Use multi-stage builds (builder -> runtime)
- Scan with Trivy in CI: `trivy image --severity HIGH,CRITICAL myapp:latest`

### Image size optimization
```
ubuntu:22.04     ~77MB
alpine:3.20      ~7MB
distroless/base  ~20MB
distroless/static ~2MB (no libc, for Go/Rust static binaries)
scratch          0MB (absolute minimum, for static binaries only)
```

## Kubernetes Production Checklist

### Resources (required for every container)
```yaml
resources:
  requests:          # Scheduler uses this for placement
    cpu: 250m        # 0.25 CPU cores
    memory: 256Mi    # Guaranteed memory
  limits:
    cpu: "1"         # Throttled above this
    memory: 512Mi    # OOMKilled above this
```
Rule: Always set requests. Set memory limits. CPU limits are optional (throttling can cause latency spikes).

### Security context
```yaml
securityContext:
  runAsNonRoot: true
  runAsUser: 1000
  readOnlyRootFilesystem: true
  allowPrivilegeEscalation: false
  capabilities:
    drop: ["ALL"]
```

### Probes (all three types)
```yaml
startupProbe:              # Slow-starting apps (DB migrations, cache warmup)
  httpGet:
    path: /health/startup
    port: 8080
  failureThreshold: 30
  periodSeconds: 2         # Max 60s to start

readinessProbe:            # Ready to receive traffic?
  httpGet:
    path: /health/ready
    port: 8080
  periodSeconds: 10

livenessProbe:             # Still alive? (restart if not)
  httpGet:
    path: /health/live
    port: 8080
  periodSeconds: 20
  failureThreshold: 3
```

### Pod Disruption Budget
```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
spec:
  minAvailable: 2          # Or maxUnavailable: 1
  selector:
    matchLabels:
      app: api-server
```
Required for any service with > 1 replica. Prevents node drains from killing all pods.

### Pod anti-affinity
```yaml
affinity:
  podAntiAffinity:
    preferredDuringSchedulingIgnoredDuringExecution:
      - weight: 100
        podAffinityTerm:
          labelSelector:
            matchLabels:
              app: api-server
          topologyKey: kubernetes.io/hostname
```
Spreads replicas across nodes. Use `required` for strict (HA-critical), `preferred` for best-effort.

### Graceful shutdown
```yaml
terminationGracePeriodSeconds: 60
lifecycle:
  preStop:
    exec:
      command: ["/bin/sh", "-c", "sleep 15"]
```
The `sleep 15` in preStop gives the Service time to remove the pod from endpoints before SIGTERM is sent. Without it, in-flight requests can get 503 errors.

## Terraform Best Practices

### Remote state with locking
```hcl
terraform {
  backend "s3" {
    bucket         = "company-terraform-state"
    key            = "production/api/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "terraform-locks"
    encrypt        = true
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.80"     # Pin provider version
    }
  }

  required_version = ">= 1.9"
}
```

### Module structure
```
infrastructure/
  modules/
    vpc/
      main.tf
      variables.tf
      outputs.tf
    eks/
      main.tf
      variables.tf
      outputs.tf
  environments/
    staging/
      main.tf           # Calls modules with staging values
      terraform.tfvars
    production/
      main.tf           # Calls modules with production values
      terraform.tfvars
```

### Common tags with locals
```hcl
locals {
  common_tags = {
    Environment = var.environment
    ManagedBy   = "terraform"
    Repository  = "github.com/org/infrastructure"
    Team        = var.team
  }
}

resource "aws_instance" "web" {
  ami           = var.ami_id
  instance_type = var.instance_type
  tags          = merge(local.common_tags, { Name = "web-server" })
}
```

### CI/CD for Terraform
```yaml
# GitHub Actions example
- name: Terraform Format
  run: terraform fmt -check -recursive

- name: Terraform Validate
  run: terraform validate

- name: Infracost
  run: infracost breakdown --path . --format table

- name: Checkov Scan
  run: checkov -d . --framework terraform

- name: Terraform Plan
  run: terraform plan -out=tfplan
  # Plan is saved as artifact for review

# Apply only on merge to main, with approval gate
- name: Terraform Apply
  if: github.ref == 'refs/heads/main'
  run: terraform apply tfplan
```

Rules:
- Never `terraform apply -auto-approve` in production
- Always `plan` before `apply`
- Use workspaces or directory-per-environment (prefer directory-per-env)
- No hardcoded credentials — use IAM roles, OIDC, or environment variables
- Pin module versions: `source = "git::https://...?ref=v1.2.0"`
- Run `fmt`, `validate`, `checkov`/`tfsec` in CI

## CI/CD Best Practices

### Pipeline security
- Pin action/orb versions to SHA: `uses: actions/checkout@b4ffde65f...`
- Scan images before pushing to registry: `trivy image --exit-code 1`
- Secrets as environment variables, never CLI arguments (visible in process list)
- Use OIDC for cloud authentication (no long-lived credentials)
- Sign container images with Cosign/Sigstore

### Deployment safety
- Always dry-run/diff before apply (`helm diff`, `terraform plan`, `kubectl diff`)
- Use GitOps (ArgoCD/Flux) — don't `kubectl apply` from CI
- Canary or blue/green for production deployments
- Automated rollback on failed health checks
- Post-deploy smoke tests

### GitHub Actions pattern
```yaml
name: CI/CD
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write       # OIDC
    steps:
      - uses: actions/checkout@b4ffde65f46...
      - name: Build image
        run: docker build -t $REGISTRY/$IMAGE:${{ github.sha }} .
      - name: Scan image
        run: trivy image --exit-code 1 --severity HIGH,CRITICAL $REGISTRY/$IMAGE:${{ github.sha }}
      - name: Push image
        run: docker push $REGISTRY/$IMAGE:${{ github.sha }}
      - name: Update GitOps repo
        run: |
          # Update image tag in GitOps repo, ArgoCD picks up the change
          yq -i ".image.tag = \"${{ github.sha }}\"" values.yaml
```

## Observability Best Practices

### Three pillars
| Pillar | What | When |
|--------|------|------|
| **Metrics** | Numeric time-series (counters, gauges, histograms) | Alerting, dashboards, trends |
| **Logs** | Discrete events with context | Debugging, audit trail |
| **Traces** | Request flow across services (spans) | Latency analysis, dependency mapping |

### Golden signals (alert on these)
| Signal | Metric | Alert Threshold |
|--------|--------|----------------|
| **Latency** | p99 response time | > 500ms for 5 min |
| **Traffic** | requests/sec | Anomalous spike/drop (> 2 stddev) |
| **Errors** | 5xx rate | > 1% for 5 min |
| **Saturation** | CPU/Memory/Disk/Queue | > 80% sustained 10 min |

### SLO-based alerting (error budget burn rate)
```
Fast burn:  14x budget consumed over 1 hour   → Page (wake someone up)
Slow burn:  3x budget consumed over 6 hours    → Ticket (fix in business hours)
```

### PromQL essentials
```promql
# P99 latency by service
histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket[5m])) by (le, service))

# Error rate (5xx / total)
sum(rate(http_requests_total{status=~"5.."}[5m])) / sum(rate(http_requests_total[5m]))

# CPU usage by namespace
sum(rate(container_cpu_usage_seconds_total[5m])) by (namespace)

# Memory usage percentage
container_memory_working_set_bytes / container_spec_memory_limit_bytes * 100

# Pods without resource requests
count(kube_pod_container_resource_requests{resource="cpu"} == 0) by (namespace, pod)
```

## Shell Scripting Best Practices

### Template for production scripts
```bash
#!/usr/bin/env bash
set -euo pipefail

# -e: exit on error
# -u: error on undefined variables
# -o pipefail: pipe fails if any command fails

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly LOG_FILE="/var/log/$(basename "$0" .sh).log"

log() {
  local level="$1"; shift
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] [${level}] $*" | tee -a "$LOG_FILE"
}

cleanup() {
  local exit_code=$?
  log "INFO" "Cleanup triggered (exit code: ${exit_code})"
  # Remove temp files, restore state, etc.
  exit "$exit_code"
}
trap cleanup EXIT ERR INT TERM

check_dependencies() {
  local deps=("kubectl" "helm" "jq")
  for dep in "${deps[@]}"; do
    if ! command -v "$dep" &>/dev/null; then
      log "ERROR" "Missing dependency: $dep"
      exit 1
    fi
  done
}

main() {
  check_dependencies
  log "INFO" "Starting deployment..."

  # Atomic helm upgrade with rollback
  if ! helm upgrade --install api-server ./charts/api-server \
    --namespace production \
    --values values-production.yaml \
    --wait \
    --timeout 300s \
    --atomic; then
    log "ERROR" "Helm upgrade failed, automatic rollback triggered"
    exit 1
  fi

  log "INFO" "Deployment completed successfully"
}

main "$@"
```

Key rules:
- Always `set -euo pipefail`
- Use `log()` function (not raw `echo`)
- `trap cleanup` for resource cleanup
- `check_dependencies` before running
- `readonly` for constants
- Quote all variables: `"$var"` not `$var`
- Use `[[` not `[` for conditionals
- Don't use `sleep` for health checks — poll with timeout

## systemd Service Hardening

```ini
[Unit]
Description=API Server
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=300
StartLimitBurst=5

[Service]
Type=exec
User=apiserver
Group=apiserver
WorkingDirectory=/opt/api-server

ExecStart=/opt/api-server/bin/server
ExecReload=/bin/kill -HUP $MAINPID

Restart=on-failure
RestartSec=5

# Security hardening
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=/var/log/api-server /var/lib/api-server
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictSUIDSGID=yes
MemoryMax=1G
CPUQuota=200%

# Network
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
PrivateNetwork=no

[Install]
WantedBy=multi-user.target
```

## Linux Diagnostic Commands

### CPU
```bash
top -bn1 | head -20                          # Quick overview
mpstat -P ALL 1 5                            # Per-CPU usage
pidstat -u 1 5                               # Per-process CPU
perf top                                     # Real-time profiling
```

### Memory
```bash
free -h                                      # Memory overview
vmstat 1 5                                   # Virtual memory stats
cat /proc/meminfo                            # Detailed memory info
slabtop                                      # Kernel slab cache
```

### Disk I/O
```bash
iostat -xz 1 5                               # Disk I/O stats
iotop -oPa                                   # Per-process I/O
df -h                                        # Filesystem usage
lsblk                                        # Block devices
```

### Network
```bash
ss -tlnp                                     # Listening ports
ss -s                                        # Socket summary
iftop                                        # Real-time bandwidth
nstat                                        # Network counters
curl -w "@curl-format.txt" -o /dev/null URL  # HTTP timing breakdown
```

### Processes
```bash
ps auxf                                      # Process tree
pstree -p                                    # Visual process tree
strace -p PID -c                             # Syscall summary
lsof -p PID                                  # Open files by process
journalctl -u service -f --since "1h ago"    # Service logs
```

## FinOps Strategies

| Strategy | Savings | Effort |
|----------|---------|--------|
| **Spot/Preemptible instances** | 60-90% | Medium (need fault tolerance) |
| **Reserved instances / Savings Plans** | 30-60% | Low (commit to usage) |
| **Right-sizing** | 20-40% | Medium (analyze actual usage) |
| **Autoscaling to zero** (KEDA, Cloud Run) | Variable | Medium (need cold start tolerance) |
| **Storage tiering** (S3 IA, Glacier) | 40-80% on storage | Low (lifecycle policies) |
| **Karpenter** (K8s node right-sizing) | 20-40% | Low (replaces Cluster Autoscaler) |
| **Delete unused resources** | Variable | Low (find orphaned EBS, IPs, LBs) |

Use Infracost in CI to estimate cost impact of Terraform changes before apply.
Use Kubecost for K8s cost allocation by namespace/team/label.
