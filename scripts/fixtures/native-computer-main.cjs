// Temporary signed/accessory host only. Never included in the application bundle.
const { app, screen, BrowserWindow } = require('electron');
app.setActivationPolicy('accessory');
// This host has no persistent Studio window; idle overlay disposal must not quit it.
app.on('window-all-closed', () => {});
const { readFile, writeFile } = require('node:fs/promises');
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');
const configPath = process.argv.find((arg) => arg.startsWith('--qa-config='))?.slice(12);
let runtime, root, timer;
const fatal = (error) => {
  console.error(error);
  if (root) {
    try {
      writeFileSync(
        join(root, 'failure.json'),
        JSON.stringify({ message: error.message, stack: error.stack }),
      );
    } catch {}
  }
  app.exit(1);
};
process.on('uncaughtException', fatal);
process.on('unhandledRejection', fatal);
(async () => {
  assert.ok(configPath, 'Native QA configuration required');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  root = config.root;
  assert.ok(root.includes('/pistudio-native-computer-'));
  app.setPath('userData', join(root, 'userData'));
  app.setPath('videos', join(root, 'videos'));
  require('./offscreen-main.cjs').configureQaRuntime();
  writeFileSync(
    join(root, 'driver-starting.json'),
    JSON.stringify({ nonce: config.nonce, pid: process.pid }),
  );
  timer = setTimeout(() => app.exit(2), config.modelSelection ? 300000 : 90000);
  await app.whenReady();
  process.env.ELECTRON_RENDERER_URL = pathToFileURL(join(__dirname, 'out/renderer')).href;
  const { CuaRuntime, ComputerOverlay, runNativeVisualModel } = require('./computer-runtime.cjs');
  class ObservedOverlay extends ComputerOverlay {
    points = [];
    async begin(...args) {
      try {
        return await super.begin(...args);
      } catch (error) {
        writeFileSync(
          join(root, 'overlay-error.json'),
          JSON.stringify({ message: error.message, stack: error.stack }),
        );
        throw error;
      }
    }
    async pointer(session, point, click) {
      if (point) this.points.push({ ...point, click: !!click });
      return super.pointer(session, point, click);
    }
  }
  const feedback = new ObservedOverlay();
  const metadata = [];
  runtime = new CuaRuntime({
    feedback,
    driver: async () => {
      const sdk = await import('@trycua/cua-driver');
      const driver = await sdk.CuaDriver.createConfigured(
        sdk.ConfiguredDriverOptions.new({
          claudeCodeCompatibility: false,
          authorization: sdk.RuntimeAuthorizationOptions.new({
            allowedModes: [sdk.SessionPermissionMode.Standard],
            compatibilityMode: sdk.SessionPermissionMode.Standard,
            unrestrictedAcknowledged: false,
            maxSessionTtlSeconds: 28800n,
            maxIdleTtlSeconds: 300n,
          }),
        }),
      );
      return new Proxy(driver, {
        get(target, key) {
          if (key === 'callTool')
            return async (...args) => {
              const result = await target.callTool(...args);
              if (['get_window_state', 'list_windows'].includes(args[0])) {
                metadata.push({ tool: args[0], data: JSON.parse(result.structuredJson || '{}') });
                writeFileSync(join(root, 'native-metadata.json'), JSON.stringify(metadata));
              }
              return result;
            };
          const value = Reflect.get(target, key, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    },
  });
  const permissions = await runtime.permissions();
  await writeFile(
    join(root, 'driver-ready.json'),
    JSON.stringify({
      nonce: config.nonce,
      pid: process.pid,
      permissions,
      toolSchemas: await runtime.tools(),
    }),
  );
  if (!permissions.accessibility || !permissions.screenRecording) {
    await writeFile(
      join(root, 'result.json'),
      JSON.stringify({
        nonce: config.nonce,
        permissions,
        actualActions: false,
        reason: 'permissions_required',
      }),
    );
  } else {
    let target;
    for (let i = 0; i < 200; i++) {
      target = await readFile(join(root, 'target-state.json'), 'utf8')
        .then(JSON.parse)
        .catch(() => undefined);
      if (target?.nonce === config.nonce) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(target?.nonce, config.nonce);
    if (config.modelSelection) {
      const pointerBefore = screen.getCursorScreenPoint();
      const originalTarget = JSON.parse(await readFile(join(root, 'target-state.json'), 'utf8'));
      const expectedCode = await readFile(join(root, 'visual-code.txt'), 'utf8');
      const modelResult = await runNativeVisualModel(
        root,
        runtime,
        target,
        config.modelSelection,
        expectedCode,
      );
      const finalTarget = JSON.parse(await readFile(join(root, 'target-state.json'), 'utf8'));
      assert.equal(finalTarget.frontmostPid, originalTarget.frontmostPid);
      assert.equal(finalTarget.key, false);
      assert.equal(finalTarget.main, false);
      assert.deepEqual(screen.getCursorScreenPoint(), pointerBefore);
      await writeFile(
        join(root, 'result.json'),
        JSON.stringify({
          nonce: config.nonce,
          permissions,
          ...modelResult,
          userFrontmostApplicationUnchanged: true,
          hardwarePointerUnchanged: true,
        }),
      );
    } else {
      const signal = AbortSignal.timeout(45000),
        session = 'owned-native-' + config.nonce;
      runtime.identify(session, 'QA native computer');
      const readWindow = () =>
        runtime.call(
          session,
          'get_window_state',
          {
            pid: target.pid,
            window_id: target.windowId,
            include_screenshot: true,
            include_accessibility_tree: true,
            max_image_dimension: 1280,
            tree_format: 'both',
          },
          signal,
        );
      const before = await readWindow();
      const images = before.content.filter((item) => item.type === 'image');
      const text = before.content
        .filter((item) => item.type === 'text')
        .map((item) => item.text)
        .join('\n');
      await writeFile(
        join(root, 'window-before.json'),
        JSON.stringify({
          isError: before.isError,
          text,
          imageCount: images.length,
        }),
      );
      if (images.length)
        await writeFile(join(root, 'window-before.png'), Buffer.from(images[0].data, 'base64'));
      assert.notEqual(before.isError, true);
      assert.equal(images.length, 1);
      assert.ok(text.includes('PI_STUDIO_QA_NATIVE'));
      const pointerBefore = screen.getCursorScreenPoint();
      const originalTarget = JSON.parse(await readFile(join(root, 'target-state.json'), 'utf8'));
      assert.equal(originalTarget.key, false);
      assert.equal(originalTarget.main, false);
      assert.notEqual(originalTarget.frontmostPid, target.pid);
      assert.notEqual(originalTarget.frontmostPid, process.pid);
      const token = (body, role) => {
        const snapshot = body.match(/snapshot_id=(s[0-9a-f]{8})/)?.[1];
        const index = body.match(new RegExp('\\[(\\d+)\\] ' + role))?.[1];
        assert.ok(snapshot && index);
        return `${snapshot}:${index}`;
      };
      const replacement = 'PI_STUDIO_QA_NATIVE — проверка 86';
      const edited = await runtime.call(
        session,
        'set_value',
        {
          pid: target.pid,
          window_id: target.windowId,
          element_token: token(text, 'AXTextField'),
          value: replacement,
        },
        signal,
      );
      await writeFile(
        join(root, 'edit-result.json'),
        JSON.stringify(edited.content.filter((part) => part.type === 'text')),
      );
      assert.notEqual(edited.isError, true);
      await new Promise((resolve) => setTimeout(resolve, 250));
      const changed = JSON.parse(await readFile(join(root, 'target-state.json'), 'utf8'));
      assert.equal(changed.text, replacement);
      assert.equal(changed.frontmostPid, originalTarget.frontmostPid);
      assert.deepEqual(screen.getCursorScreenPoint(), pointerBefore);
      const fresh = await readWindow();
      const freshText = fresh.content
        .filter((item) => item.type === 'text')
        .map((item) => item.text)
        .join('\n');
      assert.ok(freshText.includes(replacement));
      const pressed = await runtime.call(
        session,
        'click',
        {
          pid: target.pid,
          window_id: target.windowId,
          element_token: token(freshText, 'AXButton'),
          delivery_mode: 'background',
        },
        signal,
      );
      await writeFile(
        join(root, 'click-result.json'),
        JSON.stringify(pressed.content.filter((part) => part.type === 'text')),
      );
      assert.notEqual(pressed.isError, true);
      await new Promise((resolve) => setTimeout(resolve, 250));
      const finalTarget = JSON.parse(await readFile(join(root, 'target-state.json'), 'utf8'));
      assert.equal(finalTarget.presses, 1);
      assert.equal(finalTarget.text, replacement);
      assert.equal(finalTarget.frontmostPid, originalTarget.frontmostPid);
      assert.deepEqual(screen.getCursorScreenPoint(), pointerBefore);
      const clickPoint = feedback.points.findLast((point) => point.click);
      assert.ok(clickPoint, 'Real Cua metadata must ground the visible click cursor');
      assert.ok(
        Math.abs(clickPoint.x - finalTarget.buttonCenterX) < 2,
        JSON.stringify({ clickPoint, finalTarget }),
      );
      assert.ok(
        Math.abs(clickPoint.y - finalTarget.buttonCenterY) < 2,
        JSON.stringify({ clickPoint, finalTarget }),
      );
      const pointerSurface = BrowserWindow.getAllWindows()[0];
      const surfaceState = {
        bounds: pointerSurface.getBounds(),
        content: pointerSurface.getContentBounds(),
        display: screen.getAllDisplays()[0].bounds,
        renderer: await pointerSurface.webContents.executeJavaScript(
          '({screenX,screenY,width:innerWidth,height:innerHeight,point:(()=>{const r=document.querySelector(".computer-pointer")?.getBoundingClientRect(); return r?{x:r.x,y:r.y}:null})()})',
        ),
      };
      await writeFile(join(root, 'surface-state.json'), JSON.stringify(surfaceState));
      assert.deepEqual(
        surfaceState.content,
        surfaceState.display,
        'Native overlay content must match the display, including its origin',
      );
      await writeFile(join(root, 'overlay.png'), (await pointerSurface.capturePage()).toPNG());
      const after = await readWindow();
      const afterImage = after.content.find((item) => item.type === 'image');
      assert.ok(afterImage);
      await writeFile(join(root, 'window-after.png'), Buffer.from(afterImage.data, 'base64'));
      const overlays = BrowserWindow.getAllWindows();
      assert.equal(overlays.length, screen.getAllDisplays().length);
      assert.ok(
        overlays.every(
          (window) => window.isVisible() && !window.isFocusable() && !window.isFocused(),
        ),
        JSON.stringify(
          overlays.map((window) => ({
            visible: window.isVisible(),
            focusable: window.isFocusable(),
            focused: window.isFocused(),
            bounds: window.getBounds(),
          })),
        ),
      );
      assert.ok(
        await overlays[0].webContents.executeJavaScript(
          'document.body.innerText.includes("QA native computer")',
        ),
      );
      await writeFile(
        join(root, 'result.json'),
        JSON.stringify({
          nonce: config.nonce,
          permissions,
          targetPid: target.pid,
          windowId: target.windowId,
          captureIsError: !!before.isError,
          captureImageCount: images.length,
          actualActions: true,
          stage: 'capture-input-capture',
          backgroundValueReadback: finalTarget.text,
          exactButtonPresses: finalTarget.presses,
          hardwarePointerUnchanged: true,
          userFrontmostApplicationUnchanged: true,
          targetNeverKeyOrMain: !finalTarget.key && !finalTarget.main,
          actualNativeOverlaySurfaces: overlays.length,
          actualRetinaCursorMatchesAppKitButtonCenter: true,
          overlayVisibleNonFocusableAndLabeled: true,
          overlayContentMatchesDisplayBounds: true,
        }),
      );
      await runtime.release(session);
      assert.equal(BrowserWindow.getAllWindows().length, 0);
    }
  }
  await runtime.close();
  runtime = undefined;
  clearTimeout(timer);
  app.exit(0);
})().catch(async (error) => {
  console.error(error);
  if (root)
    await writeFile(
      join(root, 'failure.json'),
      JSON.stringify({ message: error.message, stack: error.stack }),
    ).catch(() => {});
  clearTimeout(timer);
  await runtime?.close().catch(() => {});
  app.exit(1);
});
