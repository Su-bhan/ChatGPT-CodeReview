# ChatGPT CodeReviewer and Kawnix

## A plain-language guide for publishing and using the agent

## 1. What is this project supposed to do?

The goal is to make ChatGPT-CodeReview available inside Kawnix as a reusable code-review agent.

In simple terms:

1. A client connects their GitHub repository.
2. The client selects a pull request in Kawnix.
3. Kawnix asks ChatGPT-CodeReview to review that pull request.
4. ChatGPT-CodeReview reads the changed code.
5. Gemini analyzes the code.
6. The result is sent back to Kawnix.
7. Optionally, the review is posted back to the client's GitHub pull request.

The client should not need to understand the internal code. They should only need to:

- Connect GitHub.
- Select a repository.
- Select a pull request.
- Start the review.

## 2. Important words explained

### Kawnix

Kawnix is the platform that discovers, starts, and monitors agents.

### Provider

The provider is the service that performs the actual work.

In this case, ChatGPT-CodeReview will be the provider.

### Consumer

The consumer is the person or application using the agent.

For example, a client who wants a pull request reviewed is a consumer.

### Endpoint

An endpoint is the internet address where Kawnix sends a request.

Example:

```text
https://reviewer.example.com/invoke
```

### Manifest

A manifest is the agent's instruction sheet. It tells Kawnix:

- What the agent is called.
- Where it can be reached.
- What information it accepts.
- What it returns.
- How it is authenticated.
- How long it may take.
- Whether it works immediately or in the background.

### Job

A job is one review request.

If a review takes a long time, Kawnix receives a job number first and checks the result later.

## 3. What already exists?

The repository already has a working GitHub code-review application.

It can:

- Listen for GitHub pull-request events.
- Find changed files.
- Send code patches to Gemini.
- Read Gemini's response.
- Create inline review comments.
- Publish a review on GitHub.
- Run as a GitHub App or GitHub Action.

The main existing files are:

- [bot.ts](./src/bot.ts) - GitHub pull-request workflow.
- [chat.ts](./src/chat.ts) - Gemini communication.
- [api/github/webhooks/index.ts](./api/github/webhooks/index.ts) - GitHub webhook endpoint.
- [action.yml](./action.yml) - GitHub Action definition.

There is also an early Kawnix prototype:

- [kawnix.ts](./src/kawnix.ts)
- [api/kawnix/invoke/index.ts](./api/kawnix/invoke/index.ts)
- [kawnix.test.ts](./src/kawnix.test.ts)

That prototype can check signed requests and return a test response. It does not yet perform a real GitHub review.

## 4. What is the main problem today?

The Kawnix endpoint currently behaves like a test door.

It can receive a request such as:

```json
{
  "operation": "review",
  "diff": "some changed code"
}
```

But it currently returns a placeholder response instead of:

1. Opening the selected GitHub repository.
2. Finding the selected pull request.
3. Sending the changed code to Gemini.
4. Building a real review.
5. Returning the review to Kawnix.
6. Optionally publishing the review to GitHub.

So the important missing connection is:

```text
Kawnix request
    -> GitHub repository
    -> Gemini review
    -> result
    -> optional GitHub publication
```

## 5. Recommended design

The simplest safe design is:

- Kawnix sends a request to one public HTTPS address.
- Kawnix authenticates that request.
- The client chooses a repository and pull request.
- A GitHub App owned by the provider gives the reviewer access.
- ChatGPT-CodeReview reads the pull request.
- Gemini analyzes the changes.
- The provider returns a structured result.
- Publishing comments to GitHub is optional.

The existing GitHub App and GitHub Action should continue working separately.

There should be two independent ways to use the project:

### Existing GitHub use

```text
GitHub event -> ChatGPT-CodeReview -> GitHub review
```

### Kawnix use

```text
Kawnix request -> ChatGPT-CodeReview -> result -> optional GitHub review
```

The Kawnix workflow should not pretend to be a GitHub webhook. It is a separate type of request.

## 6. The recommended user experience

A client should experience the following process.

### Step 1: Connect GitHub

