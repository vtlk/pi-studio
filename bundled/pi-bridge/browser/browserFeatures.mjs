import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { privatePath, saveDownload, regularFile } from './files.mjs';
import { openDevTools } from './openDevTools.mjs';

const result = (value) => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
const need = (args, ...keys) => {
  if (keys.some((key) => args[key] === undefined))
    throw new Error('Не хватает параметров: ' + keys.join(', '));
};

export async function browserFeatureCall(browser, name, args) {
  if (name === 'browser_diagnostics') {
    if (args.action === 'request') {
      need(args, 'requestId');
      return browser.invoke('agent_browser_network_request', { requestId: args.requestId });
    }
    return browser.invoke(
      'agent_browser_' + (args.action === 'requests' ? 'network_requests' : args.action),
      {
        ...(args.filter && args.action === 'requests' ? { filter: args.filter } : {}),
      },
    );
  }
  if (name === 'browser_devtools') {
    browser.observed = false;
    if (!browser.headed) throw new Error('DevTools открываются только в видимом браузере.');
    return openDevTools(browser);
  }
  if (name === 'browser_capture') {
    await privatePath(browser.binding.outputRoot, args.output, true);
    const file = `capture-${randomUUID()}.${args.format}`;
    try {
      await browser.invoke('agent_browser_' + (args.format === 'pdf' ? 'pdf' : 'screenshot'), {
        path: join(browser.downloads, file),
        ...(args.format === 'png' ? { format: 'png', fullPage: args.fullPage ?? false } : {}),
      });
      browser.observed = false;
      return result(
        await saveDownload(browser.downloads, file, browser.binding.outputRoot, args.output),
      );
    } finally {
      await rm(join(browser.downloads, file), { force: true });
    }
  }
  if (name === 'browser_emulate') {
    browser.observed = false;
    if (args.action === 'viewport') {
      need(args, 'width', 'height');
      await browser.invoke('agent_browser_set_viewport', {
        width: args.width,
        height: args.height,
        scale: 1,
      });
    } else if (args.action === 'device') {
      need(args, 'device');
      await browser.invoke('agent_browser_set_device', { device: args.device });
    } else if (args.action === 'geolocation') {
      need(args, 'latitude', 'longitude');
      await browser.invoke('agent_browser_set_geo', {
        latitude: args.latitude,
        longitude: args.longitude,
      });
    } else if (args.action === 'theme') {
      need(args, 'colorScheme');
      await browser.invoke('agent_browser_set_media', { colorScheme: args.colorScheme });
    } else {
      need(args, 'enabled');
      await browser.invoke('agent_browser_set_offline', { enabled: args.enabled });
    }
    if (['viewport', 'device'].includes(args.action)) browser.viewportConfigured = true;
    return browser.screenshot();
  }
  const type = name.replace('browser_', '');
  if (!['trace', 'profile', 'record', 'har'].includes(type)) return undefined;
  browser.captures ??= new Map();
  const pending = browser.captures.get(type);
  if (args.action === 'status')
    return result({
      active: !!pending && !pending.stopped,
      pendingSave: pending?.stopped === true,
    });
  const upstream = type === 'profile' ? 'profiler' : type === 'har' ? 'network_har' : type;
  if (args.action === 'start') {
    if (pending)
      throw new Error('Предыдущая запись ещё активна или ожидает сохранения. Сначала stop.');
    if (type === 'record') {
      need(args, 'output');
      if (!['.webm', '.mp4'].includes(extname(args.output)))
        throw new Error('Для записи укажите .webm или .mp4.');
      await privatePath(browser.binding.outputRoot, args.output, true);
    }
    const file = `${type}-${randomUUID()}${type === 'record' ? extname(args.output) : '.json'}`;
    await browser.invoke(
      `agent_browser_${upstream}_start`,
      type === 'record'
        ? { path: join(browser.downloads, file), cursor: true, fps: args.fps ?? 30 }
        : {},
    );
    browser.captures.set(type, { file, output: args.output, stopped: false });
    return result({ active: true, ...(type === 'record' ? { cursor: true } : {}) });
  }
  if (!pending) throw new Error('Эта запись не запущена в выбранной браузерной сессии.');
  const output = args.output ?? pending.output;
  if (!output) throw new Error('Укажите output для сохранения записи.');
  await privatePath(browser.binding.outputRoot, output, true);
  if (!pending.stopped) {
    // Mark only a confirmed stop; uncertain upstream failures are returned without retry.
    await browser.invoke(
      `agent_browser_${upstream}_stop`,
      type === 'record' ? {} : { path: join(browser.downloads, pending.file) },
      60000,
    );
    pending.stopped = true;
    const { handle } = await regularFile(join(browser.downloads, pending.file));
    await handle.close();
  }
  const saved = await saveDownload(
    browser.downloads,
    pending.file,
    browser.binding.outputRoot,
    output,
  );
  await rm(join(browser.downloads, pending.file), { force: true });
  browser.captures.delete(type);
  return result(saved);
}
