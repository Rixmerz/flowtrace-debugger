# DevOps Tools & Ecosystem Reference

## Containers

| Tool | Version | Key Trait | When to Use |
|------|---------|-----------|-------------|
| **Docker Engine** | 26.x | Standard, BuildKit default, Compose V2 | Default for local dev and CI |
| **containerd** | 1.7+ | CRI-compliant, K8s default runtime | Kubernetes nodes |
| **Podman** | 5.x | Rootless, daemonless, Docker-compatible CLI | Security-sensitive envs, no root |
| **Buildah** | 1.37+ | OCI image builder, no daemon, Dockerfile-compatible | CI builds without Docker daemon |
| **Kaniko** | latest | Builds images in unprivileged containers | CI in K8s (no Docker socket) |
| **Skopeo** | 1.16+ | Copy/inspect images without pulling layers | Registry operations, mirroring |

## Kubernetes Ecosystem

### Core Tooling

| Tool | Purpose |
|------|---------|
| **kubectl** | CLI for cluster management |
| **Helm 3** | Package manager (charts with templated YAML) |
| **Kustomize** | Overlay-based config (no templates, built into kubectl) |
| **k9s** | Terminal UI for cluster management |
| **Lens** | Desktop IDE for Kubernetes |
| **Telepresence** | Local dev connected to remote cluster |
| **kubectx/kubens** | Fast context/namespace switching |
| **stern** | Multi-pod log tailing |

### K8s Extensions