The client connects GitHub to Kawnix and gives the provider's GitHub App access to the repositories they want reviewed.

The provider's GitHub App should ask only for the permissions it needs:

- Read repository information.
- Read repository files.
- Read pull requests.
- Write pull-request reviews only if the client enables publishing.

### Step 2: Find the agent

The client searches Kawnix's agent directory for:

```text
ChatGPT CodeReviewer
```

Kawnix shows the agent's description, supported operations, limits, and price.

### Step 3: Select a repository and pull request

The client selects:

- Repository owner.
- Repository name.
- Pull-request number.

The client should not need to paste a private GitHub token into the request.

### Step 4: Choose the result type

The client chooses one of two modes:

#### Report only

The agent analyzes the pull request and returns findings to Kawnix.

Nothing is changed on GitHub.

This should be the default.

#### Publish review

The agent analyzes the pull request and posts the review back to GitHub.

This should require the correct GitHub permission and clear user consent.

### Step 5: Wait for the result

A small review may finish immediately.

A larger review should show:

```text
Queued
Running
Completed
```

Kawnix should display the final result and, when applicable, a link to the GitHub review.

## 7. What the agent should accept

The agent should use clear operations.

### Health check

This asks:

```text
Are you available and ready?
```

Example:

```json
{
  "operation": "health"
}
```

It should not modify GitHub or use unnecessary Gemini credits.

### Start a review

Example:

```json
{
  "operation": "start",
  "repository": {
    "owner": "example-owner",
    "name": "example-repository"
  },
  "pull_request_number": 123,
  "publishing_mode": "report_only",
  "prompt": "Look for bugs, security risks, and maintainability problems."
}
```

### Check a review

If the review runs in the background:

```json
{
  "operation": "status",
  "job_id": "job_123"
}
```

## 8. What the agent should return

The result should be understandable to both Kawnix and the client.

Example:

```json
{
  "status": "completed",
  "repository": "example-owner/example-repository",
  "pull_request_number": 123,
  "lgtm": false,
  "summary": "Two possible problems were found.",
  "findings": [
    {
      "severity": "high",
      "file": "src/example.ts",
      "line": 42,
      "comment": "This value may be empty before it is used."
    }
  ],
  "publication": {
    "mode": "report_only",
    "published": false
  }
}
```

The result should not expose:

- GitHub tokens.
- Gemini keys.
- Private credentials.
- Unnecessary full repository contents.
- Secrets found in source code.

## 9. How authentication should work

There are two separate security questions.

### A. Can Kawnix call the provider?

Kawnix should use its normal secure provider authentication, preferably a vault-managed bearer credential.

In simple terms:

```text
Kawnix proves that it is allowed to call the provider.
```

The credential should not be visible to the client or stored in the public manifest.

### B. Can the provider access the client's repository?

The provider should use its own GitHub App.

The client installs that App into the selected repository.

In simple terms:

```text
The client grants repository access to the review service.
The review service uses short-lived GitHub access.
```

The provider should not require the client to send a long-lived GitHub token in every request.

## 10. Why background jobs are recommended

A pull-request review may require:

- Reading many files.
- Comparing commits.
- Calling Gemini several times.
- Handling GitHub limits.
- Publishing several comments.

Keeping one web request open for all of this can fail if it takes too long.

The safer process is:

1. Kawnix starts the review.
2. The provider returns a job number.
3. The provider works in the background.
4. Kawnix checks the job status.
5. The provider returns the final report.

Possible job states:

```text
queued
running
completed
failed
cancelled
expired
```

## 11. Preventing duplicate work

Kawnix and networks may retry requests.

The provider must recognize when two requests are really the same request.

For example, if a client clicks the button twice, the provider should not:

- Run Gemini twice.
- Create two identical GitHub reviews.
- Charge twice.

The provider should save a unique request key and reuse the original result when the same request is repeated.

If the same key is used for a different request, the provider should reject it instead of guessing.

## 12. How repository safety should work

The provider should check all of the following before reviewing:

- The repository exists.
- The provider's GitHub App is installed there.
- The client is allowed to use that installation.
- The pull request belongs to that repository.
- The requested pull request exists.
- The requested commit is correct.
- The requested branch is allowed.
- The request is not too large.

