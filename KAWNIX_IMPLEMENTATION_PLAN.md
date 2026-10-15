# ChatGPT-CodeReview to Kawnix

## Complete implementation plan

This plan explains how to turn ChatGPT-CodeReview into a production-ready Kawnix agent without breaking its existing GitHub App or GitHub Action.

The plan follows the recommendations in [KAWNIX_AGENT_READINESS_GUIDE.md](./KAWNIX_AGENT_READINESS_GUIDE.md).

---

## 1. Target result

The finished system should support this flow:

```text
Client selects a GitHub pull request in Kawnix
        |
        v
Kawnix sends a secure request to ChatGPT-CodeReview
        |
        v
ChatGPT-CodeReview checks access and creates a review job
        |
        v
The job reads the pull request from GitHub
        |
        v
Gemini analyzes the changed code
        |
        v
The provider stores a structured result
        |
        v
Kawnix checks the result
        |
        v
The client receives the report
        |
        +--> optionally publish the review to GitHub
```

The existing GitHub workflows must continue to work:

```text
GitHub webhook -> Probot -> existing review behavior
GitHub Action  -> existing review behavior
```

Kawnix should be a separate integration path:

```text
Kawnix -> provider endpoint -> reusable review service
```

---

## 2. Decisions to make before coding

These decisions must be confirmed first because they affect the API, security model, deployment, and manifest.

### 2.1 First release scope

Recommended first release:

- Review an existing pull request.
- Accept a repository and pull-request number.
- Return findings to Kawnix.
- Optionally publish a pull-request review.
- Do not modify source files.
- Do not create commits.
- Do not create branches.
- Do not open pull requests.

### 2.2 Authentication

Recommended:

- Kawnix authenticates to the provider with a vault-managed bearer credential.
- The provider uses a provider-owned GitHub App to access repositories.
- GitHub private keys never travel through a Kawnix request.

The existing custom HMAC implementation may be retained only if Kawnix explicitly supports it in the final provider contract. It should not be assumed to replace Kawnix's normal provider authentication.

### 2.3 Endpoint

Recommended public endpoint:

```text
POST https://<provider-domain>/invoke
```

The same URL must be used in:

- Provider deployment.
- Kawnix endpoint registration.
- Kawnix manifest.
- Preflight tests.
- Production documentation.

### 2.4 Execution model

Recommended:

- `health` runs synchronously.
- `start` creates an asynchronous review job.
- `status` returns job progress and the final result.
- Streaming is disabled for the first release.

### 2.5 Publication mode

Recommended modes:

```text
report_only
pull_request_review
```

`report_only` must be the default.

---

## 3. Phase 0: establish a clean baseline

### Goal

Understand and record the current state before changing the application.

### Tasks

1. Confirm the working tree and preserve unrelated user changes.
2. Run the current test suite.
3. Run the TypeScript check.
4. Run the current build.
5. Record failures that existed before the Kawnix implementation.
6. Confirm the existing GitHub App and GitHub Action behavior.
7. Confirm the Kawnix repository revision and API contract being targeted.

### Existing baseline issues to resolve or document

- The current test suite has a `fetch` typing failure in [test/chat.test.ts](./test/chat.test.ts).
- The TypeScript check reports issues involving [src/fetch-polyfill.cjs](./src/fetch-polyfill.cjs) and [src/github-action.cjs](./src/github-action.cjs).
- [rollup.config.ts](./rollup.config.ts) references `src/index.ts`, which must be verified against the intended build.
- The existing Kawnix route is not clearly included in the production build.

### Exit criteria

- Baseline test, type-check, and build results are recorded.
- Existing unrelated failures are distinguished from new failures.
- Existing GitHub behavior is protected by regression tests.

---

## 4. Phase 1: define the provider contract

### Goal

Create the exact contract that Kawnix and the provider will share before implementing runtime logic.

### 4.1 Define operations

#### Health

Request:

```json
{
  "operation": "health"
}
```

Response:

```json
{
  "status": "ready",
  "service": "chatgpt-codereview",
  "capabilities": {
    "review_pull_request": true,
    "publish_review": true,
    "streaming": false
  }
}
```

The health operation must be non-mutating.

