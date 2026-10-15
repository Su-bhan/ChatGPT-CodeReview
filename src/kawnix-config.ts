export type KawnixConfigEnvironment = Record<string, string | undefined>;

export type KawnixConfigStatus = {
  providerAuthentication: boolean;
  workerAuthentication: boolean;
  githubApp: boolean;
  gemini: boolean;
  database: boolean;
  repositoryAccess: boolean;
  productionReady: boolean;
  missing: string[];
};

export type KawnixPreflightResult = {
  ready: boolean;
  configuration: KawnixConfigStatus;
  checks: {
    manifest: { ok: boolean; message: string };
    publicUrl: { ok: boolean; message: string };
  };
};

export const getKawnixConfigStatus = (
  environment: KawnixConfigEnvironment = process.env
): KawnixConfigStatus => {
  const providerAuthentication = Boolean(environment.KAWNIX_PROVIDER_TOKEN);
  const workerAuthentication = Boolean(environment.KAWNIX_WORKER_TOKEN);
  const githubApp = Boolean(
    environment.APP_ID && environment.PRIVATE_KEY?.includes('-----BEGIN')
  );
  const gemini = Boolean(environment.GEMINI_API_KEY);
  const database = Boolean(environment.DATABASE_URL);
  const repositoryAccess = Boolean(environment.KAWNIX_REPOSITORY_ACCESS);
  const missing: string[] = [];

  if (!providerAuthentication) missing.push('KAWNIX_PROVIDER_TOKEN');
  if (!workerAuthentication) missing.push('KAWNIX_WORKER_TOKEN');
  if (!githubApp) missing.push('APP_ID/PRIVATE_KEY');
  if (!gemini) missing.push('GEMINI_API_KEY');
  if (!database) missing.push('DATABASE_URL');
  if (!repositoryAccess) missing.push('KAWNIX_REPOSITORY_ACCESS');

  return {
    providerAuthentication,
    workerAuthentication,
    githubApp,
    gemini,
    database,
    repositoryAccess,
    productionReady: missing.length === 0,
    missing,
  };
};

export const runKawnixPreflight = ({
  environment = process.env,
  manifest,
}: {
  environment?: KawnixConfigEnvironment;
  manifest: unknown;
}): KawnixPreflightResult => {
  const configuration = getKawnixConfigStatus(environment);
  const manifestRecord =
    typeof manifest === 'object' && manifest !== null
      ? (manifest as Record<string, unknown>)
      : undefined;
  const endpoint =
    typeof manifestRecord?.endpoint === 'object' &&
    manifestRecord.endpoint !== null
      ? (manifestRecord.endpoint as Record<string, unknown>)
      : undefined;
  const publicUrl = typeof endpoint?.url === 'string' ? endpoint.url : '';
  const manifestIsObject = Boolean(manifestRecord);
  const manifestHasPlaceholder =
    JSON.stringify(manifest).includes('<') ||
    JSON.stringify(manifest).includes('>');
  const manifestCheck = manifestIsObject && !manifestHasPlaceholder
    ? { ok: true, message: 'Manifest is complete.' }
    : {
        ok: false,
        message: manifestIsObject
          ? 'Manifest still contains angle-bracket placeholders.'
          : 'Manifest must be a JSON object.',
      };
  let publicUrlCheck: { ok: boolean; message: string };
  try {
    const parsedUrl = new URL(publicUrl);
    publicUrlCheck =
      parsedUrl.protocol === 'https:'
        ? { ok: true, message: 'Manifest endpoint uses HTTPS.' }
        : { ok: false, message: 'Manifest endpoint must use HTTPS.' };
  } catch {
    publicUrlCheck = {
      ok: false,
      message: 'Manifest endpoint URL is missing or invalid.',
    };
  }

  return {
    ready:
      configuration.productionReady &&
      manifestCheck.ok &&
      publicUrlCheck.ok,
    configuration,
    checks: {
      manifest: manifestCheck,
      publicUrl: publicUrlCheck,
    },
  };
};
