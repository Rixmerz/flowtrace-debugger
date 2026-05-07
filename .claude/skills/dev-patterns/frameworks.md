# Development Tools & Ecosystem Reference

## Version Control

### Git Branching Strategies

| Strategy | When to Use | Trade-off |
|----------|-------------|-----------|
| **Trunk-Based** | CI/CD mature, feature flags, small PRs | Fast delivery, requires discipline |
| **GitHub Flow** | Single main + feature branches, PRs | Simple, good for most teams |
| **GitFlow** | Scheduled releases, multiple versions | Structured, complex, slow merges |

### Conventional Commits
```
<type>(<scope>): <description>

feat(auth): add OAuth2 PKCE flow
fix(api): handle null response in user endpoint
refactor(db): extract connection pool config
perf(cache): reduce Redis round-trips with pipeline
docs(api): update OpenAPI spec for v2 endpoints
chore(deps): bump express to 4.19
ci(deploy): add staging smoke tests
BREAKING CHANGE: remove deprecated /v1/users endpoint
```

Types: `feat`, `fix`, `refactor`, `perf`, `docs`, `chore`, `ci`, `test`, `build`, `style`

### Semantic Versioning (SemVer)
```
MAJOR.MINOR.PATCH  (e.g., 2.4.1)

MAJOR: Breaking changes (removed API, changed behavior)
MINOR: New features, backward-compatible
PATCH: Bug fixes, backward-compatible
```

## CI/CD

### Pipeline Stages (Reference Architecture)

```
Commit
  |
  v
[1. Lint + Format]       eslint, ruff, cargo fmt, gofmt, prettier
  |
  v
[2. Unit Tests]           vitest, pytest, go test, cargo test
  |
  v
[3. Build]                compile, bundle, Docker image
  |
  v
[4. Integration Tests]    TestContainers, real DB, API tests
  |
  v
[5. SAST + Security]      SonarQube, Semgrep, CodeQL, Snyk, GitLeaks
  |
  v
[6. Deploy Staging]       Helm upgrade, Terraform apply (staging)
  |
  v
[7. Smoke Tests]          Critical path verification on staging
  |
  v
[8. Deploy Production]    Canary / Blue-Green / Rolling
  |
  v
[9. Post-Deploy]          Smoke tests, observability verification
```

### CI/CD Platforms

| Platform | Strength | Best For |
|----------|----------|----------|
| **GitHub Actions** | GitHub-native, marketplace, matrix builds | GitHub-hosted projects |
| **GitLab CI** | Built-in registry, DAST, review apps | Self-hosted, full DevSecOps |
| **Jenkins** | Extensible, on-prem, Groovy pipelines | Enterprise, legacy systems |
| **CircleCI** | Fast, orbs (reusable configs), Docker-first | SaaS teams, Docker workflows |
| **ArgoCD** | GitOps for K8s, declarative, auto-sync | Kubernetes deployments |
| **Flux** | GitOps, lightweight, Helm/Kustomize native | Kubernetes, multi-tenant |

### Deployment Strategies

| Strategy | Downtime | Risk | Rollback | Resource Cost |
|----------|----------|------|----------|---------------|
| **Rolling** | Zero | Medium | Slow (re-roll) | 1x |
| **Blue-Green** | Zero | Low | Instant (swap) | 2x |
| **Canary** | Zero | Lowest | Instant (route) | 1.1x |
| **Feature Flags** | Zero | Lowest | Instant (toggle) | 1x |
| **Recreate** | Yes | High | Redeploy | 1x |

## Containers & Orchestration

### Docker Multi-Stage Build (Best Practice)
```dockerfile
# Stage 1: Build
FROM node:22-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --production=false
COPY . .
RUN npm run build

# Stage 2: Production
FROM node:22-slim AS production
WORKDIR /app
RUN addgroup --system app && adduser --system --ingroup app app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s CMD curl -f http://localhost:3000/health/live || exit 1
CMD ["node", "dist/server.js"]
```

Rules:
- Always use multi-stage builds (smaller images)
- Pin base image versions (not `latest`)
- Run as non-root user
- Include HEALTHCHECK
- Use `.dockerignore` (exclude `node_modules`, `.git`, tests)
- Order layers by change frequency (dependencies before source code)

### Kubernetes Concepts

| Resource | Purpose |
|----------|---------|
| **Pod** | Smallest deployable unit (1+ containers) |
| **Deployment** | Manages ReplicaSets, rolling updates |
| **Service** | Stable network endpoint for pods |
| **Ingress** | HTTP routing, TLS termination |
| **ConfigMap** | Non-sensitive configuration |
| **Secret** | Sensitive data (encrypted at rest) |
| **HPA** | Horizontal Pod Autoscaler (CPU/memory/custom) |
| **PVC** | Persistent Volume Claim (storage) |

### Kubernetes Tooling

