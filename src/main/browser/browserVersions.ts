import { t } from '../../shared/i18n/index.ts';
export const AGENT_BROWSER_VERSION = '0.43.0';
export const CHROME_VERSION = '157.0.8103.78';
export const chromeArchives = {
  arm64: '17bf66d53c1b1104dcb641c5b331cd4ac5d200c778f5feed0934a0b92deaf8d6',
  x64: 'f1a6a9561eaf1f409849538de663695d36d72fbf1ebca4d42e47c7b5f2a157f3',
} as const;
// Official Chrome for Testing archives, independently downloaded and hashed.
export const visibleChromeArchives = {
  arm64: 'bf3b49d0fe62a62397e98641aa736ef813c46014f03ec13d4913442e6966c7fc',
  x64: '8f9590a4e011ba4ea135f50c711f8bf2c7f32b1fac20de68d1b85f010f095ab3',
} as const;
export const agentBrowserArchives = {
  arm64: 'HV6GP59IjNnowlrXR/5rVM8msPWwQDEONt/tWC8STzUfKZQHKZI/Iv9sf2h2ZhwK8xwoqLhxpf+KxcFgJ0sExQ==',
  x64: '3NKnKFOWLYDYTz4bJxo4jt+GwjM4VtcW5FDrQY35eUrytig65FEDdXmXKuRbZGq9jEEWxh6rmpS4R6xS53XCaw==',
} as const;

export const windowsAgentBrowserIntegrity =
  'xhk8wnHk3aiBFSR0pd1Ye3ay2jKjgRardgBJLiB9nXJv0ZkbeP/wh3X7jMiKUfUGE1qqJrKdaM5szQ6iz8/8+w==';
export const windowsChromeSha256 =
  '2138c1583d25d6f3abec5269943b2f430207d87a539895aa9e90cc4697ec0e1f';
export const browserExecutable = () =>
  process.platform === 'win32' ? 'agent-browser.exe' : 'agent-browser';
export const chromeExecutable = (headed = false) =>
  headed
    ? 'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
    : process.platform === 'win32'
      ? 'chrome-headless-shell.exe'
      : 'chrome-headless-shell';
export const chromeFramework = `Google Chrome for Testing.app/Contents/Frameworks/Google Chrome for Testing Framework.framework/Versions/${CHROME_VERSION}/Google Chrome for Testing Framework`;

export function browserArchive(arch: string, platform = process.platform) {
  if (arch !== 'arm64' && arch !== 'x64')
    throw new Error(t('error.browserVersions.unsupportedBrowserArchitecture'));
  if (platform === 'win32') {
    if (arch !== 'x64') throw new Error(t('error.browserVersions.windowsXIsSupported'));
    return {
      arch,
      url: `https://registry.npmjs.org/@agent-browser/cli-win32-x64-msvc/-/cli-win32-x64-msvc-${AGENT_BROWSER_VERSION}.tgz`,
      integrity: windowsAgentBrowserIntegrity,
    };
  }
  return {
    arch,
    url: `https://registry.npmjs.org/@agent-browser/cli-darwin-${arch}/-/cli-darwin-${arch}-${AGENT_BROWSER_VERSION}.tgz`,
    integrity: agentBrowserArchives[arch],
  };
}

export function chromeArchive(arch: string, platform = process.platform, headed = false) {
  if (arch !== 'arm64' && arch !== 'x64')
    throw new Error(t('error.browserVersions.unsupportedBrowserArchitecture'));
  if (headed) {
    if (platform !== 'darwin')
      throw new Error(t('error.browserSupport.visibleBrowserUseIsCurrently'));
    return {
      arch,
      folder: `chrome-mac-${arch}`,
      url: `https://storage.googleapis.com/chrome-for-testing-public/${CHROME_VERSION}/mac-${arch}/chrome-mac-${arch}.zip`,
      integrity: visibleChromeArchives[arch],
    };
  }
  if (platform === 'win32') {
    if (arch !== 'x64') throw new Error(t('error.browserVersions.windowsXIsSupported'));
    return {
      arch,
      folder: 'chrome-headless-shell-win64',
      url: `https://storage.googleapis.com/chrome-for-testing-public/${CHROME_VERSION}/win64/chrome-headless-shell-win64.zip`,
      integrity: windowsChromeSha256,
    };
  }
  return {
    arch,
    folder: `chrome-headless-shell-mac-${arch}`,
    url: `https://storage.googleapis.com/chrome-for-testing-public/${CHROME_VERSION}/mac-${arch}/chrome-headless-shell-mac-${arch}.zip`,
    integrity: chromeArchives[arch],
  };
}