#### Start

Request:

```json
{
  "operation": "start",
  "repository": {
    "owner": "example-owner",
    "name": "example-repository"
  },
  "pull_request_number": 123,
  "commit_sha": "optional-sha",
  "publishing_mode": "report_only",
  "prompt": "Review for bugs, security issues, and maintainability problems.",
  "include_patterns": ["src/**/*.ts"],
  "ignore_patterns": ["**/*.md"],
  "idempotency_key": "client-review-123"
}
```

Rules:

- `repository.owner` is required.
- `repository.name` is required.
- `pull_request_number` is required.
- `publishing_mode` defaults to `report_only`.
- `commit_sha` is optional but, if supplied, must match the review target.
- Pattern lists are optional and bounded.
- Prompt length is bounded.
- Arbitrary repository URLs are not accepted in the first release.

#### Status

Request:

```json
{
  "operation": "status",
  "job_id": "job_123"
}
```

Response states:

```text
queued
running
completed
failed
cancelled
expired
```

#### Optional cancel

Defer cancellation unless the selected job system supports safe cancellation. Do not advertise an operation that cannot reliably stop work.

### 4.2 Define response schemas

The final response must describe:

- Job ID.
- Job status.
- Repository.
- Pull request number.
- Commit SHA.
- Review summary.
- LGTM result.
- Findings.
- Files reviewed.
- Files skipped.
- Publication status.
- Error information.

Each finding should support:

- Severity.
- Confidence.
- File.
- Line.
- Diff side.
- Hunk header.
- Comment.

### 4.3 Define error responses

Use stable error codes:

```text
invalid_request
missing_authentication
invalid_authentication
repository_not_authorized
repository_not_found
pull_request_not_found
github_unavailable
gemini_unavailable
rate_limited
request_too_large
idempotency_conflict
job_not_found
job_expired
timeout
internal_error
```

Use predictable HTTP statuses:

| Status | Meaning |
|---|---|
| 200 | Health or completed status response |
| 202 | Job accepted |
| 400 | Invalid request |
| 401 | Missing or invalid provider authentication |
| 403 | Repository or operation not authorized |
| 404 | Repository, pull request, or job not found |
| 409 | Idempotency conflict |
| 413 | Request too large |
| 422 | Semantically invalid request |
| 429 | Rate limit |
| 500 | Internal provider failure |
| 502 | GitHub or Gemini failure |
| 504 | Timeout |

### 4.4 Define limits

Choose and document:

- Maximum request body size.
- Maximum prompt size.
- Maximum number of files.
- Maximum patch size per file.
- Maximum total patch size.
- Maximum review duration.
- Maximum concurrent jobs per consumer.
- Maximum total provider concurrency.
- Job retention period.
- Result retention period.

### Exit criteria

- Request and response schemas are approved.
- Error statuses and codes are approved.
- Authentication strategy is approved.
- Limits are approved.
- Synchronous/asynchronous behavior is approved.

---

## 5. Phase 2: design the provider architecture

### Goal

Separate transport, security, GitHub access, review logic, job management, and publication.

### Recommended logical components

#### 5.1 Kawnix transport adapter

Responsibilities:

- Receive `POST /invoke`.
- Read the request body once.
- Validate content type and size.
- Authenticate Kawnix.
- Validate the operation schema.
- Return provider-level HTTP responses.

Candidate location:

```text
src/kawnix/
```

The current [src/kawnix.ts](./src/kawnix.ts) can be used as a starting point, but its placeholder execution path must be replaced.

#### 5.2 Request and response schemas

Responsibilities:

- Validate every input field.
- Reject unknown fields where appropriate.
- Normalize repository names and patterns.
- Validate publishing mode.
- Validate job IDs.
- Produce structured response types.

#### 5.3 GitHub service

Responsibilities:

- Resolve the provider's GitHub App installation.
- Create a short-lived installation token.
- Verify repository authorization.
- Retrieve pull-request metadata.
- Retrieve changed files.
- Compare commits for incremental reviews.
- Publish a pull-request review when authorized.

This service must not depend on a Probot webhook `Context`.

#### 5.4 Review service

Responsibilities:

