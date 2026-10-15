# ChatGPT Code Review as a Kawnix Agent

## A simple guide for publishers, clients, and non-technical readers

This document explains what has been built in the ChatGPT-CodeReview project,
how it works with Kawnix, how a client would use it, and what still needs to be
done before public release.

You do not need to understand programming to read this guide.

---

## 1. What this project does

This project reviews code changes in GitHub pull requests.

A pull request is a proposed change to a software project. It usually contains
new or changed files that someone wants to add to the main project.

The review service:

1. Receives a request to review a selected GitHub pull request.
2. Reads the changed files and code differences.
3. Sends the relevant code to Gemini for analysis.
4. Produces structured findings, such as possible bugs, risks, or improvements.
5. Returns the findings to the requester.
6. Can optionally publish the findings as a review on GitHub.

The project can now be used in two ways:

- As the existing GitHub App and GitHub Action.
- As a separate Kawnix agent.

The Kawnix work was added without changing the separate Kawnix repository.

---

## 2. What Kawnix does

Kawnix is the platform that discovers and calls agents.

In simple terms:

- The **publisher** makes an agent available.
- Kawnix lists the agent.
- A **client** finds and subscribes to the agent.
- Kawnix sends the client's request to the agent.
- The agent does the work and sends back the result.

ChatGPT-CodeReview is the agent provider. Kawnix is the system that connects
clients to the provider.

The provider does not receive a client's personal GitHub password or arbitrary
GitHub access token. Instead, the provider uses its own GitHub App and allows
only repositories that have been explicitly approved.

---

## 3. What existed before this work

Before the Kawnix implementation, the repository mainly supported:

- A GitHub App that reacts to GitHub events.
- A GitHub Action that can run code reviews.
- A Gemini integration that analyzes code.

There was also an early Kawnix prototype. That prototype could verify a signed
request and return a test response, but it was not a complete production review
service.

It did not yet provide all of the things Kawnix needs, such as:

- Durable background jobs.
- Client and repository authorization.
- Real GitHub App access.
- Structured review results.
- Retry and timeout handling.
- Safe publication to GitHub.
- Production deployment guidance.

The original GitHub App and GitHub Action behavior was preserved.

---

## 4. What has been added

### 4.1 A proper Kawnix provider endpoint

The public provider endpoint is:

```text
POST /api/kawnix/invoke
```

Kawnix sends requests to this endpoint using a bearer credential.

The endpoint supports three operations:

| Operation | Plain-language meaning |
|---|---|
| `health` | Ask whether the provider is configured and available |
| `start` | Start a new pull-request review |
| `status` | Check the progress or result of a review |

The production contract is documented in
[KAWNIX_MANIFEST.example.json](./KAWNIX_MANIFEST.example.json).

### 4.2 Background review jobs

Reviews can take longer than a normal web request. Therefore, the provider
does not keep Kawnix waiting while the review runs.

Instead:

1. Kawnix sends a `start` request.
2. The provider creates a job.
3. The provider immediately returns a job ID.
4. A worker processes the job in the background.
5. Kawnix asks for the status using the job ID.
6. The provider returns the result when it is ready.

This is similar to ordering a service and receiving a tracking number instead
of standing at the counter until the work is finished.

### 4.3 Durable storage

Production jobs are stored in PostgreSQL.

This means a server restart should not lose queued, running, completed, or
failed jobs.

An in-memory store is still available for local development and automated
tests. Production should use PostgreSQL.

### 4.4 Worker endpoint

The worker endpoint is:

```text
POST /api/kawnix/worker
```

It is not a client-facing endpoint. A scheduler or queue service calls it
regularly.

Each call claims and processes an available review job. The worker:

- Claims jobs safely.
- Prevents two workers from processing the same job.
- Checks repository permissions again before execution.
- Runs the GitHub and Gemini review.
- Saves success or failure.
- Retries temporary failures when appropriate.

### 4.5 Maintenance endpoint

The maintenance endpoint is:

```text
POST /api/kawnix/maintenance
```

It is also an internal endpoint.

It removes or expires old jobs so the database does not grow forever. By
default:

- Queued jobs expire after 24 hours.
- Stuck running jobs expire after 30 minutes.
- Completed and failed jobs are retained for 7 days.

### 4.6 GitHub App access

The provider uses a GitHub App owned by the publisher.

The GitHub App can:

- Find the approved repository.
- Read pull-request files and changes.
- Read existing pull-request reviews.
- Publish a review only when publication mode is explicitly selected and the
  App has write permission.

