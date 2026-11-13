const assert = require('node:assert/strict');
const { readFile, writeFile, rename } = require('node:fs/promises');
const { join, resolve } = require('node:path');

// QA only: observe the actual rendered Web Audio channels, downstream of the Player master gain.
// A zero-gain branch pulls the analysers without adding sound; the Electron output is also muted.
const stereoProbe = `(() => {
  window.__stereoRoots = []; window.__stereoPanners = [];
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function(target, ...args) {
    const result = connect.call(this, target, ...args);
    if (target === this.context.destination && this instanceof GainNode) {
      const context = this.context, splitter = context.createChannelSplitter(2);
      const left = context.createAnalyser(), right = context.createAnalyser(), silent = context.createGain();
      left.fftSize = right.fftSize = 2048; silent.gain.value = 0;
      connect.call(this, splitter); connect.call(splitter, left, 0); connect.call(splitter, right, 1);
      connect.call(left, silent); connect.call(right, silent); connect.call(silent, target);
      window.__stereoRoots.push({context, left, right});
    }
    return result;
  };
  const create = AudioContext.prototype.createStereoPanner;
  AudioContext.prototype.createStereoPanner = function() {
    const node = create.call(this), entry = {node, disconnected:false};
    const disconnect = node.disconnect;
    node.disconnect = function(...args) { entry.disconnected = true; return disconnect.apply(this,args); };
    window.__stereoPanners.push(entry); return node;
  };
  window.__readStereo = () => {
    const root = window.__stereoRoots.at(-1);
    if (!root) return {rms:[0,0],frequency:[0,0],state:'missing'};
    const channels = [root.left, root.right].map(analyser => {
      const samples = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(samples);
      let energy=0,crossings=0;
      for(let i=0;i<samples.length;i++) { energy+=samples[i]*samples[i]; if(i && samples[i-1]<0 && samples[i]>=0)crossings++; }
      return {rms:Math.sqrt(energy/samples.length),frequency:crossings*root.context.sampleRate/samples.length};
    });
    return {rms:channels.map(c=>c.rms),frequency:channels.map(c=>c.frequency),state:root.context.state,time:root.context.currentTime};
  };
})();`;

