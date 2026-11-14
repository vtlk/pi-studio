export const AGENT_BROWSER_VERSION = '0.43.0';
export const CHROME_VERSION = '157.0.8103.78';
export const chromeArchives = {
  arm64: '17bf66d53c1b1104dcb641c5b331cd4ac5d200c778f5feed0934a0b92deaf8d6',
  x64: 'f1a6a9561eaf1f409849538de663695d36d72fbf1ebca4d42e47c7b5f2a157f3',
} as const;
export const agentBrowserArchives = {
  arm64: 'HV6GP59IjNnowlrXR/5rVM8msPWwQDEONt/tWC8STzUfKZQHKZI/Iv9sf2h2ZhwK8xwoqLhxpf+KxcFgJ0sExQ==',
  x64: '3NKnKFOWLYDYTz4bJxo4jt+GwjM4VtcW5FDrQY35eUrytig65FEDdXmXKuRbZGq9jEEWxh6rmpS4R6xS53XCaw==',
} as const;

export function browserArchive(arch: string) {
  if (arch !== 'arm64' && arch !== 'x64')
    throw new Error('Архитектура браузера не поддерживается.');
  return {
    arch,
    url: `https://registry.npmjs.org/@agent-browser/cli-darwin-${arch}/-/cli-darwin-${arch}-${AGENT_BROWSER_VERSION}.tgz`,
    integrity: agentBrowserArchives[arch],
  };
}

export function chromeArchive(arch: string) {
  if (arch !== 'arm64' && arch !== 'x64')
    throw new Error('Архитектура браузера не поддерживается.');
  return {
    arch,
    folder: `chrome-headless-shell-mac-${arch}`,
    url: `https://storage.googleapis.com/chrome-for-testing-public/${CHROME_VERSION}/mac-${arch}/chrome-headless-shell-mac-${arch}.zip`,
    integrity: chromeArchives[arch],
  };
}