| Tool | Purpose |
|------|---------|
| **Helm** | Package manager (charts with templated YAML) |
| **Kustomize** | Overlay-based config (no templates, built into kubectl) |
| **k9s** | Terminal UI for cluster management |
| **Lens** | Desktop IDE for Kubernetes |
| **Telepresence** | Local dev connected to remote cluster |

## Cloud Providers Comparison

| Service | AWS | GCP | Azure |
|---------|-----|-----|-------|
| **Compute** | EC2, Lambda | Compute Engine, Cloud Functions | VMs, Azure Functions |
| **Containers** | ECS, EKS, Fargate | GKE, Cloud Run | AKS, Container Apps |
| **Object Storage** | S3 | Cloud Storage | Blob Storage |
| **Relational DB** | RDS, Aurora | Cloud SQL, AlloyDB | Azure SQL, Cosmos (SQL) |
| **NoSQL** | DynamoDB | Firestore, Bigtable | Cosmos DB |
| **Messaging** | SQS, SNS, EventBridge | Pub/Sub | Service Bus, Event Grid |
| **CDN** | CloudFront | Cloud CDN | Azure CDN / Front Door |
| **DNS** | Route 53 | Cloud DNS | Azure DNS |
| **Secrets** | Secrets Manager | Secret Manager | Key Vault |
| **IaC** | CloudFormation, CDK | Deployment Manager | ARM/Bicep |

## Infrastructure as Code (IaC)

| Tool | Approach | Best For |
|------|----------|----------|
| **Terraform** | Declarative HCL, multi-cloud, state file | Multi-cloud, provider-agnostic |
| **OpenTofu** | Open-source Terraform fork | Avoiding Terraform license concerns |
| **Pulumi** | Code-first (TS, Python, Go, C#) | Developers who prefer real languages |
| **CDK** (AWS) | Code-first, synthesizes CloudFormation | AWS-only, TypeScript/Python teams |
| **Bicep** (Azure) | Declarative, Azure-native | Azure-only deployments |

Terraform best practices:
- Use remote state (S3 + DynamoDB lock, or Terraform Cloud)
- Modularize: reusable modules per resource group
- Use `terraform plan` in CI, `terraform apply` in CD
- Pin provider versions
- Never store secrets in state -- use Vault or cloud secret stores

## Observability

### Three Pillars + Events

| Pillar | What | Tool Examples |
|--------|------|---------------|
| **Logs** | Discrete events with context | ELK, Loki + Grafana, CloudWatch Logs |
| **Metrics** | Numeric measurements over time | Prometheus + Grafana, Datadog, CloudWatch |
| **Traces** | Request flow across services | Jaeger, Zipkin, Tempo, Datadog APM |
| **Events** | Business-level occurrences | Custom dashboards, alerting rules |

### OpenTelemetry (OTel)
Vendor-neutral standard for instrumentation. Supports logs, metrics, and traces.
- Auto-instrumentation available for most languages
- Export to any backend (Jaeger, Prometheus, Datadog, etc.)
- Collector for processing and routing telemetry data

### SLI / SLO / SLA

| Term | Definition | Example |
|------|-----------|---------|
| **SLI** (Indicator) | Metric measuring service quality | 99.2% of requests < 200ms |
| **SLO** (Objective) | Target for an SLI | 99.5% of requests < 200ms over 30 days |
| **SLA** (Agreement) | Contract with consequences | 99.9% uptime or credits issued |

Rule: SLO < SLA (internal target stricter than customer promise). Alert on SLO burn rate, not individual errors.

### Golden Signals (Google SRE)

| Signal | What to Measure | Alert When |
|--------|----------------|------------|
| **Latency** | Request duration (p50, p95, p99) | p99 > threshold for 5 min |
| **Traffic** | Requests per second | Anomalous spike or drop |
| **Errors** | Error rate (5xx / total) | Error rate > SLO budget |
| **Saturation** | Resource utilization (CPU, memory, queue depth) | > 80% sustained |

## Security Tools

| Category | Tool | What It Does |
|----------|------|-------------|
| **SAST** | SonarQube | Code quality + security analysis |
| **SAST** | Semgrep | Lightweight, custom rules, multi-language |
| **SAST** | CodeQL | Deep data-flow analysis (GitHub-native) |
| **DAST** | OWASP ZAP | Runtime vulnerability scanning of web apps |
| **SCA** | Snyk | Dependency vulnerability scanning |
| **SCA** | Dependabot | Automated dependency PRs (GitHub) |
| **SCA** | Trivy | Container image + IaC scanning |
| **Secrets** | HashiCorp Vault | Centralized secrets management |
| **Secrets** | AWS Secrets Manager | AWS-native secret storage + rotation |
| **Secrets** | GitLeaks | Detect hardcoded secrets in git history |
| **Container** | Falco | Runtime security monitoring for K8s |
| **Policy** | OPA / Gatekeeper | Policy-as-code for K8s admission control |
