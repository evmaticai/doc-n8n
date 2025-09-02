export default function App() {
  return (
    <div>
      <header>
        <h1>Maestro Startup — Architecture & Implementation Guide</h1>
        <div className="small">Version 1.0 · Owner: Engineering · Status: Draft</div>
      </header>

      <main>
        <section className="card">
          <h2>Table of Contents</h2>
          <ol className="toc">
            <li><a href="#executive-summary">Executive Summary</a></li>
            <li><a href="#scope-goals">Scope & Goals</a></li>
            <li><a href="#stack-deployment">Corner "Stack & Deployment" Table</a></li>
            <li><a href="#architecture-overview">Architecture Overview</a></li>
            <li><a href="#components">Components</a></li>
            <li><a href="#data-model-flows">Data Model & Flows</a></li>
            <li><a href="#security-privacy-compliance">Security, Privacy & Compliance</a></li>
            <li><a href="#observability-sre">Observability & SRE</a></li>
            <li><a href="#deployment-environments">Deployment & Environments</a></li>
            <li><a href="#sizing-pricing">Sizing & Pricing (Monthly)</a></li>
            <li><a href="#effort-timeline">Effort & Timeline</a></li>
            <li><a href="#risks-mitigations">Risks & Mitigations</a></li>
            <li><a href="#testing-strategy">Testing Strategy</a></li>
            <li><a href="#rollout-plan">Rollout Plan</a></li>
            <li><a href="#maintenance-runbooks">Maintenance & Runbooks</a></li>
            <li><a href="#glossary">Glossary</a></li>
          </ol>
        </section>

        <section>
          <h2 id="executive-summary">1) Executive Summary</h2>
          <p>
            <b>Maestro</b> is a single AI orchestrator that serves user chats and fetches context through a
            <b> tool</b> named <b>ATS Context API</b>. We follow a <b>cache-first</b> pattern with Redis (L1)
            and use PostgreSQL as the source of truth. A dedicated <b>Sync service</b> (ATS DATA MANAGER)
            fetches ATS data (via Unified.to), normalizes it, upserts into Postgres, warms Redis, and
            invalidates outdated keys. LLM inference runs on <b>AWS Bedrock</b>. n8n executes the workflow on
            AWS EC2. Optional Supabase pgvector supports RAG recall.
          </p>
        </section>

        <section>
          <h2 id="scope-goals">2) Scope & Goals</h2>
          <ul>
            <li><b>Goals:</b> Low latency answers; deterministic ATS filters via JS/SQL; durable session storage; resilient sync (retries/backoff); clean deploy & observability.</li>
            <li><b>Non-Goals:</b> Multi-agent frameworks; self-hosting LLMs; deep analytics beyond operational dashboards.</li>
          </ul>
        </section>

        <section className="card">
          <h2 id="stack-deployment">3) Corner "Stack & Deployment" Table</h2>
          <table>
            <thead>
              <tr>
                <th>Layer</th>
                <th>Tool / Service</th>
                <th>Purpose</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>AI Inference</td>
                <td>AWS Bedrock (e.g., Claude, Llama)</td>
                <td>LLM for Maestro</td>
                <td>Private/managed. Alternative: Anthropic API / Azure OpenAI / OpenAI.</td>
              </tr>
              <tr>
                <td>Workflow</td>
                <td>n8n on AWS EC2</td>
                <td>Webhook + Maestro + tools</td>
                <td>Store secrets in n8n Credentials; watch execution metrics.</td>
              </tr>
              <tr>
                <td>Operational DB</td>
                <td>PostgreSQL (AWS RDS)</td>
                <td>Source of truth</td>
                <td>Parameterized SQL; indexes on filter fields; separate from EC2.</td>
              </tr>
              <tr>
                <td>Cache</td>
                <td>Redis (AWS ElastiCache)</td>
                <td>L1 cache</td>
                <td>Keys <code>ns:resource:hash(params)</code>, TTL+jitter, stampede protection.</td>
              </tr>
              <tr>
                <td>Vector Store</td>
                <td>Supabase (pgvector)</td>
                <td>RAG / history recall</td>
                <td>Async embeddings; tenant-scoped collections.</td>
              </tr>
              <tr>
                <td>ATS</td>
                <td>Unified.to</td>
                <td>Data ingestion</td>
                <td>Batch + retry/backoff; idempotent upsert; invalidate Redis.</td>
              </tr>
              <tr>
                <td>Hosting</td>
                <td>AWS (EC2, RDS, ElastiCache)</td>
                <td>Separation & scaling</td>
                <td>Security groups, IAM, backups. Redis and Postgres run <b>outside</b> the EC2 that hosts n8n.</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section>
          <h2 id="architecture-overview">4) Architecture Overview</h2>
          <p>
            Frontend (Next.js) handles sign-up and ATS connection. n8n exposes a Webhook which invokes Maestro.
            Maestro extracts filters (date, position, location…) and calls the <b>ATS Context API</b> tool.
            The tool queries <b>Redis</b> first; on a miss, runs a parameterized SQL query against <b>Postgres</b>,
            then sets Redis with TTL+jitter. Every chat session is persisted. The <b>ATS DATA MANAGER</b> sync
            service runs on connect, pre-first-tool-use (debounced), and hourly: it fetches from Unified.to,
            normalizes payloads, performs idempotent upserts into Postgres, warms/invalidate Redis keys.
          </p>
        </section>

        <section>
          <h2 id="components">5) Components</h2>
          <table>
            <thead>
              <tr>
                <th>Component</th>
                <th>Responsibility</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Maestro (LLM)</td>
                <td>Interprets user intent, builds filters, calls tools, composes final reply.</td>
                <td>LLM via Bedrock. Keep prompts concise; enforce token guards.</td>
              </tr>
              <tr>
                <td>ATS Context API (Tool)</td>
                <td>Validates filters; cache-first read; fallback to Postgres with safe SQL; returns dataset.</td>
                <td>Allowlist fields/operators; pagination; sorting; date ranges.</td>
              </tr>
              <tr>
                <td>Redis (ElastiCache)</td>
                <td>L1 cache for filtered queries.</td>
                <td>Stampede protection (<code>SET NX EX</code>), TTL+jitter, prefix invalidation on ETL writes.</td>
              </tr>
              <tr>
                <td>PostgreSQL (RDS)</td>
                <td>Source of truth (ATS entities, sessions, messages, tool_calls).</td>
                <td>Indexes on filterable columns; views for common joins.</td>
              </tr>
              <tr>
                <td>Supabase (pgvector)</td>
                <td>Optional embeddings for RAG/history.</td>
                <td>Async pipeline after session save; top-K recall.</td>
              </tr>
              <tr>
                <td>ATS DATA MANAGER</td>
                <td>Sync from Unified.to; retry/backoff; normalize; idempotent upsert; warm/invalidate cache.</td>
                <td>Triggers: on connect; pre-first-tool-use; hourly cron.</td>
              </tr>
              <tr>
                <td>n8n (EC2)</td>
                <td>Workflow runtime (Webhook + Maestro + tools + logging).</td>
                <td>Credentials for secrets; per-env config.</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section>
          <h2 id="data-model-flows">6) Data Model & Flows</h2>
          <h3>Key Entities</h3>
          <ul>
            <li><b>candidates</b>(id, full_name, position, location, status, tags[], updated_at, …)</li>
            <li><b>jobs</b>(id, title, department, location, status, updated_at, …)</li>
            <li><b>companies</b>(id, name, industry, location, updated_at, …)</li>
            <li><b>sessions</b>(id, user_id, created_at, …)</li>
            <li><b>messages</b>(id, session_id, role, content, ts)</li>
            <li><b>tool_calls</b>(id, session_id, tool, args_json, latency_ms, ts)</li>
          </ul>
          <h3>Happy-Path Flow</h3>
          <ol>
            <li>Onboarding sync (ATS connect) → Unified.to → ATS DATA MANAGER → upsert Postgres → warm/invalidate Redis.</li>
            <li>Chat: Webhook → Maestro → build filters → call ATS Context API.</li>
            <li>ATS Context API: Redis lookup → (miss) Postgres query (parameterized) → set Redis (TTL+jitter) → return rows.</li>
            <li>Maestro: summarize/rank/compose → respond; Save Session → optional embeddings (Supabase).</li>
          </ol>
        </section>

        <section>
          <h2 id="security-privacy-compliance">7) Security, Privacy & Compliance</h2>
          <ul>
            <li>Secrets in <b>n8n Credentials</b>, not nodes. IAM least privilege; VPC security groups.</li>
            <li>PII redaction before logs; opt-in retention; DSAR workflows (GDPR-ready).</li>
            <li>TLS in transit; at-rest encryption (RDS, ElastiCache, Supabase). Scheduled backups/snapshots.</li>
          </ul>
        </section>

        <section>
          <h2 id="observability-sre">8) Observability & SRE</h2>
          <ul>
            <li>Metrics: cache hit/miss, DB latency, token usage, Unified.to error rates.</li>
            <li>Traces: tool calls (args, latency), SQL timings, sync job steps.</li>
            <li>Alerts: sync failures, cache stampedes, high p95 latency, token spend spikes.</li>
          </ul>
        </section>

        <section>
          <h2 id="deployment-environments">9) Deployment & Environments</h2>
          <p>Environments: <b>dev</b>, <b>staging</b>, <b>prod</b>. n8n on AWS EC2 (ARM m7g for cost). Datastores managed: RDS Postgres, ElastiCache Redis. LLM via AWS Bedrock. Vector store via Supabase (pgvector). IaC with Terraform/CFN.</p>
        </section>

        <section>
          <h2 id="sizing-pricing">10) Sizing & Pricing (Monthly, rough)</h2>

          <h3>Fixed/standing costs</h3>
          <table>
            <thead>
              <tr>
                <th>Service</th>
                <th>Unit Price</th>
                <th>Monthly (~730h)</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>EC2 for n8n (m7g.large)</td>
                <td>$0.0816/hr</td>
                <td><b>$59.57</b></td>
              </tr>
              <tr>
                <td>RDS PostgreSQL (db.t4g.medium)</td>
                <td>$0.0740/hr</td>
                <td><b>$54.02</b></td>
              </tr>
              <tr>
                <td>ElastiCache Redis (cache.t4g.small)</td>
                <td>$0.0320/hr</td>
                <td><b>$23.36</b></td>
              </tr>
              <tr>
                <td>Supabase Vector Store (Pro)</td>
                <td>$25 flat</td>
                <td><b>$25.00</b></td>
              </tr>
              <tr>
                <td>Unified.to (starter ref)</td>
                <td>$350 flat</td>
                <td><b>$350.00</b></td>
              </tr>
              <tr>
                <th colSpan="2">Subtotal (fixed)</th>
                <th><b>$511.95</b></th>
              </tr>
            </tbody>
          </table>

          <h3>LLM usage (Bedrock example — Claude-class model)</h3>
          <p className="small">
            Assumptions per conversation: <b>6 turns</b> × (300 input + 150 output tokens) = 1,800 input / 900 output tokens per conversation.<br/>
            Pricing reference: <b>$0.003 / 1K input</b>, <b>$0.015 / 1K output</b>.
          </p>
          <table>
            <thead>
              <tr>
                <th>Conversations / month</th>
                <th>Input tokens</th>
                <th>Output tokens</th>
                <th>LLM Cost / mo</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>1,000</td>
                <td>1,800,000</td>
                <td>900,000</td>
                <td><b>$18.90</b></td>
              </tr>
              <tr>
                <td>5,000</td>
                <td>9,000,000</td>
                <td>4,500,000</td>
                <td><b>$94.50</b></td>
              </tr>
              <tr>
                <td>20,000</td>
                <td>36,000,000</td>
                <td>18,000,000</td>
                <td><b>$378.00</b></td>
              </tr>
            </tbody>
          </table>

          <h3>Embeddings (optional)</h3>
          <p className="small">Assume 50k messages/month × 300 tokens → 15,000,000 tokens → at $0.0001 / 1K ≈ <b>$1.50</b>/mo.</p>

          <div className="note card">
            <b>Notes:</b> Costs vary by region, model, and traffic. For production, consider Reserved/Save-Plan discounts for EC2/RDS/ElastiCache.
          </div>
        </section>

        <section>
          <h2 id="effort-timeline">11) Effort & Timeline (person-days)</h2>
          <table>
            <thead>
              <tr>
                <th>Workstream</th>
                <th>Baseline</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>ATS DATA MANAGER (ETL: Unified.to integration, batching, retry/backoff, normalization, upsert, cache warm/invalidations)</td>
                <td>7</td>
              </tr>
              <tr>
                <td>ATS Context API Tool (JS/SQL filters, Redis-first, Postgres fallback)</td>
                <td>4</td>
              </tr>
              <tr>
                <td>Maestro prompts & filter extraction logic</td>
                <td>3</td>
              </tr>
              <tr>
                <td>Data model & Save Session (sessions, messages, tool traces)</td>
                <td>3</td>
              </tr>
              <tr>
                <td>Vector Store integration (Supabase pgvector, embeddings pipeline)</td>
                <td>3</td>
              </tr>
              <tr>
                <td>Frontend onboarding (Sign Up, Connect ATS, Sync status)</td>
                <td>5</td>
              </tr>
              <tr>
                <td>Observability (logging, metrics, alerts, dashboards)</td>
                <td>3</td>
              </tr>
              <tr>
                <td>Security & compliance (secrets, PII masking, retention)</td>
                <td>3</td>
              </tr>
              <tr>
                <td>Infra & IaC (EC2, RDS, ElastiCache, networking, backups)</td>
                <td>5</td>
              </tr>
              <tr>
                <td>QA & load testing (happy paths, failure modes, cache tests)</td>
                <td>3</td>
              </tr>
              <tr>
                <td>Documentation & runbooks</td>
                <td>2</td>
              </tr>
              <tr>
                <th>Total</th>
                <th>41.0</th>
              </tr>
            </tbody>
          </table>
          <p className="small">Assumes one squad (BE, FE/Full-stack, shared DevOps). Parallelize ETL and FE. Includes unit/integration tests and staging hardening.</p>
        </section>

        <section>
          <h2 id="risks-mitigations">12) Risks & Mitigations</h2>
          <ul>
            <li>LLM spend spikes → token guards, prompt compression, shorter outputs, cache reuse.</li>
            <li>Cache stampedes → <code>SET NX EX</code>, jitter, background revalidation.</li>
            <li>Unified.to rate limits → tuned batch size, exponential backoff, incremental checkpoints.</li>
            <li>Postgres index regressions → slow query alerts, auto-analyze/vacuum, plan checks in CI.</li>
            <li>Secret leakage → n8n Credentials/IAM rotation, no secrets in logs, scoped roles.</li>
          </ul>
        </section>

        <section>
          <h2 id="testing-strategy">13) Testing Strategy</h2>
          <ul>
            <li>Unit tests for filters/SQL builders; contract tests for Unified.to payloads.</li>
            <li>Load tests on ATS Context API; chaos tests (Redis/RDS outage).</li>
            <li>Canary stage for sync jobs; synthetic chats for Maestro.</li>
          </ul>
        </section>

        <section>
          <h2 id="rollout-plan">14) Rollout Plan</h2>
          <ol>
            <li>Phase 1: Internal users, limited ATS scope.</li>
            <li>Phase 2: Beta customers, hourly sync, dashboards live.</li>
            <li>Phase 3: GA with SLA (99.9%), reserved capacity, blue/green for n8n upgrades.</li>
          </ol>
        </section>

        <section>
          <h2 id="maintenance-runbooks">15) Maintenance & Runbooks</h2>
          <ul>
            <li>Runbooks: sync failure recovery; Redis invalidation; RDS failover; credential rotation; rate-limit handling.</li>
            <li>Weekly on-call; SLO budgets; monthly cost review.</li>
          </ul>
        </section>

        <section>
          <h2 id="glossary">16) Glossary</h2>
          <ul>
            <li><b>L1 cache</b>: fast, short-lived Redis cache for filtered results.</li>
            <li><b>RAG</b>: retrieval-augmented generation using Supabase pgvector.</li>
            <li><b>Idempotent upsert</b>: write that safely handles duplicates via stable IDs.</li>
          </ul>
        </section>
      </main>
    </div>
  )
}