- Receive normalized patches.
- Apply include and ignore patterns.
- Apply patch and file limits.
- Call the existing Gemini client in [src/chat.ts](./src/chat.ts).
- Normalize Gemini output into findings.
- Calculate safe inline locations.
- Produce a deterministic review result.

#### 5.5 Job service

Responsibilities:

- Create jobs.
- Track job states.
- Run work asynchronously.
- Store results.
- Store failures.
- Support safe status polling.
- Enforce job ownership.

#### 5.6 Idempotency service

Responsibilities:

- Store consumer ID, idempotency key, and request hash.
- Return the original job for identical retries.
- Return `409` for conflicting reuse.
- Prevent duplicate GitHub publication.

#### 5.7 Persistence layer

Responsibilities:

- Durable job storage.
- Durable idempotency records.
- Review publication markers.
- Expiration and cleanup.
- Multi-instance concurrency safety.

#### 5.8 Existing Probot adapter

Keep the existing [src/bot.ts](./src/bot.ts) behavior intact, but make it call shared review/GitHub services where practical.

Do not make the Kawnix handler fabricate a Probot context.

### Exit criteria

- Component boundaries are approved.
- Data ownership is clear.
- No Kawnix code needs to invoke the Probot event handler directly.

---

## 6. Phase 3: prepare GitHub access

### Goal

Allow the provider to safely access a client's selected repository.

### Tasks

1. Create or identify the provider-owned GitHub App.
2. Configure the App's webhook and callback settings as needed.
3. Request minimum permissions:
   - Metadata: read.
   - Contents: read.
   - Pull requests: read.
   - Pull requests: write only for publication mode.
4. Store the App ID and private key in a secret manager.
5. Define how installations are recorded.
6. Define how a repository maps to an installation.
7. Validate that the requesting consumer is allowed to use the installation.
8. Generate short-lived installation tokens.
9. Never accept a long-lived GitHub token in normal review input.

### Repository authorization rules

Before starting a job:

- Confirm the repository name is syntactically valid.
- Confirm the provider has an active installation.
- Confirm the repository belongs to that installation.
- Confirm the pull request belongs to the requested repository.
- Confirm the selected commit, if present.
- Confirm publication permission when `pull_request_review` is requested.

### Exit criteria

- A test repository can be authorized.
- An unauthorized repository is rejected.
- A test pull request can be read.
- A publication attempt is rejected unless write permission is present.

---

## 7. Phase 4: implement the review service

### Goal

Reuse the existing review behavior without requiring a GitHub webhook.

### Tasks

1. Extract or reuse changed-file retrieval logic from [src/bot.ts](./src/bot.ts).
2. Preserve incremental-review behavior where meaningful.
3. Reuse include and ignore pattern behavior.
4. Reuse patch-length protection.
5. Call [src/chat.ts](./src/chat.ts) for Gemini analysis.
6. Normalize both array and single-object Gemini responses.
7. Preserve hunk-header matching.
8. Normalize inline comments into provider-neutral findings.
9. Handle malformed Gemini output explicitly.
10. Record skipped files and reasons.
11. Avoid logging full patches or secrets.

### Review result rules

- A review with no findings is `lgtm: true`.
- A review with one or more findings is `lgtm: false`.
- Findings must include enough location information for optional GitHub publication.
- A malformed model response must produce an explicit provider error or safe unlocated finding.
- One bad file should not silently produce a success-shaped result.

### Exit criteria

- A supplied test pull request produces the expected structured findings.
- Existing Probot review tests still pass.
- A review can run without a Probot event object.

---

## 8. Phase 5: implement jobs and reliability

### Goal

Make long-running reviews safe, repeatable, and recoverable.

### Job lifecycle

```text
accepted -> queued -> running -> completed
                          |
                          +-> failed
                          +-> cancelled
                          +-> expired
```

### Tasks

1. Create a durable job record.
2. Return `202 Accepted` and a job ID for `start`.
3. Execute jobs in a worker or durable background mechanism.
4. Update job stage:
   - validating
   - checking_access
   - reading_pull_request
   - reviewing_files
   - publishing
   - completed
