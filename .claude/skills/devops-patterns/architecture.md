# DevOps Architecture Patterns

## Deployment Strategies

### Rolling Update (zero downtime, default K8s)
```yaml
strategy:
  type: RollingUpdate
  rollingUpdate:
    maxSurge: 1          # 1 extra pod during update
    maxUnavailable: 0     # Never reduce below desired count
```
- Gradual pod replacement, old pods drain before termination
- Rollback: `kubectl rollout undo deployment/api-server`
- Best for: most workloads, stateless services

### Blue/Green (instant switch)
```
[Blue (v1)] <-- Load Balancer --> [Green (v2)]
                    |
            Switch routing instantly
```
- Two identical environments, switch traffic atomically
- Rollback: switch back to blue
- Cost: 2x resources during deployment
- Best for: critical services needing instant rollback

### Canary (progressive delivery with Argo Rollouts)
```yaml
apiVersion: argoproj.io/v1alpha1
kind: Rollout
metadata:
  name: api-server
spec:
  strategy:
    canary:
      steps:
        - setWeight: 5            # 5% traffic to canary
        - pause: { duration: 5m }
        - analysis:
            templates:
              - templateName: success-rate
            args:
              - name: service-name
                value: api-server
        - setWeight: 25
        - pause: { duration: 10m }
        - setWeight: 50
        - pause: { duration: 10m }
        - setWeight: 100
      canaryService: api-server-canary
      stableService: api-server-stable
---
apiVersion: argoproj.io/v1alpha1
kind: AnalysisTemplate
metadata:
  name: success-rate
spec:
  args:
    - name: service-name
  metrics:
    - name: success-rate
      interval: 60s
      successCondition: result[0] >= 0.99
      failureLimit: 3
      provider:
        prometheus:
          address: http://prometheus.monitoring:9090
          query: |
            sum(rate(http_requests_total{service="{{args.service-name}}",status=~"2.."}[5m]))
            /
            sum(rate(http_requests_total{service="{{args.service-name}}"}[5m]))
```

### A/B Testing
- Route traffic based on headers, cookies, or user segments
- Requires service mesh (Istio) or feature flag system
- Used for UX experiments, not deployment safety

| Strategy | Downtime | Risk | Rollback | Resource Cost |
|----------|----------|------|----------|---------------|
| **Rolling** | Zero | Medium | Slow (re-roll) | 1x + surge |
| **Blue/Green** | Zero | Low | Instant (swap) | 2x |
| **Canary** | Zero | Lowest | Instant (route) | 1.05-1.5x |
| **A/B Testing** | Zero | Lowest | Instant (route) | 1.1x |
| **Recreate** | Yes | High | Redeploy | 1x |

## GitOps Pull Model (ArgoCD)

```
                    +-----------+
                    |   Git     |  <-- Single source of truth
                    | (manifests)|
                    +-----+-----+
                          |
                          | Poll / Webhook
                          v
                    +-----------+
                    |  ArgoCD   |  <-- Reconciliation loop
                    |           |
                    +-----+-----+
                          |
                          | kubectl apply
                          v
                    +-----------+
                    | Kubernetes|  <-- Desired state == Actual state
                    |  Cluster  |
                    +-----------+
```

Reconciliation loop:
1. ArgoCD watches Git repo for changes (polling or webhook)
2. Compares desired state (Git) with actual state (cluster)
3. If drift detected: auto-sync (if enabled) or alert
4. `selfHeal: true` reverts manual `kubectl` changes
5. `prune: true` deletes resources removed from Git

Benefits:
- Audit trail (Git history = deployment history)
- Rollback = `git revert`
- No cluster credentials in CI pipeline
- Declarative, reproducible

## Multi-Cluster Kubernetes

```
              +------------------+
              |  Management      |
              |  Cluster         |
              |  (ArgoCD hub)    |
              +--------+---------+
                       |
          +------------+------------+
          |            |            |
   +------+------+ +--+-------+ +-+--------+
   |  us-east-1  | | eu-west-1| | ap-south |
   |  (prod)     | | (prod)   | | (prod)   |
   +-------------+ +----------+ +----------+
```

ArgoCD ApplicationSet with cluster generator deploys to all matching clusters.
Each cluster gets environment-specific overlays via Kustomize or Helm values.

## Disaster Recovery Strategies

| Strategy | RPO | RTO | Cost | Description |
|----------|-----|-----|------|-------------|
| **Backup & Restore** | Hours | Hours | $ | Periodic backups, restore on demand |
| **Pilot Light** | Minutes | 10-30 min | $$ | Core infra running, scale up on failover |
| **Warm Standby** | Seconds-Minutes | Minutes | $$$ | Scaled-down replica always running |
| **Multi-Site Active/Active** | Near-zero | Near-zero | $$$$ | Full capacity in multiple regions |

