import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { runKawnixPreflight } from './kawnix-config.js';

const manifestPath = resolve(
  process.argv[2] ?? 'KAWNIX_MANIFEST.example.json'
);

let manifest: unknown;
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
} catch (error) {
  const message = error instanceof Error ? error.message : 'Unknown error';
  console.error(`Unable to read manifest ${manifestPath}: ${message}`);
  process.exitCode = 1;
} 

if (manifest !== undefined) {
  const result = runKawnixPreflight({ manifest });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ready) {
    process.exitCode = 1;
  }
}