The provider does not accept arbitrary GitHub tokens from clients.

### 4.7 Gemini review service

The review service is separate from the Kawnix transport layer. This means
the same review logic can be called by the Kawnix worker without pretending
that the request came from a GitHub webhook.

The review service:

- Filters changed files.
- Applies include and ignore patterns.
- Sends code changes to Gemini.
- Converts the response into structured findings.
- Maps findings to files and code locations when possible.
- Supports report-only mode.
- Supports optional GitHub publication.

Repository code is treated as untrusted text. The provider does not execute
client repository code as part of the review.

### 4.8 Report-only mode

Report-only mode is the default and safest option.

In this mode:

- The provider analyzes the pull request.
- Findings are returned to Kawnix.
- Nothing is written to GitHub.

This should be used for the first release and initial client testing.

### 4.9 Optional GitHub publication

A client may explicitly request:

```text
pull_request_review
```

In that mode, the provider can publish a review to GitHub.

Publication is not the default. It requires:

- Explicit request selection.
- GitHub App write permission.
- Repository authorization.

The provider also adds a deterministic marker to its reviews. If the same
review is retried, it checks for the marker and returns the existing review
instead of intentionally creating another duplicate.

### 4.10 Authentication and authorization

There are separate credentials for separate purposes:

| Credential | Used by |
|---|---|
| `KAWNIX_PROVIDER_TOKEN` | Kawnix calling the public invoke endpoint |
| `KAWNIX_WORKER_TOKEN` | Scheduler calling worker and maintenance endpoints |
| `APP_ID` and `PRIVATE_KEY` | Provider accessing GitHub through its App |
| `GEMINI_API_KEY` | Provider accessing Gemini |
| `DATABASE_URL` | Provider accessing PostgreSQL |

The provider identifies the consumer using a hash of the bearer token.

Repository access is configured using the hash, not the raw token. For
example:

```json
{
  "consumer-hash": [
    "organization/repository"
  ]
}
```

A missing repository grant denies the review by default.

Authorization is checked twice:

1. When the job is created.
2. Again when the worker executes the job.

This protects against permission changes while a job is waiting.

### 4.11 Idempotency

Idempotency means that repeating the same request does not accidentally create
multiple jobs.

A client supplies an idempotency key when starting a review. If the same
consumer sends the same key again, the provider returns the existing job
instead of creating a new one.

This is important when a network connection fails and the client is unsure
whether the first request was received.

### 4.12 Retry and timeout handling

Temporary failures can be retried automatically.

Examples include:

- HTTP 429 rate limiting.
- HTTP 502, 503, or 504 service failures.
- Temporary network errors.

Permanent failures, such as authorization failures, are not retried forever.

The default behavior is:

- Maximum attempts: 3.
- Maximum review execution time: 10 minutes.
- Timeout failures are stored as `review_timeout`.

### 4.13 Resource limits

Limits prevent one request from using unlimited provider, GitHub, or Gemini
resources.

The current limits include:

- Maximum pull-request files: 100.
- Maximum patch size per file: 200,000 bytes.
- Maximum total patch size: 1,000,000 bytes.
- Maximum findings: 100.
- Maximum serialized result: 256,000 bytes.
- Maximum active reviews per consumer: 1.
- Maximum active reviews globally: 5.

Requests that exceed limits fail explicitly. They are not silently truncated.

### 4.14 Retention and recovery

The provider can:

- Recover stale jobs.
- Retry eligible failures.
- Expire abandoned jobs.
- Delete old terminal jobs.
- Preserve completed results for a defined period.

PostgreSQL job claiming uses database locking so multiple worker instances can
operate safely.

### 4.15 Safe errors and health information

The provider returns structured errors with stable categories, such as:

- Invalid request.
- Unauthorized.
- Repository not authorized.
- Job not found.
- Review failed.
- Review timed out.
- Provider temporarily unavailable.

Unexpected internal details and secret values are not returned to clients.

The health operation reports whether required configuration is present, but it
does not reveal the values of credentials.

---

## 5. How the complete workflow works

### Step 1: The client selects a repository and pull request

The client selects a repository that:

- Is available to the provider's GitHub App.
- Has been approved for that consumer.

The client then selects a pull request.

### Step 2: Kawnix starts the review

Kawnix sends a request like this:

```json
{
  "operation": "start",
  "repository": {
    "owner": "example-company",
    "name": "example-project"
  },
  "pull_request_number": 123,
  "publishing_mode": "report_only",
  "idempotency_key": "review-123-attempt-1"
}
```

The provider returns a job ID.

