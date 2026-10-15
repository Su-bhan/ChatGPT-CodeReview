export const KAWNIX_INVOKE_ROUTE = '/invoke';
export const KAWNIX_MAX_REQUEST_BYTES = 64 * 1024;
export const KAWNIX_MAX_PROMPT_LENGTH = 2_000;
export const KAWNIX_MAX_PATTERN_COUNT = 100;
export const KAWNIX_MAX_PATTERN_LENGTH = 256;

export const KAWNIX_OPERATIONS = ['health', 'start', 'status'] as const;
export const KAWNIX_PUBLISHING_MODES = [
  'report_only',
  'pull_request_review',
] as const;

export type KawnixOperation = (typeof KAWNIX_OPERATIONS)[number];
export type KawnixPublishingMode = (typeof KAWNIX_PUBLISHING_MODES)[number];

export type KawnixRepository = {
  owner: string;
  name: string;
};

export type KawnixStartInput = {
  operation: 'start';
  repository: KawnixRepository;
  pull_request_number: number;
  commit_sha?: string;
  publishing_mode?: KawnixPublishingMode;
  prompt?: string;
  include_patterns?: string[];
  ignore_patterns?: string[];
  idempotency_key?: string;
};

export type KawnixStatusInput = {
  operation: 'status';
  job_id: string;
};

export type KawnixHealthInput = {
  operation: 'health';
};

export type KawnixProviderInput =
  | KawnixHealthInput
  | KawnixStartInput
  | KawnixStatusInput;

export type KawnixValidationError = {
  code: string;
  message: string;
};

export type KawnixValidationResult =
  | { ok: true; input: KawnixProviderInput }
  | { ok: false; error: KawnixValidationError };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const validatePatterns = (
  value: unknown,
  field: string
): KawnixValidationError | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (
    !Array.isArray(value) ||
    value.length > KAWNIX_MAX_PATTERN_COUNT ||
    value.some(
      (pattern) =>
        typeof pattern !== 'string' ||
        pattern.trim().length === 0 ||
        pattern.length > KAWNIX_MAX_PATTERN_LENGTH
    )
  ) {
    return {
      code: 'invalid_request',
      message: `${field} must contain at most ${KAWNIX_MAX_PATTERN_COUNT} non-empty strings of at most ${KAWNIX_MAX_PATTERN_LENGTH} characters.`,
    };
  }

  return undefined;
};

const validateRepository = (
  value: unknown
): KawnixRepository | KawnixValidationError => {
  if (!isRecord(value) || !isNonEmptyString(value.owner) || !isNonEmptyString(value.name)) {
    return {
      code: 'invalid_request',
      message: 'repository must contain non-empty owner and name fields.',
    };
  }

  if (
    value.owner.length > 100 ||
    value.name.length > 100 ||
    value.owner.includes('/') ||
    value.name.includes('/')
  ) {
    return {
      code: 'invalid_request',
      message: 'repository owner and name must be simple GitHub identifiers.',
    };
  }

  return {
    owner: value.owner.trim(),
    name: value.name.trim(),
  };
};

export const validateKawnixInput = (value: unknown): KawnixValidationResult => {
  if (!isRecord(value) || typeof value.operation !== 'string') {
    return {
      ok: false,
      error: {
        code: 'invalid_request',
        message: 'operation is required.',
      },
    };
  }

  if (value.operation === 'health') {
    if (Object.keys(value).length !== 1) {
      return {
        ok: false,
        error: {
          code: 'invalid_request',
          message: 'health does not accept additional fields.',
        },
      };
    }

    return { ok: true, input: { operation: 'health' } };
  }

  if (value.operation === 'status') {
    if (!isNonEmptyString(value.job_id) || value.job_id.length > 256) {
      return {
        ok: false,
        error: {
          code: 'invalid_request',
          message: 'job_id must be a non-empty string of at most 256 characters.',
        },
      };
    }

    return {
      ok: true,
      input: { operation: 'status', job_id: value.job_id.trim() },
    };
  }

  if (value.operation !== 'start') {
    return {
      ok: false,
      error: {
        code: 'invalid_request',
        message: 'operation must be health, start, or status.',
      },
    };
  }

  const repository = validateRepository(value.repository);
  if ('code' in repository) {
    return { ok: false, error: repository };
  }

  if (
    typeof value.pull_request_number !== 'number' ||
    !Number.isInteger(value.pull_request_number) ||
    value.pull_request_number < 1
  ) {
    return {
      ok: false,
      error: {
        code: 'invalid_request',
        message: 'pull_request_number must be a positive integer.',
      },
    };
  }

  if (
    value.commit_sha !== undefined &&
    (!isNonEmptyString(value.commit_sha) || value.commit_sha.length > 128)
  ) {
    return {
      ok: false,
      error: {
        code: 'invalid_request',
        message: 'commit_sha must be a non-empty string of at most 128 characters.',
      },
    };
  }

  const publishingMode =
    value.publishing_mode === undefined ? 'report_only' : value.publishing_mode;
  if (
    publishingMode !== 'report_only' &&
    publishingMode !== 'pull_request_review'
  ) {
    return {
      ok: false,
      error: {
        code: 'invalid_request',
        message: 'publishing_mode is not supported.',
      },
    };
  }

  if (
    value.prompt !== undefined &&
    (!isNonEmptyString(value.prompt) || value.prompt.length > KAWNIX_MAX_PROMPT_LENGTH)
  ) {
    return {
      ok: false,
      error: {
        code: 'invalid_request',
        message: `prompt must be a non-empty string of at most ${KAWNIX_MAX_PROMPT_LENGTH} characters.`,
      },
    };
  }

  const includePatternsError = validatePatterns(
    value.include_patterns,
    'include_patterns'
  );
  if (includePatternsError) {
    return { ok: false, error: includePatternsError };
  }

  const ignorePatternsError = validatePatterns(
    value.ignore_patterns,
    'ignore_patterns'
  );
  if (ignorePatternsError) {
    return { ok: false, error: ignorePatternsError };
  }

  if (
    value.idempotency_key !== undefined &&
    (!isNonEmptyString(value.idempotency_key) || value.idempotency_key.length > 256)
  ) {
    return {
      ok: false,
      error: {
        code: 'invalid_request',
        message: 'idempotency_key must be a non-empty string of at most 256 characters.',
      },
    };
  }

  const includePatterns = value.include_patterns as string[] | undefined;
  const ignorePatterns = value.ignore_patterns as string[] | undefined;

  return {
    ok: true,
    input: {
      operation: 'start',
      repository,
      pull_request_number: value.pull_request_number,
      commit_sha: value.commit_sha?.trim(),
      publishing_mode: publishingMode,
      prompt: value.prompt?.trim(),
      include_patterns: includePatterns?.map((pattern) => pattern.trim()),
      ignore_patterns: ignorePatterns?.map((pattern) => pattern.trim()),
      idempotency_key: value.idempotency_key?.trim(),
    },
  };
};
