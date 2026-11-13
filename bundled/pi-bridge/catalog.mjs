import { pathToFileURL } from 'node:url';
import { catalogData } from './catalog-data.mjs';
try {
  const sdk = await import(pathToFileURL(process.argv[2]).href);
  const runtime = await sdk.ModelRuntime.create({ allowModelNetwork: false, refreshOnCreate: true });
  process.stdout.write(JSON.stringify(await catalogData(sdk, runtime, process.argv[3])));
} catch {
  process.stderr.write('Pi model catalog is unavailable.\n');
  process.exitCode = 1;
}
