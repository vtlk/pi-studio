import http from 'node:http';
import https from 'node:https';
const loopback = value => {
  const url = new URL(typeof value === 'string' || value instanceof URL ? value : value.url);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
    throw Error('Isolated QA blocked external network');
};
const fetch = globalThis.fetch;
globalThis.fetch = (url, ...args) => { loopback(url); return fetch(url, ...args); };
for (const module of [http, https]) for (const name of ['request', 'get']) {
  const original = module[name];
  module[name] = (...args) => {
    if (typeof args[0] === 'string' || args[0] instanceof URL) loopback(args[0]);
    else if (!['127.0.0.1', 'localhost', '::1'].includes(args[0]?.hostname ?? args[0]?.host)) throw Error('Isolated QA blocked external network');
    return original(...args);
  };
}
