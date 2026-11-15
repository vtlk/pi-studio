import { cp, readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Copy the published SDK and its matching N-API runtime without install scripts or global tools. */
export async function packageCua(
  root,
  application,
  architecture,
  platform = 'darwin',
  nativeDirectory,
) {
  if (!['arm64', 'x64'].includes(architecture)) throw new Error('Unsupported Cua architecture.');
  const sdk = '@trycua/cua-driver',
    native =
      platform === 'win32' ? `${sdk}-win32-${architecture}-msvc` : `${sdk}-darwin-${architecture}`;
  const expected = '0.49.11';
  for (const name of [sdk, native]) {
    const metadata = JSON.parse(
      await readFile(
        name === native && nativeDirectory
          ? join(nativeDirectory, 'package.json')
          : join(root, 'node_modules', name, 'package.json'),
        'utf8',
      ),
    );
    if (metadata.version !== expected)
      throw new Error('Cua SDK/native versions must match the pinned release.');
  }
  for (const name of [sdk, native, '@ubjs/core', '@ubjs/node'])
    await cp(
      name === native && nativeDirectory ? nativeDirectory : join(root, 'node_modules', name),
      join(application, 'node_modules', name),
      {
        recursive: true,
      },
    );
  for (const name of ['Cua-MIT.txt', 'MPL-2.0.txt', 'Cua-SOURCES.md'])
    await cp(join(root, 'third-party-licenses', name), join(application, 'licenses', name));
  await cp(
    nativeDirectory
      ? join(nativeDirectory, 'node-runtime-NOTICE.md')
      : join(root, 'node_modules', native, 'node-runtime-NOTICE.md'),
    join(application, 'licenses/Cua-node-runtime-NOTICE.md'),
  );
  return (
    platform === 'win32'
      ? ['cua_driver_sdk.dll', 'cua_driver_node_runtime.node']
      : ['libcua_driver_sdk.dylib', 'cua_driver_node_runtime.node']
  ).map((name) => join(application, 'node_modules', native, name));
}
