const electron = require('electron');
const Module = require('node:module');
const { resolve, relative, sep } = require('node:path');
const { realpathSync } = require('node:fs');
const { tmpdir } = require('node:os');

let configured = false;
module.exports.configureQaRuntime = () => {
  if (configured) return;
  const temporary = realpathSync(tmpdir());
  const data = realpathSync(electron.app.getPath('userData'));
  const location = relative(temporary, data);
  if (!location || location === '..' || location.startsWith('..' + sep))
    throw Error('QA requires its own userData directory inside the temporary directory.');
  if (electron.app.isReady()) throw Error('Configure QA before Electron ready.');
  electron.app.setPath('sessionData', data);
  // Never ask the user to grant an unsigned QA process their production Keychain key.
  // Chromium's official test provider still exercises native async encryption/decryption.
  electron.app.commandLine.appendSwitch('use-mock-keychain');
  const setName = electron.app.setName.bind(electron.app);
  electron.app.setName = () => setName('Pi Studio QA');
  electron.app.setName();
  if (process.platform === 'darwin') electron.app.setActivationPolicy('accessory');
  configured = true;
};

// Scope the constructor override to our compiled entry. Production Electron is unchanged.
module.exports.loadOffscreenMain = (mainEntry) => {
  module.exports.configureQaRuntime();
  // Offscreen QA must not appear as a second Studio in the user's Dock or app switcher.
  if (process.platform === 'darwin') electron.app.setActivationPolicy('accessory');
  const OriginalWindow = electron.BrowserWindow;
  class OffscreenWindow extends OriginalWindow {
    constructor(options) {
      super({
        ...options,
        show: false,
        webPreferences: { ...options.webPreferences, offscreen: true, backgroundThrottling: false },
      });
      this.webContents.setFrameRate(30);
    }
  }
  const replacement = new Proxy(electron, {
    get(target, key) {
      return key === 'BrowserWindow' ? OffscreenWindow : Reflect.get(target, key);
    },
  });
  const entry = realpathSync(
    mainEntry ? resolve(mainEntry) : resolve(__dirname, '../out/main/index.cjs'),
  );
  const originalLoad = Module._load;
  Module._load = function (id, parent, isMain) {
    if (id === 'electron' && parent?.filename === entry) return replacement;
    return originalLoad.call(this, id, parent, isMain);
  };
  try {
    require(entry);
  } finally {
    Module._load = originalLoad;
  }
};
