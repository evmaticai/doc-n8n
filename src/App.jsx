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
            <li><a href="#architecture-diagram">Architecture Diagram</a></li>
            <li><a href="#api-specifications">API Specifications</a></li>
            <li><a href="#performance-requirements">Performance Requirements</a></li>
            <li><a href="#disaster-recovery">Disaster Recovery</a></li>
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
                <td>LLM Cache</td>
                <td>Redis (lmCache) + Smart Keys</td>
                <td>Cache LLM responses</td>
                <td>Hash(prompt + context) keys; TTL 24h; 70-90% hit rate expected; significant cost savings.</td>
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
            Maestro checks <b>lmCache</b> for similar prompts first; on cache miss, calls <b>AWS Bedrock</b> and caches the response.
            It extracts filters (date, position, location…) and calls the <b>ATS Context API</b> tool.
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
                <td>LLM via Bedrock + lmCache. Keep prompts concise; enforce token guards.</td>
              </tr>
              <tr>
                <td>lmCache (LLM Cache)</td>
                <td>Caches LLM responses to reduce API calls and improve latency.</td>
                <td>Redis-based; hash(prompt+context) keys; 24h TTL; invalidate on model updates.</td>
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
            <li><b>lmCache (Redis)</b>: key=hash(prompt+context), value=&#123;response, tokens, model, ttl&#125;</li>
          </ul>
          <h3>Happy-Path Flow</h3>
          <ol>
            <li>Onboarding sync (ATS connect) → Unified.to → ATS DATA MANAGER → upsert Postgres → warm/invalidate Redis.</li>
            <li>Chat: Webhook → Maestro → lmCache lookup → (miss) AWS Bedrock → cache LLM response.</li>
            <li>Maestro: build filters → call ATS Context API.</li>
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
            <li>Metrics: ATS cache hit/miss, lmCache hit/miss, DB latency, token usage, Unified.to error rates.</li>
            <li>Traces: tool calls (args, latency), LLM cache lookups, SQL timings, sync job steps.</li>
            <li>Alerts: sync failures, cache stampedes, lmCache hit rate drops, high p95 latency, token spend spikes.</li>
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
            Pricing reference: <b>$0.003 / 1K input</b>, <b>$0.015 / 1K output</b>.<br/>
            <b>lmCache impact:</b> Expected 70-80% cache hit rate reduces actual LLM API calls by ~75%.
          </p>
          <table>
            <thead>
              <tr>
                <th>Conversations / month</th>
                <th>Input tokens</th>
                <th>Output tokens</th>
                <th>Without lmCache</th>
                <th>With lmCache (75% savings)</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>1,000</td>
                <td>1,800,000</td>
                <td>900,000</td>
                <td><b>$18.90</b></td>
                <td><b>$4.73</b></td>
              </tr>
              <tr>
                <td>5,000</td>
                <td>9,000,000</td>
                <td>4,500,000</td>
                <td><b>$94.50</b></td>
                <td><b>$23.63</b></td>
              </tr>
              <tr>
                <td>20,000</td>
                <td>36,000,000</td>
                <td>18,000,000</td>
                <td><b>$378.00</b></td>
                <td><b>$94.50</b></td>
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

        <section>
          <h2 id="architecture-diagram">17) Architecture Diagram</h2>
          <p>
            The following diagram illustrates the complete system architecture, showing the flow from user interaction 
            through the various components including the frontend, Maestro orchestrator, caching layers, and sync processes.
          </p>
          <div className="note card">
            <p>
              <b>📐 Editable Diagram Source:</b> The original architecture diagram is available as a Draw.io file: 
              <code>n8n_arch_with_deploy_and_corner_table.drawio</code>
            </p>
            <p>
              <b>How to edit:</b> Open the .drawio file in <a href="https://app.diagrams.net/" target="_blank" rel="noopener noreferrer">
              diagrams.net (Draw.io)</a> to modify the architecture diagram, add new components, or update the visual flow.
            </p>
            <p className="small">
              The diagram below is a text-based representation of the Draw.io source for easy reading and navigation within this documentation.
            </p>
          </div>
          <div className="card">
            <h3>System Architecture Flow</h3>
            <div style={{fontFamily: 'monospace', fontSize: '14px', lineHeight: '1.8', background: '#f8f9fa', padding: '16px', borderRadius: '6px', overflow: 'auto'}}>
              <div><b>🚀 User Journey:</b></div>
              <div>App Startup → Next.js Frontend (Sign Up & Connect ATS) → Initial Sync (15s-5min)</div>
              <br/>
              
              <div><b>💬 Chat Request Flow:</b></div>
              <div>Frontend → Webhook Ingestion → Maestro Agent → ATS Context API Tool</div>
              <div>├─ Maestro → lmCache (check for cached LLM response)</div>
              <div>├─ Maestro ↔ AWS Bedrock (on cache miss) → lmCache (store response)</div>
              <div>├─ ATS Tool → Redis Cache (L1 lookup)</div>
              <div>├─ ATS Tool → PostgreSQL (fallback query)</div>
              <div>└─ PostgreSQL → Redis (set cache with TTL)</div>
              <br/>
              
              <div><b>💾 Data Persistence:</b></div>
              <div>Maestro → Save Session (Postgres) → Supabase Vector Store (async embeddings)</div>
              <br/>
              
              <div><b>🔄 Background Sync:</b></div>
              <div>External Connectors (Unified.to/ATS APIs) → ATS DATA MANAGER</div>
              <div>├─ Fetch with batching + retry/backoff</div>
              <div>├─ Normalize & validate payloads</div>
              <div>├─ Idempotent upsert → PostgreSQL</div>
              <div>├─ Warm Redis cache (popular queries)</div>
              <div>└─ Invalidate affected keys on updates</div>
              <br/>
              
              <div><b>📊 Cross-Cutting Concerns:</b></div>
              <div>🔍 Logging & Monitoring (tool calls, cache metrics, latency alerts)</div>
              <div>🔒 Security & Governance (n8n Credentials, PII masking, retention)</div>
            </div>
          </div>

          <div className="card">
            <h3>Component Interactions</h3>
            <table>
              <thead>
                <tr>
                  <th>From</th>
                  <th>To</th>
                  <th>Interaction</th>
                  <th>Type</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Frontend</td>
                  <td>Webhook</td>
                  <td>Chat request</td>
                  <td>HTTP POST</td>
                </tr>
                <tr>
                  <td>Maestro</td>
                  <td>lmCache</td>
                  <td>Check cached LLM response</td>
                  <td>Cache lookup first</td>
                </tr>
                <tr>
                  <td>Maestro</td>
                  <td>AWS Bedrock</td>
                  <td>LLM prompts</td>
                  <td>On cache miss</td>
                </tr>
                <tr>
                  <td>AWS Bedrock</td>
                  <td>lmCache</td>
                  <td>Store LLM response</td>
                  <td>Cache write</td>
                </tr>
                <tr>
                  <td>ATS Tool</td>
                  <td>Redis</td>
                  <td>Cache lookup first</td>
                  <td>Primary</td>
                </tr>
                <tr>
                  <td>ATS Tool</td>
                  <td>PostgreSQL</td>
                  <td>Fallback query</td>
                  <td>On cache miss</td>
                </tr>
                <tr>
                  <td>Sync Manager</td>
                  <td>PostgreSQL</td>
                  <td>Idempotent upsert</td>
                  <td>Batch writes</td>
                </tr>
                <tr>
                  <td>Sync Manager</td>
                  <td>Redis</td>
                  <td>Warm & invalidate</td>
                  <td>Cache management</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="small">
            <b>Key Flow:</b> User interaction → Frontend → Webhook → Maestro → ATS Context API → Cache/DB layers. 
            The ATS DATA MANAGER synchronizes external data and maintains cache consistency.
          </p>
        </section>

        <section>
          <h2 id="api-specifications">18) API Specifications</h2>
          
          <h3>Core API Endpoints</h3>
          <div className="card">
            <table>
              <thead>
                <tr>
                  <th>Endpoint</th>
                  <th>Method</th>
                  <th>Purpose</th>
                  <th>Request Schema</th>
                  <th>Response Schema</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><code>/webhook/chat</code></td>
                  <td>POST</td>
                  <td>Process user chat messages</td>
                  <td><code>{`{"user_id", "message", "session_id?"}`}</code></td>
                  <td><code>{`{"response", "session_id", "tool_calls[]"}`}</code></td>
                </tr>
                <tr>
                  <td><code>/api/ats-context</code></td>
                  <td>POST</td>
                  <td>Query ATS data with filters</td>
                  <td><code>{`{"filters": {}, "pagination": {}, "sort": {}}`}</code></td>
                  <td><code>{`{"data[]", "total", "cached", "query_ms"}`}</code></td>
                </tr>
                <tr>
                  <td><code>/admin/sync</code></td>
                  <td>POST</td>
                  <td>Trigger manual ATS sync</td>
                  <td><code>{`{"tenant_id", "full_sync": boolean}`}</code></td>
                  <td><code>{`{"job_id", "status", "estimated_duration"}`}</code></td>
                </tr>
                <tr>
                  <td><code>/health</code></td>
                  <td>GET</td>
                  <td>System health check</td>
                  <td>-</td>
                  <td><code>{`{"status", "services": {}, "version"}`}</code></td>
                </tr>
              </tbody>
            </table>
          </div>

          <h3>ATS Context API Filter Schema</h3>
          <div className="card">
            <div style={{fontFamily: 'monospace', fontSize: '14px', background: '#f8f9fa', padding: '16px', borderRadius: '6px'}}>
              <div><b>Supported Filter Operations:</b></div>
              <div>• <code>eq</code> (equals), <code>ne</code> (not equals)</div>
              <div>• <code>in</code> (in array), <code>nin</code> (not in array)</div>
              <div>• <code>gt</code>, <code>gte</code>, <code>lt</code>, <code>lte</code> (comparisons)</div>
              <div>• <code>like</code> (pattern matching), <code>ilike</code> (case-insensitive)</div>
              <div>• <code>between</code> (range queries for dates/numbers)</div>
              <br/>
              <div><b>Example Filter:</b></div>
              <div>{`{
  "position": {"like": "%engineer%"},
  "location": {"in": ["NYC", "SF", "Remote"]},
  "updated_at": {"gte": "2024-01-01"},
  "status": {"eq": "active"},
  "salary_range": {"between": [80000, 150000]}
}`}</div>
            </div>
          </div>

          <h3>Error Response Format</h3>
          <div className="card">
            <div style={{fontFamily: 'monospace', fontSize: '14px', background: '#f8f9fa', padding: '16px', borderRadius: '6px'}}>
              <div>{`{
  "error": {
    "code": "INVALID_FILTER",
    "message": "Unsupported operator 'regex' for field 'position'",
    "details": {
      "field": "position",
      "operator": "regex",
      "allowed_operators": ["eq", "like", "ilike"]
    },
    "request_id": "req_123456789"
  }
}`}</div>
            </div>
          </div>
        </section>

        <section>
          <h2 id="performance-requirements">19) Performance Requirements</h2>
          
          <h3>Service Level Objectives (SLOs)</h3>
          <div className="card">
            <table>
              <thead>
                <tr>
                  <th>Metric</th>
                  <th>Target (P95)</th>
                  <th>Target (P99)</th>
                  <th>Error Budget</th>
                  <th>Measurement</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Chat Response Latency</td>
                  <td>&lt; 3s</td>
                  <td>&lt; 8s</td>
                  <td>99.5% availability</td>
                  <td>End-to-end response time</td>
                </tr>
                <tr>
                  <td>ATS Context API</td>
                  <td>&lt; 500ms</td>
                  <td>&lt; 1s</td>
                  <td>99.9% availability</td>
                  <td>Cache hit: &lt;50ms, DB query: &lt;500ms</td>
                </tr>
                <tr>
                  <td>ATS Cache Hit Rate</td>
                  <td>&gt; 80%</td>
                  <td>&gt; 85%</td>
                  <td>N/A</td>
                  <td>Redis hits / total requests</td>
                </tr>
                <tr>
                  <td>LLM Cache Hit Rate (lmCache)</td>
                  <td>&gt; 70%</td>
                  <td>&gt; 80%</td>
                  <td>N/A</td>
                  <td>Cached LLM responses / total LLM requests</td>
                </tr>
                <tr>
                  <td>Sync Job Success</td>
                  <td>&gt; 95%</td>
                  <td>&gt; 98%</td>
                  <td>Max 2 failures/day</td>
                  <td>Successful syncs / total attempts</td>
                </tr>
                <tr>
                  <td>Token Cost Efficiency</td>
                  <td>&lt; $0.05/conversation</td>
                  <td>&lt; $0.10/conversation</td>
                  <td>N/A</td>
                  <td>Monthly token spend / conversations</td>
                </tr>
              </tbody>
            </table>
          </div>

          <h3>Scaling Triggers & Capacity Planning</h3>
          <div className="card">
            <table>
              <thead>
                <tr>
                  <th>Component</th>
                  <th>Scale-Out Trigger</th>
                  <th>Scale-Up Strategy</th>
                  <th>Max Capacity</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>n8n EC2</td>
                  <td>CPU &gt; 70% for 5min</td>
                  <td>Upgrade to m7g.xlarge</td>
                  <td>m7g.2xlarge (8 vCPU)</td>
                </tr>
                <tr>
                  <td>Redis Cache</td>
                  <td>Memory &gt; 80%</td>
                  <td>cache.t4g.medium → large</td>
                  <td>cache.r7g.xlarge (26GB)</td>
                </tr>
                <tr>
                  <td>PostgreSQL RDS</td>
                  <td>Connections &gt; 80 or CPU &gt; 80%</td>
                  <td>db.t4g.large → xlarge</td>
                  <td>db.r6g.xlarge + read replicas</td>
                </tr>
                <tr>
                  <td>LLM API</td>
                  <td>Rate limit warnings</td>
                  <td>Request queuing + circuit breaker</td>
                  <td>AWS Bedrock auto-scales</td>
                </tr>
              </tbody>
            </table>
          </div>

          <h3>Growth Projections</h3>
          <div className="card">
            <ul>
              <li><b>Month 1-3:</b> 100-500 conversations/day, single-tenant focus</li>
              <li><b>Month 4-6:</b> 1K-5K conversations/day, 5-10 enterprise customers</li>
              <li><b>Month 7-12:</b> 10K-50K conversations/day, multi-tenant scaling</li>
              <li><b>Year 2+:</b> 100K+ conversations/day, geographic distribution</li>
            </ul>
            <p className="small">
              <b>Capacity Planning:</b> Current architecture supports up to 50K conversations/day before requiring horizontal scaling (multiple n8n instances, connection pooling).
            </p>
          </div>
        </section>

        <section>
          <h2 id="disaster-recovery">20) Disaster Recovery</h2>
          
          <h3>Backup Strategy</h3>
          <div className="card">
            <table>
              <thead>
                <tr>
                  <th>Component</th>
                  <th>Backup Frequency</th>
                  <th>Retention</th>
                  <th>Recovery Method</th>
                  <th>RTO Target</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>PostgreSQL RDS</td>
                  <td>Continuous + Daily snapshots</td>
                  <td>35 days</td>
                  <td>Point-in-time restore</td>
                  <td>&lt; 1 hour</td>
                </tr>
                <tr>
                  <td>Redis ElastiCache</td>
                  <td>Daily snapshots</td>
                  <td>7 days</td>
                  <td>Cluster restore + cache warm</td>
                  <td>&lt; 30 minutes</td>
                </tr>
                <tr>
                  <td>n8n Workflows</td>
                  <td>Git commits + weekly export</td>
                  <td>Indefinite (Git)</td>
                  <td>Import workflows + credentials</td>
                  <td>&lt; 15 minutes</td>
                </tr>
                <tr>
                  <td>Supabase Vector Store</td>
                  <td>Daily automated backups</td>
                  <td>30 days</td>
                  <td>Database restore</td>
                  <td>&lt; 2 hours</td>
                </tr>
              </tbody>
            </table>
          </div>

          <h3>Failure Scenarios & Response</h3>
          <div className="card">
            <div style={{fontFamily: 'monospace', fontSize: '14px', lineHeight: '1.6'}}>
              <div><b>🔴 Critical Failures (RTO &lt; 1 hour):</b></div>
              <div>• EC2 instance failure → Auto-restart + health check alerts</div>
              <div>• RDS primary failure → Automated failover to standby (Multi-AZ)</div>
              <div>• Redis cluster failure → Restore from snapshot, accept cache-miss performance</div>
              <br/>
              
              <div><b>🟡 Degraded Performance (RTO &lt; 4 hours):</b></div>
              <div>• AWS Bedrock throttling → Circuit breaker, queue requests, notify users</div>
              <div>• Unified.to API down → Pause sync jobs, serve cached data, manual intervention</div>
              <div>• High latency (&gt;5s) → Scale resources, investigate bottlenecks</div>
              <br/>
              
              <div><b>🟢 Operational Issues (RTO &lt; 24 hours):</b></div>
              <div>• Supabase outage → Disable RAG features, normal operation continues</div>
              <div>• Cost spike alerts → Review usage, implement emergency limits</div>
              <div>• Data inconsistency → Run reconciliation scripts, manual data fixes</div>
            </div>
          </div>

          <h3>Recovery Procedures</h3>
          <div className="card">
            <h4>RDS Failover Runbook</h4>
            <div style={{fontFamily: 'monospace', fontSize: '13px', background: '#f8f9fa', padding: '12px', borderRadius: '4px'}}>
              <div>1. Monitor RDS failover in AWS Console</div>
              <div>2. Update DNS/connection strings if needed</div>
              <div>3. Verify application connectivity (health check)</div>
              <div>4. Clear Redis cache to prevent stale reads</div>
              <div>5. Monitor query performance for 2 hours</div>
              <div>6. Document incident timeline</div>
            </div>

            <h4>Complete System Recovery</h4>
            <div style={{fontFamily: 'monospace', fontSize: '13px', background: '#f8f9fa', padding: '12px', borderRadius: '4px'}}>
              <div>1. Deploy fresh EC2 + install n8n</div>
              <div>2. Restore PostgreSQL from latest snapshot</div>
              <div>3. Create new Redis cluster (accept empty cache)</div>
              <div>4. Import n8n workflows from Git backup</div>
              <div>5. Re-configure secrets and credentials</div>
              <div>6. Test webhook endpoint + sample chat</div>
              <div>7. Trigger full ATS sync job</div>
              <div>8. Monitor system for 24 hours</div>
            </div>
          </div>

          <h3>Business Continuity</h3>
          <div className="card">
            <p>
              <b>Maximum Tolerable Downtime:</b> 4 hours (business hours), 12 hours (off-hours)
            </p>
            <p>
              <b>Data Loss Tolerance:</b> Max 1 hour of conversations (RDS point-in-time recovery)
            </p>
            <p>
              <b>Communication Plan:</b> Slack alerts → Engineering → Customer Success → Status page updates
            </p>
            <div className="note">
              <b>Note:</b> During outages, frontend should display "System temporarily unavailable" with ETA updates. 
              Critical enterprise customers have dedicated Slack channels for real-time updates.
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}