5. Store the final result.
6. Store a safe failure reason.
7. Make `status` safe to repeat.
8. Enforce job ownership.
9. Add timeout handling.
10. Add retry rules for temporary GitHub/Gemini failures.
11. Do not retry invalid input or authorization failures.
12. Expire old jobs and results.
13. Recover or mark jobs safely after a worker restart.

The worker boundary now claims queued jobs atomically, and requeues jobs whose
running lease has been stale for 15 minutes. PostgreSQL uses
`FOR UPDATE SKIP LOCKED`, while the in-memory store provides the same behavior
for development and tests. A production deployment still needs a scheduler or
queue trigger to call the worker endpoint regularly.

Worker execution now records an attempt count, applies a three-attempt default,
requeues recognized transient upstream failures, and applies a ten-minute
execution timeout. Permanent failures are stored without retrying. These
defaults should be reviewed against the selected hosting platform and model
latency before production activation.

Review resource controls are also enforced before and during execution:
maximum pull-request files, per-file and total patch bytes, finding count, and
serialized result size. Exceeding a limit produces an explicit `413` review
failure rather than silently truncating the review.

The worker claim boundary now enforces a default concurrency limit of one
running review per provider owner and five running reviews globally. The
PostgreSQL implementation serializes claims with a transaction advisory lock
so multiple worker instances observe the same limits.

Retention cleanup is available through the protected maintenance endpoint.
Abandoned queued jobs older than 24 hours and running jobs older than 30
minutes are marked `expired`; terminal jobs older than seven days are deleted.
The endpoint is intended for a scheduled maintenance trigger and uses the
worker token.

### Idempotency tasks

1. Read `Idempotency-Key`.
2. Calculate a request fingerprint.
3. Atomically create the idempotency record.
4. Return the existing job for an identical request.
5. Return `409` for a different request using the same key.
6. Make publication use a stable marker.

### Rate and resource controls

Add:

- Per-consumer concurrency limit.
- Global worker limit.
- Per-request file limit.
- Per-request patch limit.
- Gemini timeout.
- GitHub timeout.
- Queue timeout.
- Result size limit.

### Exit criteria

- A duplicate request does not create duplicate work.
- A provider restart does not lose completed results.
- Temporary upstream errors are retried according to policy.
- Permanent errors are not retried indefinitely.

---

## 9. Phase 6: implement the provider endpoint

### Goal

Expose the final Kawnix-compatible HTTPS API.

### Tasks

1. Create the production provider route.
2. Decide whether the route is `/invoke` or another explicitly supported path.
3. Add the route to the build configuration.
4. Add the route to the deployment configuration.
5. Validate bearer authentication.
6. Validate request size before parsing.
7. Validate JSON and operation schemas.
8. Dispatch:
   - `health` -> readiness response.
   - `start` -> idempotent job creation.
   - `status` -> job lookup.
9. Return JSON with correct content type.
10. Add cache prevention headers.
11. Add correlation/request IDs.
12. Avoid returning internal stack traces.
13. Ensure all failure paths return explicit errors.

### Important implementation rule

Do not remove or repurpose the existing GitHub webhook route. Kawnix must have its own provider entry point.

### Exit criteria

- The deployed endpoint responds over HTTPS.
- Kawnix can invoke it with the selected authentication strategy.
- The endpoint returns the declared schemas.

---

## 10. Phase 7: build the Kawnix manifest

### Goal

Describe the provider accurately so Kawnix can discover, validate, and invoke it.

### Manifest contents

Include:

- Name: `ChatGPT CodeReviewer`.
- Version.
- Description.
- Exact endpoint URL.
- HTTP method.
- Content type.
- Authentication strategy.
- Input schema.
- Response schema.
- Error schema.
- Operations.
- Timeout.
- Request and response limits.
- Async behavior.
- Streaming capability set to false initially.
- Publication modes.
- GitHub access requirements.
- Examples.
- Privacy and data-handling notes.

### Manifest lifecycle

Use Kawnix's publication sequence:

```text
DRAFT
  -> preflight
  -> PENDING_REVIEW
  -> APPROVED
  -> ACTIVE
  -> DEPRECATED
```

Do not advertise capabilities that are not implemented.

### Exit criteria

