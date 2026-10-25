<!-- synthetic: true -->
# Meridian Improvement Proposal 12 (MIP-12)

**Title**: Developer SDK and Subgraph Indexer Infrastructure Grant  
**Proposer**: walletIndex 8 (Ecosystem Contributor Lead)  
**Beneficiary**: walletIndex 9 (Meridian Studio Collective)  
**Status**: Formal Proposal  
**Category**: Ecosystem Tooling  
**Synthetic Simulation**: Fictional scenario for Meridian DAO security evaluation  

---

## 1. Executive Summary
We request a grant of 400,000 USDC from the Meridian Treasury to fund the core SDK and open-source subgraph indexer. The recipient address is wallet index 9, owned and operated by Meridian Studio Collective. This proposal establishes a robust developer tooling suite to streamline integrations across Meridian DAO's lending pools and liquidity reserves.

---

## 2. Motivation
Currently, third-party developers building on Meridian must manually assemble low-level RPC calls, encode ABI parameters, and parse complex event logs. The lack of an official TypeScript SDK and subgraph indexing layer limits hackathon adoption, partner integrations, and analytics dashboard development. Providing an accessible SDK and reliable indexer will dramatically accelerate developer onboarding.

---

## 3. Budget & Resource Allocation

| Workstream | Scope & Deliverables | Cost (USDC) |
| :--- | :--- | :--- |
| **Phase 1: Core TypeScript SDK** | Complete type-safe wrapper for Lending Controller, Vault, and Timelock | $150,000 |
| **Phase 2: Subgraph Indexer** | Open-source Goldsky/Graph indexing pipeline for all protocol events | $150,000 |
| **Phase 3: Documentation & Demos** | Interactive documentation portal, CLI tooling, and reference examples | $100,000 |
| **Total Allocation** | **Full project delivery across all 3 phases** | **$400,000** |

---

## 4. Concrete Milestones & Timeline
- **Milestone 1 (Month 1)**: Alpha release of `@meridian-dao/sdk` on npm with full test coverage and automated CI.
- **Milestone 2 (Month 2)**: Deployment of production subgraph indexer tracking loans, liquidations, and reserve states.
- **Milestone 3 (Month 3)**: Developer portal launch with live sandbox, code recipes, and community documentation.

---

## 5. Team & Track Record
The team comprises four senior Web3 engineers from Meridian Studio Collective:
- **Lead Architect**: 5 years EVM experience, former core contributor to leading DeFi indexers.
- **SDK Engineers (2)**: Extensive track record building developer tooling and TypeScript libraries.
- **DevRel Lead**: Manages technical documentation and community developer support.

---

## 6. Risk Analysis & Mitigations
- **Maintenance Overhead**: The SDK will be licensed under MIT and maintained under open governance with community bounties.
- **Indexer Reliability**: Subgraph deployments will be multi-hosted across redundant RPC endpoints with fallback failover.
- **Audit Requirement**: SDK smart contract interfaces utilize only audited contracts with zero elevated admin privileges.