### Step 3: The worker processes the job

The scheduler calls the worker endpoint. The worker:

1. Claims the job.
2. Checks authorization.
3. Gets a short-lived GitHub installation token.
4. Reads the pull-request changes.
5. Sends the relevant changes to Gemini.
6. Builds the structured result.
7. Saves the result in PostgreSQL.

### Step 4: Kawnix checks the status

Kawnix sends:

```json
{
  "operation": "status",
  "job_id": "job-id-returned-by-start"
}
```

The provider reports whether the job is:

- Queued.
- Running.
- Completed.
- Failed.
- Cancelled.
- Expired.

### Step 5: The client receives the result

For a completed report-only review, the client receives findings and related
metadata.

For publication mode, the result can also contain the GitHub review URL.

---

## 6. What the publisher must provide

The publisher is the person or organization making this agent available.

The publisher must provide:

1. A public HTTPS deployment.
2. PostgreSQL.
3. A GitHub App.
4. A Gemini API key.
5. Secure secret storage.
6. A worker scheduler.
7. A maintenance scheduler.
8. A Kawnix provider credential.
9. Repository access grants.
10. A completed Kawnix manifest.

The detailed deployment procedure is in
[KAWNIX_DEPLOYMENT.md](./KAWNIX_DEPLOYMENT.md).

### Required environment settings

```text
KAWNIX_PROVIDER_TOKEN
KAWNIX_WORKER_TOKEN
APP_ID
PRIVATE_KEY
GEMINI_API_KEY
DATABASE_URL
KAWNIX_REPOSITORY_ACCESS
```

These values must be stored in a secret manager or protected deployment
configuration. They must not be committed to Git.

---

## 7. What the publisher deploys

The provider deployment has three routes:

| Route | Public or internal | Purpose |
|---|---|---|
| `/api/kawnix/invoke` | Public to Kawnix | Health, start, and status |
| `/api/kawnix/worker` | Internal scheduler | Process one review job |
| `/api/kawnix/maintenance` | Internal scheduler | Clean up old jobs |

Only the invoke route should be registered in Kawnix.

The worker and maintenance routes should not be advertised to clients.

---

## 8. The deployment preflight

The project includes a local preflight command:

```powershell
npm run kawnix:preflight -- .\path\to\manifest.json
```

It checks:

- Whether required production configuration exists.
- Whether the manifest is valid.
- Whether placeholders remain.
- Whether the endpoint uses HTTPS.

It does not contact GitHub or Gemini. It is a safe preparation check.

The example manifest intentionally contains placeholders and should not be
registered without replacing them.

The preflight implementation is in
[src/kawnix-preflight.ts](./src/kawnix-preflight.ts).

---

## 9. What the client does

A client using the published agent should:

1. Find the agent in Kawnix.
2. Subscribe or obtain permission to use it.
3. Connect or select a GitHub repository.
4. Confirm that the provider GitHub App can access the repository.
5. Select a pull request.
6. Choose report-only mode or explicitly choose publication mode.
7. Start the review.
8. Wait for completion.
9. Read the findings.
10. Open the GitHub review link if publication was selected.

The client does not need to know the provider's Gemini key, GitHub private key,
database password, or worker credential.

---

## 10. Safety protections

The implementation includes these protections:

- Bearer authentication.
- Separate provider and worker credentials.
- Provider-owned GitHub App credentials.
- Repository allowlisting.
- Authorization checks at creation and execution time.
- No arbitrary client GitHub tokens.
- No repository code execution.
- Request-size limits.
- Review-size limits.
- Concurrent-review limits.
- Idempotency keys.
- Retry limits.
- Execution timeouts.
- Stale-job recovery.
- Safe error messages.
- Secret-safe health diagnostics.
- Duplicate GitHub publication protection.
- PostgreSQL locking for worker claims.
- Report-only as the default.

---

## 11. Testing completed

The project has automated coverage for:

- Provider contract validation.
- Bearer authentication.
- Request limits.
- Job creation and ownership.
- Idempotency.
- Worker execution.
- Retry behavior.
- Timeout behavior.
- Stale-job recovery.
- Retention cleanup.
- Concurrency limits.
- Repository authorization.
- GitHub App API behavior with mocked responses.
- Gemini review behavior with mocked responses.
- GitHub publication behavior.
- Duplicate-publication prevention.
- Configuration diagnostics.
- End-to-end provider-to-worker workflow.

The latest local validation completed with:

- 14 test suites passed.
- 94 tests passed.
- 1 PostgreSQL integration test skipped because no `DATABASE_URL` was
  configured.
