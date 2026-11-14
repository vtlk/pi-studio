import { pathToFileURL } from 'node:url';
import { catalogData } from './catalog-data.mjs';
import { createConnectionRuntime } from './connection-runtime.mjs';
try {
  const sdk = await import(pathToFileURL(process.argv[2]).href);
  const runtime = await createConnectionRuntime(sdk, undefined, process.argv[3]);
  process.stdout.write(JSON.stringify(await catalogData(sdk, runtime, process.argv[3], undefined, process.argv[2])));
} catch {
  process.stderr.write('Pi model catalog is unavailable.\n');
  process.exitCode = 1;
}