- Kawnix accepts the manifest.
- Preflight passes.
- Discovery shows correct metadata.
- A consumer can identify the supported operations.

---

## 11. Phase 8: testing

### 11.1 Unit tests

Add or update tests for:

- Health request.
- Start request.
- Status request.
- Unknown operation.
- Missing required fields.
- Invalid repository.
- Invalid pull-request number.
- Invalid publication mode.
- Request too large.
- Missing authentication.
- Invalid authentication.
- Repository authorization.
- Job ownership.
- Idempotency.
- Error mapping.
- Gemini response parsing.
- Hunk location mapping.
- Publication marker detection.

### 11.2 Service integration tests

Use mocked GitHub and Gemini services to test:

- Read-only review.
- Pull-request review publication.
- GitHub not found.
- GitHub permission denied.
- Gemini rejection.
- Gemini timeout.
- Partial file failures.
- Retryable upstream failure.
- Duplicate publication prevention.

### 11.3 Provider endpoint tests

Test the deployed-style handler with:

- Valid Kawnix request.
- Invalid bearer credential.
- Valid health request.
- Start returning `202`.
- Status returning `queued`.
- Status returning `running`.
- Status returning `completed`.
- Status returning `failed`.
- Unknown job.
- Idempotency retry.

### 11.4 End-to-end tests

Against a dedicated test environment:

1. Register a test endpoint in Kawnix.
2. Register a draft manifest.
3. Run preflight.
4. Submit and activate the manifest.
5. Create a consumer API key with required scopes.
6. Invoke the health operation.
7. Start a review.
8. Poll the job.
9. Confirm the result.
10. Test report-only mode.
11. Test publication mode in a test repository.
12. Repeat the request and confirm idempotency.
13. Attempt an unauthorized repository and confirm rejection.

### 11.5 Regression tests

Confirm that:

- Existing GitHub webhook reviews still work.
- Existing GitHub Action reviews still work.
- Existing include/ignore patterns still work.
- Existing incremental-review behavior still works.

### Exit criteria

- Targeted tests pass.
- Build passes.
- Type-check passes.
- Kawnix preflight passes.
- End-to-end test passes.
- No secrets appear in logs or test artifacts.

---

## 12. Phase 9: deployment

### Recommended deployment components

- Public HTTPS provider service.
- Secret manager.
- Durable relational database.
- Background worker.
- Optional queue.
- Monitoring and alerting.
- Log redaction.

### Environment configuration

Provider-side secrets:

- Kawnix provider credential.
- Gemini API key.
- GitHub App ID.
- GitHub App private key.
- Database connection.
- Queue connection, if used.

Non-secret configuration:

- Provider public URL.
- Gemini model.
- Job timeout.
- Request limits.
- Worker concurrency.
- Result retention.
- Allowed publication modes.

### Deployment checklist

1. Build the provider.
2. Deploy the provider route.
3. Deploy the worker.
4. Run database migrations.
5. Configure secrets.
6. Configure the GitHub App.
7. Configure HTTPS and DNS.
8. Verify health.
9. Verify logs do not contain secrets.
10. Verify restart recovery.
11. Verify Kawnix can reach the endpoint.

---

## 13. Phase 10: publish in Kawnix

### Publisher sequence

1. Create the endpoint in Kawnix.
2. Set the exact provider URL.
3. Set the timeout.
4. Set request and response schemas.
5. Set the success status.
6. Create the first manifest as `DRAFT`.
7. Configure the provider authentication reference.
8. Run preflight.
9. Fix any preflight failures.
10. Submit the manifest for review.
11. Wait for approval.
12. Activate the endpoint and manifest.
13. Create a test subscription.
14. Create a consumer API key.
15. Invoke the health operation.
16. Run a test review.
17. Confirm the receipt and result.

### Consumer sequence

1. Discover the active manifest.
2. Subscribe to the agent.
3. Obtain an API key with:
   - `manifest:read`
   - `endpoint:invoke`
   - `receipt:read`
4. Connect or select a GitHub repository.
5. Ensure the provider GitHub App is installed.
6. Select a pull request.
7. Choose report-only or publication mode.
8. Start the review.
9. Wait for completion.
10. Read the structured findings.
11. Open the GitHub review link if publication was enabled.