RPO = Recovery Point Objective (max data loss tolerable)
RTO = Recovery Time Objective (max downtime tolerable)

### Velero for K8s Backup/Restore
```bash
# Install Velero with AWS S3 backend
velero install \
  --provider aws \
  --bucket velero-backups \
  --secret-file ./credentials-velero \
  --backup-location-config region=us-east-1

# Create backup
velero backup create production-backup \
  --include-namespaces production \
  --include-resources deployments,services,configmaps,secrets,pvc

# Schedule daily backups with 30-day retention
velero schedule create daily-production \
  --schedule="0 2 * * *" \
  --include-namespaces production \
  --ttl 720h

# Restore to same or different cluster
velero restore create --from-backup production-backup \
  --namespace-mappings production:production-restored
```

## Istio Traffic Management

### Canary Routing (weight-based)
```yaml
apiVersion: networking.istio.io/v1
kind: VirtualService
metadata:
  name: api-server
spec:
  hosts:
    - api-server
  http:
    - route:
        - destination:
            host: api-server
            subset: stable
          weight: 90
        - destination:
            host: api-server
            subset: canary
          weight: 10
      timeout: 10s
      retries:
        attempts: 3
        perTryTimeout: 3s
        retryOn: 5xx,reset,connect-failure
---
apiVersion: networking.istio.io/v1
kind: DestinationRule
metadata:
  name: api-server
spec:
  host: api-server
  trafficPolicy:
    connectionPool:
      tcp:
        maxConnections: 100
      http:
        h2UpgradePolicy: DEFAULT
        maxRequestsPerConnection: 10
    outlierDetection:              # Circuit breaker
      consecutive5xxErrors: 5
      interval: 30s
      baseEjectionTime: 30s
      maxEjectionPercent: 50
  subsets:
    - name: stable
      labels:
        version: v1
    - name: canary
      labels:
        version: v2
```

### Header-based routing (A/B testing)
```yaml
apiVersion: networking.istio.io/v1
kind: VirtualService
metadata:
  name: api-server
spec:
  hosts:
    - api-server
  http:
    - match:
        - headers:
            x-canary:
              exact: "true"
      route:
        - destination:
            host: api-server
            subset: canary
    - route:
        - destination:
            host: api-server
            subset: stable
```

## SLI / SLO / SLA

| Term | Definition | Example |
|------|-----------|---------|
| **SLI** (Indicator) | Metric measuring service quality | 99.2% requests < 200ms |
| **SLO** (Objective) | Target for an SLI | 99.5% requests < 200ms over 30 days |
| **SLA** (Agreement) | Contract with consequences | 99.9% uptime or credits issued |
| **Error Budget** | 100% - SLO = allowed failures | 0.5% = ~3.6 hours/month of errors |

Rule: SLO should be stricter than SLA. Alert on SLO burn rate, not individual errors.

Error budget burn rate alerting:
- **Fast burn**: 14x budget rate for 1 hour → page immediately
- **Slow burn**: 3x budget rate for 6 hours → ticket

## DORA Metrics

| Metric | Elite | High | Medium | Low |
|--------|-------|------|--------|-----|
| **Deployment frequency** | On-demand (multiple/day) | Weekly-Monthly | Monthly-6 months | > 6 months |
| **Lead time for changes** | < 1 hour | 1 day - 1 week | 1 week - 1 month | > 1 month |
| **Mean time to restore (MTTR)** | < 1 hour | < 1 day | 1 day - 1 week | > 1 month |
| **Change failure rate** | < 5% | 5-10% | 10-15% | > 15% |

Additional metric (2023+):
- **Reliability**: Achieving or exceeding SLO targets

## DevOps vs Platform Engineering vs SRE

| Aspect | DevOps Engineer | Platform Engineer | SRE |
|--------|----------------|-------------------|-----|
| **Focus** | CI/CD, automation, culture | Internal developer platform (IDP) | Reliability, SLOs, error budgets |
| **Serves** | Development + Operations | All engineering teams | Production services |
| **Key output** | Pipelines, IaC, monitoring | Self-service portal, golden paths | SLOs, incident response, capacity planning |
| **Tools** | Terraform, ArgoCD, Jenkins | Backstage, Port, Crossplane | Prometheus, PagerDuty, Chaos Engineering |
| **Mindset** | "Automate everything" | "Make the right thing easy" | "Reliability is a feature" |
| **Error budget** | No formal concept | Builds tooling for it | Owns and enforces it |

Platform Engineering trend (2024-2025): Internal Developer Platforms (IDPs) with self-service infrastructure, service catalogs, and golden paths that abstract away K8s/cloud complexity.