The provider should never allow one client to access another client's repository.

Repository code should be treated as untrusted text. Code comments and documentation may contain instructions intended to confuse the AI. They must never override the reviewer's safety rules.

The provider should not execute code from the repository just to review it.

## 13. What should happen when something goes wrong?

The agent should explain failures in simple, stable categories:

- The request was incomplete.
- Authentication was missing or invalid.
- The repository was not authorized.
- The repository or pull request was not found.
- GitHub was temporarily unavailable.
- Gemini was temporarily unavailable.
- The request was too large.
- The request was duplicated with different information.
- The review took too long.

Kawnix should be able to tell whether a failure can be retried.

The provider should not show private system details or secret values in an error message.

## 14. What must be described in the manifest?

The manifest should tell Kawnix:

- Agent name.
- Agent description.
- Public HTTPS endpoint.
- Authentication method.
- Supported operations.
- Input fields.
- Output fields.
- Error responses.
- Maximum request size.
- Maximum review time.
- Whether the agent is synchronous or asynchronous.
- Whether streaming is supported.
- Whether the agent can publish to GitHub.
- How repository access is authorized.
- Example requests and responses.

The manifest must use the real production URL, not a placeholder.

## 15. What must be deployed?

The provider must be deployed at a public HTTPS address that Kawnix can reach.

Deployment must include:

- The Kawnix invocation endpoint.
- The actual review logic.
- Gemini configuration.
- GitHub App configuration.
- Secure secret storage.
- Job storage if background jobs are used.
- Logging and monitoring.
- Request limits.
- Timeout handling.

The existing GitHub webhook deployment only covers the GitHub webhook route. It does not prove that the Kawnix route is deployed and reachable.

## 16. What should remain unchanged?

The existing GitHub App and GitHub Action can remain available.

The Kawnix integration should be added as a separate entry point. This prevents the Kawnix workflow from breaking the existing GitHub workflow.

The existing review behavior can be reused, but it needs to be separated from the Probot event-specific parts so that a normal Kawnix request can call it.

## 17. Publishing checklist

Before publishing the agent, confirm:

- [ ] A public HTTPS provider URL exists.
- [ ] The endpoint responds to Kawnix.
- [ ] Kawnix authentication is configured.
- [ ] A complete manifest is registered.
- [ ] The manifest URL exactly matches the deployed URL.
- [ ] The health check works.
- [ ] The provider can access an authorized test repository.
- [ ] The provider can find a test pull request.
- [ ] The provider can run a real Gemini review.
- [ ] The provider returns structured findings.
- [ ] Report-only mode works.
- [ ] GitHub publication mode works, if enabled.
- [ ] Duplicate requests do not create duplicate reviews.
- [ ] Unauthorized repositories are rejected.
- [ ] Large requests are rejected safely.
- [ ] Gemini and GitHub errors are reported clearly.
- [ ] Background jobs survive a provider restart.
- [ ] Secrets do not appear in logs or responses.
- [ ] Unit tests pass.
- [ ] Integration tests pass.
- [ ] A Kawnix preflight succeeds.
- [ ] A real consumer can discover and invoke the agent.

## 18. Recommended first version

For the first public version, use these choices:

- One endpoint: `POST /invoke`.
- Kawnix authentication: vault-managed bearer credential.
- GitHub authentication: provider-owned GitHub App.
- Review input: repository and pull-request number.
- Execution: background job.
- Default result: report only.
- Optional result: publish a pull-request review.
- Streaming: not supported initially.
- Durable storage: required.
- Idempotency: required.
- Health operation: required.
- Repository access: only repositories where the GitHub App is installed.

This is safer and easier to explain than allowing arbitrary GitHub tokens, arbitrary repository URLs, or immediate write access.

## 19. Final explanation in one sentence

ChatGPT-CodeReview is ready to become a Kawnix agent when Kawnix can securely send it a client's selected GitHub pull request, the provider can perform a real Gemini review, and the provider can reliably return or publish the result without exposing credentials or reviewing unauthorized repositories.