| Tool | Purpose |
|------|---------|
| **cert-manager** | Automated TLS certificate management (Let's Encrypt) |
| **ingress-nginx** | NGINX-based Ingress controller |
| **Traefik** | Cloud-native reverse proxy / Ingress |
| **MetalLB** | Bare-metal LoadBalancer for on-prem K8s |
| **external-dns** | Automatic DNS records from K8s resources |

## CI/CD & GitOps

| Tool | Key Trait | Best For |
|------|-----------|----------|
| **GitHub Actions** | GitHub-native, marketplace, matrix builds | GitHub-hosted projects |
| **GitLab CI** | Built-in registry, DAST, review apps | Self-hosted, full DevSecOps |
| **Jenkins** | Extensible, on-prem, Groovy pipelines | Enterprise, legacy systems |
| **CircleCI** | Fast, orbs (reusable configs), Docker-first | SaaS teams, Docker workflows |
| **ArgoCD** | GitOps for K8s, declarative, auto-sync | Kubernetes deployments |
| **FluxCD** | GitOps, lightweight, Helm/Kustomize native | K8s, multi-tenant |
| **Tekton** | Cloud-native CI/CD, K8s-native pipelines | K8s-native build system |
| **Dagger** | Portable CI pipelines as code (Go/Python/TS) | Cross-platform CI, local + CI parity |

## Infrastructure as Code (IaC)

| Tool | Approach | Best For |
|------|----------|----------|
| **Terraform** | Declarative HCL, multi-cloud, state file | Multi-cloud, provider-agnostic |
| **OpenTofu** | Open-source Terraform fork (CNCF) | Avoiding Terraform BSL license |
| **Pulumi** | Code-first (TS, Python, Go, C#) | Developers who prefer real languages |
| **CDK for Terraform** | Code-first, synthesizes Terraform HCL | Terraform + programming language DX |
| **Ansible** | Agentless, YAML playbooks, SSH-based | Configuration management, provisioning |
| **Crossplane** | K8s-native IaC (CRDs for cloud resources) | K8s-centric teams, GitOps for infra |

## Observability Stacks

| Stack | Components | Best For |
|-------|-----------|----------|
| **Prometheus + Grafana** | Prometheus (metrics), Grafana (dashboards) | Open-source, K8s-native |
| **Grafana LGTM** | Loki (logs) + Grafana + Tempo (traces) + Mimir (metrics) | Full open-source observability |
| **ELK Stack** | Elasticsearch + Logstash + Kibana | Log aggregation, search |
| **OpenTelemetry** | Vendor-neutral SDK + Collector | Instrumentation standard |
| **Datadog** | Metrics, logs, traces, APM, synthetics | SaaS, full-featured, expensive |
| **New Relic** | APM, infrastructure, logs | SaaS, developer-friendly |

## Networking & Service Mesh

| Tool | Approach | Best For |
|------|----------|----------|
| **Istio** | Full-featured mesh, Envoy sidecar | mTLS, traffic management, observability |
| **Linkerd** | Lightweight mesh, Rust proxy | Simple mesh, low overhead |
| **Cilium** | eBPF-based, no sidecars, networking + mesh | High performance, L3/L4 + L7 |
| **Calico** | Network policy, BGP, eBPF data plane | Network policy enforcement |

## Secrets Management

| Tool | Approach | Best For |
|------|----------|----------|
| **HashiCorp Vault** | Centralized, dynamic secrets, PKI | Multi-cloud, enterprise |
| **External Secrets Operator** | K8s operator, syncs from external stores | K8s + any cloud secret store |
| **AWS Secrets Manager** | AWS-native, automatic rotation | AWS ecosystem |
| **GCP Secret Manager** | GCP-native, IAM-integrated | GCP ecosystem |
| **Azure Key Vault** | Azure-native, HSM-backed | Azure ecosystem |
| **SOPS** | Encrypted files in Git (age/PGP/KMS) | GitOps, secrets in repo |

## Policy & Security

| Tool | Purpose | Approach |
|------|---------|----------|
| **OPA / Gatekeeper** | K8s admission control, policy-as-code | Rego language, graduated CNCF |
| **Kyverno** | K8s policy engine | YAML-native policies (no Rego) |
| **Trivy** | Container image + IaC + SBOM scanning | Multi-target vulnerability scanner |
| **Cosign / Sigstore** | Container image signing + verification | Supply chain security |
| **Falco** | Runtime security monitoring | Syscall-based anomaly detection |
| **checkov** | IaC static analysis (Terraform, K8s, Docker) | Policy-as-code for IaC |
| **tfsec** | Terraform-specific security scanner | Terraform security analysis |

## Cloud Comparison Table

| Service | AWS | GCP | Azure |
|---------|-----|-----|-------|
| **Compute** | EC2, Lambda | Compute Engine, Cloud Functions | VMs, Azure Functions |
| **K8s** | EKS | GKE | AKS |
| **Serverless containers** | Fargate, App Runner | Cloud Run | Container Apps |
| **Relational DB** | RDS, Aurora | Cloud SQL, AlloyDB | Azure SQL |
| **NoSQL** | DynamoDB | Firestore, Bigtable | Cosmos DB |
| **Object Storage** | S3 | Cloud Storage | Blob Storage |
| **CDN** | CloudFront | Cloud CDN | Azure CDN / Front Door |
| **Messaging** | SQS, SNS, EventBridge | Pub/Sub | Service Bus, Event Grid |
| **Secrets** | Secrets Manager | Secret Manager | Key Vault |
| **IAM** | IAM, STS | IAM, Workload Identity | Entra ID, Managed Identity |
| **Monitoring** | CloudWatch | Cloud Monitoring | Azure Monitor |
| **IaC native** | CloudFormation, CDK | Deployment Manager | ARM / Bicep |

## FinOps Tools

| Tool | Purpose |
|------|---------|
| **Kubecost** | K8s cost monitoring and allocation |
| **Infracost** | Terraform cost estimation in CI (before apply) |
| **AWS Cost Explorer** | AWS spend analysis and forecasting |
| **GCP Billing** | GCP cost management and budgets |
| **Spot.io** | Spot/preemptible instance management |

## Emerging Tools (2024-2025)

| Tool | What | Why It Matters |
|------|------|---------------|
| **Dagger** | Portable CI pipelines as code | Same pipeline locally and in CI |
| **KEDA** | Event-driven autoscaling for K8s | Scale to zero, queue-based scaling |
| **Karpenter** | Just-in-time K8s node provisioning | Faster, smarter than Cluster Autoscaler |
| **Backstage** | Developer portal (Spotify) | Service catalog, templates, docs |
| **Port** | Internal developer portal | Self-service infra, scorecards |
| **Kepler** | K8s energy/carbon monitoring (eBPF) | Sustainability metrics |
| **SpinKube** | WebAssembly workloads on K8s | Wasm containers, sub-ms cold start |
| **Cilium** | eBPF networking + mesh + observability | Replace kube-proxy, sidecars, and network policies in one tool |