async function verifyStereoPlayback({ js, until, click, output, verifyVisibility, capture }) {
  const original = JSON.parse(await readFile(join(output, 'timeline.json'), 'utf8'));
  // Stereo source deliberately has unequal channels; center must preserve their balance.
  const rate = 44100,
    samples = rate * 2,
    wav = Buffer.alloc(44 + samples * 4);
  wav.write('RIFF');
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(2, 22);
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 4, 28);
  wav.writeUInt16LE(4, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(samples * 4, 40);
  for (let i = 0; i < samples; i++) {
    const hz = i < rate ? 440 : 880;
    wav.writeInt16LE(Math.round(Math.sin((i * Math.PI * 2 * hz) / rate) * 1200), 44 + i * 4);
    wav.writeInt16LE(Math.round(Math.sin((i * Math.PI * 2 * hz) / rate) * 240), 46 + i * 4);
  }
  await writeFile(join(output, 'assets/stereo.wav'), wav);
  const cases = [
    { name: 'mono-left', pan: -1, asset: 'voice', left: true },
    { name: 'mono-right', pan: 1, asset: 'voice', right: true },
    { name: 'mono-center', pan: 0, asset: 'voice', ratio: 1 },
    {
      name: 'mono-half-right',
      pan: 0.5,
      asset: 'voice',
      ratio: Math.cos((3 * Math.PI) / 8) / Math.sin((3 * Math.PI) / 8),
    },
    { name: 'mono-gain-two', pan: 1, asset: 'voice', right: true, volume: 2 },
    { name: 'video-left', pan: -1, asset: 'video', left: true },
    { name: 'video-right', pan: 1, asset: 'video', right: true },
    { name: 'stereo-center', pan: 0, asset: 'stereo', ratio: 5 },
    { name: 'stereo-left', pan: -1, asset: 'stereo', left: true },
    { name: 'stereo-right', pan: 1, asset: 'stereo', right: true },
    {
      name: 'trimmed-stereo',
      pan: -1,
      asset: 'stereo',
      left: true,
      sourceFrom: 10,
      duration: 8,
      frequency: 880,
    },
    { name: 'overlap', pan: -1, asset: 'voice', ratio: 2, overlap: true },
  ];
  const evidence = [];
  for (const spec of cases) {
    await click('Закрыть просмотр');
    await until(`window.__stereoPanners.every(entry=>entry.disconnected)`);
    const item = {
      id: 'pan-clip',
      name: spec.name,
      from: 0,
      duration: spec.duration ?? 20,
      assetId: spec.asset,
      volume: spec.volume ?? 1,
      pan: spec.pan,
      sourceFrom: spec.sourceFrom ?? 0,
    };
    const timeline = {
      ...original,
      assets: [...original.assets, { id: 'stereo', type: 'audio', src: './assets/stereo.wav' }],
      tracks: [
        {
          id: 'pan-track',
          name: 'Стереопанорама QA',
          type: spec.asset === 'video' ? 'visual' : 'audio',
          items: [item],
        },
      ],
    };
    if (spec.overlap) {
      item.volume = 0.5;
      timeline.tracks[0].items.push({
        ...item,
        id: 'other-pan',
        name: 'Правый канал',
        pan: 1,
        volume: 0.25,
      });
    }
    await writeFile(join(output, '.qa-timeline-stage'), JSON.stringify(timeline));
    await rename(join(output, '.qa-timeline-stage'), join(output, 'timeline.json'));
    await until(
      `document.querySelector('.native-montage-card') || Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Открыть монтаж')`,
    );
    await click('Открыть монтаж');
    await until(`!!document.querySelector('.studio-remotion-player')`);
    await until(
      `Array.from(document.querySelectorAll('[aria-label^="Клип "]')).some(b=>b.getAttribute('aria-label')===${JSON.stringify('Клип ' + spec.name)})`,
    );
    await js(
      `document.querySelector('[aria-label='+${JSON.stringify(JSON.stringify('Клип ' + spec.name))}+']').click()`,
    );
    if (spec.pan)
      assert.ok(
        (await js(`document.querySelector('.editor-inspector').textContent`)).includes(
          spec.pan < 0 ? 'Влево' : 'Вправо',
        ),
      );
    await js(`document.querySelector('[aria-label="Воспроизвести"]').click()`);
    const requirement = spec.left
      ? `value.rms[0]>0.005 && value.rms[1]<0.00001`
      : spec.right
        ? `value.rms[1]>0.005 && value.rms[0]<0.00001`
        : `value.rms[0]>0.002 && value.rms[1]>0.002 && Math.abs(value.rms[0]/value.rms[1]-${spec.ratio})<${Math.max(0.04, (spec.ratio ?? 1) * 0.04)}`;
    await until(
      `(()=>{const value=window.__readStereo();return value.state==='running' && (${requirement});})()`,
    );
    const measured = await js('window.__readStereo()');
    if (spec.frequency)
      assert.ok(
        Math.abs(measured.frequency[0] - spec.frequency) < 70,
        'trimBefore selects the second source segment',
      );
    if (spec.name === 'mono-gain-two') {
      const reference = evidence.find((entry) => entry.name === 'mono-right').rms[1];
      assert.ok(
        measured.rms[1] / reference > 1.9 && measured.rms[1] / reference < 2.1,
        'Clip volume >1 stays effective',
      );
    }
    evidence.push({ name: spec.name, rms: measured.rms, frequency: measured.frequency });
    if (['mono-center', 'mono-half-right'].includes(spec.name)) {
      const reference = evidence.find((entry) => entry.name === 'mono-right').rms[1] ** 2;
      const power = measured.rms[0] ** 2 + measured.rms[1] ** 2;
      assert.ok(
        Math.abs(power / reference - 1) < 0.08,
        'Mono pan keeps equal power, including center',
      );
    }
    if (spec.name === 'mono-right') {
      await js(`document.querySelector('[aria-label="Пауза"]').click()`);
      await until(`window.__readStereo().state==='suspended'`);
      const frame = Number(
        await js(`document.querySelector('[data-video-frame]').dataset.videoFrame`),
      );
      await js(`document.querySelector('[aria-label="На кадр вперёд"]').click()`);
      await until(
        `Number(document.querySelector('[data-video-frame]').dataset.videoFrame)===${frame + 1}`,
      );
      await js(`document.querySelector('[aria-label="Воспроизвести"]').click()`);
      await until(`window.__readStereo().state==='running' && window.__readStereo().rms[1]>0.005`);
      await js(`document.querySelector('[aria-label="Выключить звук"]').click()`);
      // Remotion mutes by suspending its context; an analyser retains the last nonzero block.
      await until(`window.__readStereo().state==='suspended'`);
      const muted = await js(
        `({time:window.__readStereo().time,frame:Number(document.querySelector('[data-video-frame]').dataset.videoFrame)})`,
      );
      await until(
        `Number(document.querySelector('[data-video-frame]').dataset.videoFrame)>${muted.frame}`,
      );
      assert.equal(
        (await js('window.__readStereo()')).time,
        muted.time,
        'Muted audio clock stops while video keeps playing',
      );
      await js(`document.querySelector('[aria-label="Включить звук"]').click()`);
      await until(
        `window.__readStereo().state==='running' && window.__readStereo().time>${muted.time + 0.05} && window.__readStereo().rms[1]>0.005`,
      );
      await click('На весь экран');
      await js(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
      await until(
        `!document.querySelector('.editor-fullscreen') && window.__readStereo().rms[1]>0.005`,
      );
      await verifyVisibility();
      await js(`document.querySelector('[aria-label="Воспроизвести"]').click()`);
      await until(`window.__readStereo().state==='running' && window.__readStereo().rms[1]>0.005`);
    }
    if (spec.name === 'video-right') await capture();
    await until(`!!document.querySelector('[aria-label="Пауза"]')`);
    await js(`document.querySelector('[aria-label="Пауза"]').click()`);
  }
  await click('Закрыть просмотр');
  await until(`window.__stereoPanners.every(entry=>entry.disconnected)`);
  const proof = {
    stereo: true,
    channelsMeasured: true,
    cases: evidence,
    pauseSeekResumeMuteFullscreen: true,
    hiddenPausesPlayback: true,
    allPannersDisconnected: true,
    nativeOsOutputMuted: true,
  };
  await writeFile(resolve('artifacts/stereo-proof.json'), JSON.stringify(proof, null, 2) + '\n');
  console.log(JSON.stringify(proof));
}

module.exports = { stereoProbe, verifyStereoPlayback };
