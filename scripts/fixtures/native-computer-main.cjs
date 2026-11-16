// Temporary signed/accessory host only. Never included in the application bundle.
const { app, screen } = require('electron');
app.setActivationPolicy('accessory');
const { readFile, writeFile } = require('node:fs/promises');
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
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
  timer = setTimeout(() => app.exit(2), 90000);
  await app.whenReady();
  const { CuaRuntime } = require('./computer-runtime.cjs');
  runtime = new CuaRuntime();
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
    const signal = AbortSignal.timeout(45000),
      session = 'owned-native-' + config.nonce;
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
    const after = await readWindow();
    const afterImage = after.content.find((item) => item.type === 'image');
    assert.ok(afterImage);
    await writeFile(join(root, 'window-after.png'), Buffer.from(afterImage.data, 'base64'));
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
      }),
    );
    await runtime.release(session);
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
