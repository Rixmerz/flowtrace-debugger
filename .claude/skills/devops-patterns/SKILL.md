---
name: devops-patterns
description: DevOps and infrastructure reference - containers, Kubernetes, CI/CD, GitOps, IaC (Terraform/Ansible), observability, cloud multi-cloud, security, and production operations for 2024-2025. Use when configuring infrastructure, writing Dockerfiles, Kubernetes manifests, Terraform modules, CI/CD pipelines, or monitoring setups.
user-invocable: true
argument-hint: "[frameworks|patterns|architecture|practices|features|all]"
---

# DevOps & Infrastructure Reference (2024-2025)

Comprehensive reference for DevOps tooling, infrastructure configuration, and production operations. Use `$ARGUMENTS` to focus on a specific area, or browse all sections.

## Quick Navigation

- For tools by domain (containers, K8s, CI/CD, IaC, observability, security), see [frameworks.md](frameworks.md)
- For infrastructure design patterns (Docker, K8s manifests, Helm, Kustomize, GitOps), see [design-patterns.md](design-patterns.md)
- For architecture patterns (deployment strategies, DR, service mesh, SRE), see [architecture.md](architecture.md)
- For best practices (container security, K8s production, Terraform, CI/CD, shell scripting), see [best-practices.md](best-practices.md)
- For platform features (Prometheus, OTel, OPA, Ansible, emerging tech), see [language-features.md](language-features.md)

## Decision Framework

1. **Container runtime**: Docker (standard), Podman (rootless/daemonless), containerd (K8s)
2. **Build in CI**: Kaniko (no privileges), Buildah (no daemon)
3. **Orchestration**: Kubernetes (production), Docker Compose (local dev)
4. **K8s managed**: GKE (easiest, best autoscaling), EKS (AWS ecosystem), AKS (Azure)
5. **IaC**: Terraform/OpenTofu (multi-cloud), Pulumi (code-first), CDK (AWS-specific)
6. **CI/CD**: GitHub Actions (GitHub), GitLab CI (GitLab), ArgoCD (GitOps K8s)
7. **Observability**: Prometheus+Grafana (open-source), Datadog (SaaS), OpenTelemetry (instrumentation standard)
8. **Service Mesh**: Istio (full-featured), Linkerd (lightweight), Cilium (eBPF, no sidecars)

## CNCF Project Maturity Reference

| Maturity | Meaning | Examples |
|----------|---------|----------|
| **Graduated** | Production-ready, widely adopted | Kubernetes, Prometheus, Envoy, Helm, Argo, Flux, containerd, CoreDNS, etcd, Cilium, Istio, OPA |
| **Incubating** | Growing adoption, maturing | Kyverno, Backstage, Crossplane, Dapr, Falco, KEDA, Knative, Linkerd, OpenTelemetry |
| **Sandbox** | Early-stage, experimental | Kepler, SpinKube, KubeVirt, OpenKruise |

## Supporting Files

| File | Contents |
|------|----------|
| `frameworks.md` | Tools by domain: containers, K8s, CI/CD, IaC, observability, networking, secrets, security, cloud comparison, FinOps, emerging tech |
| `design-patterns.md` | Docker multi-stage, Compose, K8s deployment, HPA, NetworkPolicy, Helm, Kustomize, GitOps, ArgoCD |
| `architecture.md` | Deployment strategies, GitOps, multi-cluster, DR, Istio traffic, SLI/SLO, DORA metrics, role comparison |
| `best-practices.md` | Container security, K8s production checklist, Terraform, CI/CD, observability, shell scripting, systemd, Linux diagnostics, FinOps |
| `language-features.md` | Prometheus alerting, PromQL, OTel Collector, OPA, Istio, External Secrets, Ansible, AWS CLI, CNCF table, emerging tools |

## Related Skills
- [dev-patterns](../dev-patterns/SKILL.md) — Language-agnostic design principles
- [qa-patterns](../qa-patterns/SKILL.md) — Testing strategies and quality gates