- TypeScript validation passed.
- Production build completed.
- Manifest JSON validation passed.
- Preflight tests passed.

---

## 12. What has not yet been verified

Automated tests use mocks for external services. The following still require a
real environment:

1. A real PostgreSQL database.
2. A real GitHub App.
3. A real test GitHub repository.
4. A real Gemini API key.
5. A deployed public HTTPS provider.
6. A worker scheduler.
7. A maintenance scheduler.
8. A real report-only pull-request review.
9. A real GitHub publication review.
10. A restart-recovery test against PostgreSQL.
11. Kawnix endpoint registration.
12. Kawnix manifest preflight.
13. Kawnix approval and activation.
14. A real consumer invocation.

These are deployment and external-service checks, not missing core provider
features.

---

## 13. Final release checklist

### Publisher checklist

- [ ] Deploy the invoke endpoint over HTTPS.
- [ ] Deploy the worker endpoint.
- [ ] Deploy the maintenance endpoint.
- [ ] Configure PostgreSQL.
- [ ] Configure all required secrets.
- [ ] Configure the GitHub App.
- [ ] Install the GitHub App on a dedicated test repository.
- [ ] Add the test repository to the authorization mapping.
- [ ] Configure worker scheduling.
- [ ] Configure maintenance scheduling.
- [ ] Replace all manifest placeholders.
- [ ] Run the local preflight successfully.
- [ ] Run the health operation successfully.
- [ ] Run a real report-only review.
- [ ] Test a real publication review, if enabled.
- [ ] Test duplicate-review protection.
- [ ] Test restart recovery.
- [ ] Confirm secrets are absent from logs.
- [ ] Register the invoke endpoint in Kawnix.
- [ ] Submit and activate the manifest.

### Client checklist

- [ ] Discover the active agent.
- [ ] Subscribe to it.
- [ ] Select an authorized GitHub repository.
- [ ] Select a pull request.
- [ ] Start a report-only review.
- [ ] Read the result.
- [ ] Use publication mode only when intended.

---

## 14. Current project status

The project is:

> **Ready for controlled deployment, but not yet externally verified or
> publicly activated in Kawnix.**

The core software has been implemented and tested locally. The remaining work
requires deployment infrastructure, real credentials, a test repository, and
access to the running Kawnix system.

---

## 15. Important files

| File | Purpose |
|---|---|
| [KAWNIX_AGENT_READINESS_GUIDE.md](./KAWNIX_AGENT_READINESS_GUIDE.md) | High-level readiness guide |
| [KAWNIX_IMPLEMENTATION_PLAN.md](./KAWNIX_IMPLEMENTATION_PLAN.md) | Engineering roadmap and completion criteria |
| [KAWNIX_DEPLOYMENT.md](./KAWNIX_DEPLOYMENT.md) | Deployment and scheduler runbook |
| [KAWNIX_MANIFEST.example.json](./KAWNIX_MANIFEST.example.json) | Kawnix registration template |
| [src/provider-contract.ts](./src/provider-contract.ts) | Request validation and provider contract |
| [src/kawnix-provider.ts](./src/kawnix-provider.ts) | Authentication and HTTP provider handling |
| [src/kawnix-jobs.ts](./src/kawnix-jobs.ts) | Job lifecycle and in-memory execution |
| [src/postgres-kawnix-jobs.ts](./src/postgres-kawnix-jobs.ts) | Durable PostgreSQL job storage |
| [src/kawnix-review.ts](./src/kawnix-review.ts) | Review execution and result creation |
| [src/github-app-client.ts](./src/github-app-client.ts) | GitHub App access |
| [src/kawnix-authorization.ts](./src/kawnix-authorization.ts) | Repository authorization |
| [src/kawnix-config.ts](./src/kawnix-config.ts) | Configuration diagnostics |
| [src/kawnix-preflight.ts](./src/kawnix-preflight.ts) | Local deployment preflight |
| [api/kawnix/invoke/index.ts](./api/kawnix/invoke/index.ts) | Public Kawnix invoke route |
| [api/kawnix/worker/index.ts](./api/kawnix/worker/index.ts) | Background worker route |
| [api/kawnix/maintenance/index.ts](./api/kawnix/maintenance/index.ts) | Maintenance route |

---

## 16. One-sentence explanation

ChatGPT-CodeReview is now a secure, asynchronous Kawnix agent that can review
an authorized client's GitHub pull request with Gemini and return findings or,
when explicitly requested, publish a review back to GitHub.