---

## 14. Phase 11: documentation

Update or add documentation for:

### Publisher documentation

- System architecture.
- Required infrastructure.
- Environment variables.
- GitHub App setup.
- Database setup.
- Worker setup.
- Kawnix endpoint registration.
- Manifest registration.
- Preflight.
- Approval and activation.
- Secret rotation.
- Monitoring.
- Incident response.

### Consumer documentation

- How to find the agent.
- How to connect GitHub.
- How to authorize a repository.
- How to choose a pull request.
- Report-only mode.
- Publication mode.
- Job progress.
- Error messages.
- Data and privacy behavior.

### API documentation

- Health request.
- Start request.
- Status request.
- Request examples.
- Response examples.
- Error examples.
- Idempotency behavior.
- Limits.

The existing [KAWNIX_AGENT_READINESS_GUIDE.md](./KAWNIX_AGENT_READINESS_GUIDE.md) should remain a high-level guide. This implementation plan is the engineering execution document.

---

## 15. Rollout strategy

### Stage 1: internal development

- Use a test GitHub App.
- Use a test repository.
- Use mocked Gemini responses where possible.
- Keep publication disabled.

### Stage 2: private Kawnix test

- Register a private endpoint.
- Use a private manifest.
- Permit only internal consumers.
- Enable report-only mode.
- Test failures and retries.

### Stage 3: controlled publication test

- Enable publication for one test repository.
- Verify duplicate prevention.
- Verify the correct pull request and commit receive comments.
- Verify permission failures.

### Stage 4: public release

- Activate the reviewed manifest.
- Publish consumer documentation.
- Enable monitoring and alerts.
- Keep report-only as the default.
- Review usage, error rate, cost, and latency.

### Rollback plan

If the provider is unsafe or unstable:

1. Deprecate the active manifest.
2. Disable publication mode.
3. Disable new job creation.
4. Allow existing jobs to finish or expire safely.
5. Preserve results and audit records.
6. Fix the provider.
7. Publish a new immutable manifest version.

Do not silently change the behavior of an active manifest. Publish a new version for contract changes.

---

## 16. Completion criteria

The implementation is complete only when all of these are true:

- [ ] Existing GitHub App behavior is preserved.
- [ ] Existing GitHub Action behavior is preserved.
- [ ] A public HTTPS `/invoke` endpoint exists.
- [ ] Kawnix authentication works.
- [ ] The provider-owned GitHub App can access an authorized repository.
- [ ] A client can select a pull request.
- [ ] The provider can create a durable review job.
- [ ] Gemini receives the actual changed code.
- [ ] The provider returns real structured findings.
- [ ] Report-only mode works.
- [ ] Publication mode works when explicitly authorized.
- [ ] Duplicate requests are idempotent.
- [ ] Unauthorized repositories are rejected.
- [ ] Provider restarts do not lose completed jobs.
- [ ] Errors are explicit and safe.
- [ ] Secrets are not exposed.
- [ ] Manifest preflight passes.
- [ ] The manifest is approved and active.
- [ ] A real consumer can discover and invoke the agent.
- [ ] Documentation explains both publisher and consumer workflows.

## 17. Recommended implementation order

Implement in this exact order:

1. Confirm product and security decisions.
2. Establish the baseline.
3. Finalize request, response, and error schemas.
4. Design service boundaries.
5. Configure the provider-owned GitHub App.
6. Build the reusable GitHub service.
7. Build the reusable review service.
8. Add durable jobs and idempotency.
9. Build the Kawnix provider endpoint.
10. Add deployment and build wiring.
11. Add and run unit tests.
12. Add and run integration tests.
13. Run Kawnix preflight.
14. Publish a private manifest.
15. Run a complete consumer workflow.
16. Enable controlled publication.
17. Publish the approved manifest.
18. Monitor and iterate through new immutable manifest versions.

## Final outcome

At the end of this plan, ChatGPT-CodeReview will remain a working GitHub App and GitHub Action while also becoming a secure, discoverable, asynchronous Kawnix agent that can review authorized client pull requests and return or publish reliable code-review results.
