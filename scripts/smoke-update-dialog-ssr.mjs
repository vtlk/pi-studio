import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { mkdtemp, writeFile, symlink, rm, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

/** Render the production React dialog without Electron, a browser, GUI or system permission probes. */
const root = resolve(import.meta.dirname, '..');
const stage = await mkdtemp(join(tmpdir(), 'pistudio-update-dialog-ssr-'));
try {
  await symlink(join(root, 'node_modules'), join(stage, 'node_modules'));
  const entry = join(stage, 'entry.tsx');
  await writeFile(
    entry,
    `
    import React from 'react';
    import {renderToStaticMarkup} from 'react-dom/server';
    import assert from 'node:assert/strict';
    import {TooltipProvider} from ${JSON.stringify(join(root, 'src/renderer/shared/ui/Tooltip.tsx'))};
    import {UpdateDialog} from ${JSON.stringify(join(root, 'src/renderer/features/updates/UpdateAction.tsx'))};
    import {UpdatesContext} from ${JSON.stringify(join(root, 'src/renderer/features/updates/Updates.context.ts'))};
    import {changeLanguage} from ${JSON.stringify(join(root, 'src/shared/i18n/index.ts'))};
    globalThis.document = {activeElement:null};
    export async function verify(){
      const checks=[];
      for(const language of ['ru','en']) {
        await changeLanguage(language);
        const frames=[];
        for(const frozen of [false,true,false,true]) {
          const state={currentVersion:'0.2.0-alpha.111',phase:'waiting',message:'Waiting for work',offer:{version:'0.2.0-alpha.112',bytes:100,notes:'Inert release notes'}};
          const html=renderToStaticMarkup(<TooltipProvider><UpdatesContext.Provider value={{state,open:true,frozen,manual:false,show(){},hide(){},request(){},check(){}}}><UpdateDialog/></UpdatesContext.Provider></TooltipProvider>);
          const header=html.match(/<header[^>]*>([\\s\\S]*?)<\\/header>/)[1];
          const footer=html.match(/<footer[^>]*>([\\s\\S]*?)<\\/footer>/)[1];
          assert.equal((header.match(/<button/g)||[]).length,1);
          assert.equal((footer.match(/<button/g)||[]).length,1);
          assert.equal(/disabled=/.test(header),frozen);
          assert.equal(/disabled=/.test(footer),frozen);
          frames.push(footer.replace(/<[^>]*>/g,''));
        }
        assert.ok(frames.every(frame=>frame===frames[0]));
        checks.push({language,headerAndFooterRetainTheirControls:true,freezeDisablesWithoutRemovingControls:true});
      }
      return {ok:true,checks,scope:'Production React SSR control structure only; no native desktop or pixel geometry acceptance',noGuiOrPermissionsInvoked:true};
    }
  `,
  );
  await build({
    configFile: false,
    plugins: [react()],
    resolve: { alias: { '@': join(root, 'src/renderer') } },
    logLevel: 'silent',
    build: {
      ssr: entry,
      outDir: join(stage, 'out'),
      rollupOptions: { output: { entryFileNames: 'entry.mjs' } },
    },
  });
  const proof = await (await import(pathToFileURL(join(stage, 'out/entry.mjs')).href)).verify();
  const version = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version;
  await writeFile(
    join(root, 'artifacts/update-dialog-ssr-proof.json'),
    JSON.stringify({ version, ...proof }, null, 2) + '\n',
  );
  console.log(JSON.stringify(proof));
} finally {
  await rm(stage, { recursive: true, force: true });
}
