# Kawnix Deployment Runbook

This runbook describes how to deploy the Kawnix provider path without changing
the existing GitHub App or GitHub Action workflows.

## Runtime components

Deploy the application as three HTTPS routes:

| Route | Purpose | Caller |
|---|---|---|
| `POST /api/kawnix/invoke` | Health, job creation, and status polling | Kawnix |
| `POST /api/kawnix/worker` | Claims and executes one queued review | Scheduler or queue |
| `POST /api/kawnix/maintenance` | Expires abandoned jobs and removes old terminal jobs | Scheduler |

The public Kawnix manifest should point to the deployed invoke route. The
worker and maintenance routes should not be registered as consumer endpoints.

## Required secrets

Configure these in the hosting platform's secret manager:

- `KAWNIX_PROVIDER_TOKEN`: credential used by Kawnix for `/invoke`.
- `KAWNIX_WORKER_TOKEN`: separate credential used by the worker and maintenance
  schedulers.
- `APP_ID`: provider-owned GitHub App ID.
- `PRIVATE_KEY`: provider-owned GitHub App private key.
- `GEMINI_API_KEY`: Gemini API credential.
- `DATABASE_URL`: Supabase PostgreSQL connection string.

Configure `KAWNIX_REPOSITORY_ACCESS` as a non-secret or protected secret
depending on the platform:

```json
{"<sha256-of-provider-token>":["organization/repository"]}
```

Store only the SHA-256 token hash in this mapping. Never store the raw bearer
token in repository-access configuration.

The GitHub App should have:

- Metadata: read.
- Contents: read.
- Pull requests: read.
- Pull requests: write only when publication mode is enabled.

### Supabase database setup

The Kawnix provider uses PostgreSQL directly through the `pg` package; it does
not require the Supabase JavaScript SDK. Create a Supabase project, open
**Connect**, and copy a PostgreSQL connection string.

For a hosted Node.js or serverless deployment, prefer the **Session pooler**
connection string. Use the **Direct** connection only when the runtime has IPv6
connectivity. Set the copied value as `DATABASE_URL` and keep
`sslmode=require` in the query string:

```env
DATABASE_URL=postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require
```

The application creates the `kawnix_review_jobs` table and its indexes
automatically on the first database operation. No separate migration is
required. The Supabase database password is part of the connection string, so
store `DATABASE_URL` only in the local `.env` file or the hosting platform's
secret manager.

## Build and deploy

From the repository root:

```powershell
npm ci
npm test -- --runInBand
npx tsc --noEmit --pretty false
npm run build
npm run kawnix:preflight
```

Run the preflight after replacing the placeholders in
`KAWNIX_MANIFEST.example.json`. It checks production configuration, the
manifest, and the HTTPS endpoint without contacting GitHub or Gemini. The
command exits with status `1` when a check fails.

The build must produce:

```text
dist/api/kawnix/invoke/index.js
dist/api/kawnix/worker/index.js
dist/api/kawnix/maintenance/index.js
```

Deploy the generated routes using the hosting platform's Node.js 18+
serverless or server runtime. The worker and maintenance handlers require
Node.js APIs and must not be deployed as edge-only functions.

## Scheduler configuration

The worker processes one job per call. Configure a scheduler to call it
frequently enough for the expected queue latency. A five-minute interval is a
reasonable initial value:

```text
POST https://<provider-domain>/api/kawnix/worker
Authorization: Bearer <KAWNIX_WORKER_TOKEN>
```

The maintenance route can run hourly:

```text
POST https://<provider-domain>/api/kawnix/maintenance
Authorization: Bearer <KAWNIX_WORKER_TOKEN>
```

Use a scheduler or queue service that supports:

- HTTPS POST requests.
- Secret/header storage.
- Retry on 5xx responses.
- Timeout configuration.
- Delivery logs.

Do not put either scheduler token in a URL query string.

## Readiness checks

Call the provider health operation with the provider token:

```powershell
$body = '{"operation":"health"}'
Invoke-RestMethod `
  -Method Post `
  -Uri 'https://<provider-domain>/api/kawnix/invoke' `
  -Headers @{ Authorization = 'Bearer <KAWNIX_PROVIDER_TOKEN>' } `
  -ContentType 'application/json' `
  -Body $body
```

The response must show:

```json
{
  "success": true,
  "data": {
    "status": "ready",
    "configuration": {
      "production_ready": true,
      "missing": []
    }
  }
}
```

The health response does not expose secret values. If configuration is
missing, correct the named environment settings before registering the
manifest in Kawnix.

## First controlled review

1. Install the GitHub App on one dedicated test repository.
2. Add that repository to `KAWNIX_REPOSITORY_ACCESS`.
3. Create a test pull request.
4. Invoke `start` with `publishing_mode: "report_only"`.
5. Confirm the worker scheduler processes the job.
6. Poll `status` until it is `completed`.
7. Verify the result contains structured findings.
8. Only after report-only succeeds, test `pull_request_review`.
9. Repeat the same request and confirm no duplicate GitHub review is created.

## Kawnix registration

Register only the invoke endpoint:

```text
https://<provider-domain>/api/kawnix/invoke
```

Use the provider manifest's declared operations and schemas. Keep report-only
as the default publication mode. Run Kawnix preflight before submitting the
manifest for approval.

## Incident response

If the provider is unsafe or unstable:

1. Disable new job creation at the hosting layer or Kawnix endpoint.
2. Remove publication permission from the GitHub App if necessary.
3. Stop the worker scheduler.
4. Preserve the PostgreSQL job records for investigation.
5. Rotate the provider and worker tokens if exposure is suspected.
6. Publish a new manifest version after the fix.

Never print `KAWNIX_PROVIDER_TOKEN`, `KAWNIX_WORKER_TOKEN`, `PRIVATE_KEY`,
`GEMINI_API_KEY`, or `DATABASE_URL` in logs.
