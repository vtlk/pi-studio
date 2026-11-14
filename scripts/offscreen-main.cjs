const electron = require('electron');
const Module = require('node:module');
const { resolve } = require('node:path');

// Scope the constructor override to our compiled entry. Production Electron is unchanged.
module.exports.loadOffscreenMain = (mainEntry) => {
  const OriginalWindow = electron.BrowserWindow;
  class OffscreenWindow extends OriginalWindow {
    constructor(options) {
      super({
        ...options,
        show: false,
        webPreferences: { ...options.webPreferences, offscreen: true },
      });
      this.webContents.setFrameRate(30);
    }
  }
  const replacement = new Proxy(electron, {
    get(target, key) {
      return key === 'BrowserWindow' ? OffscreenWindow : Reflect.get(target, key);
    },
  });
  const entry = mainEntry ? resolve(mainEntry) : resolve(__dirname, '../out/main/index.cjs');
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
