import { changeLanguage } from '../src/shared/i18n/index.ts';
await changeLanguage('ru');
import test from 'node:test';
import assert from 'node:assert/strict';
import { InvocationGate } from '../src/main/updates/InvocationGate.ts';
import { acquireInstallation } from '../src/main/updates/InstallationAdmission.ts';
import { StartupAdmission, holdStartup } from '../src/main/updates/StartupAdmission.ts';
import { desktopChannels as c } from '../src/shared/contracts.ts';
import { UsageRecovery } from '../src/main/accounting/UsageRecovery.ts';
import type { StudioStore, StudioService } from '../src/main/storage/StudioStore.ts';

test('fresh update startup pauses history backfill until health commits, without losing future recovery', async () => {
  const admission = new StartupAdmission();
  let scheduled = 0;
  const store = {
    bootstrap: () => ({ sections: { piPath: 'inert-no-probe' } }),
    projects: {
      list: () => {
        scheduled++;
        return [];
      },
    },
  } as unknown as StudioStore;
  const accounting = new UsageRecovery({} as StudioService, 'unused', () => 'inert-no-probe');
  const release = holdStartup(admission, accounting);
  accounting.schedule(store);
  await accounting.flush();
  assert.equal(scheduled, 0, 'Passive startup reads must not enqueue all legacy histories');
  assert.throws(() => admission.assertAllowed(c.launchAgent));
  release();
  release();
  admission.assertAllowed(c.launchAgent);
  accounting.schedule(store);
  assert.equal(scheduled, 1, 'Normal background recovery resumes after startup commit');
  accounting.close();
  assert.throws(() =>
    holdStartup(admission, {
      hold: () => {
        throw Error('pause failed');
      },
    }),
  );
  admission.assertAllowed(c.saveSection);
});

test('installation holds all run hosts and accounting before async cleanup; failure unwinds without losing future work', async () => {
  const events: string[] = [],
    gate = new InvocationGate();
  let active = false;
  const host = (id: string) => ({
    hold: () => {
      events.push('hold ' + id);
      return {
        verify: () => {
          if (active) throw Error('new work');
        },
        drainIdle: async () => {
          events.push('drain ' + id);
        },
        release: () => {
          events.push('release ' + id);
        },
      };
    },
  });
  const lease = acquireInstallation({
    gate: () => gate.acquire(),
    assertIdle: () => {
      if (active) throw Error('busy');
    },
    runs: [host('a'), host('b')],
    background: {
      hold: () => {
        events.push('pause accounting');
        return {
          release: () => {
            events.push('resume accounting');
          },
        };
      },
      flush: async () => {
        events.push('flush accounting');
      },
    },
  });
  assert.ok(lease);
  assert.deepEqual(events, ['hold a', 'hold b', 'pause accounting']);
  await assert.rejects(
    gate.invoke(() => {
      throw Error('admitted new operation');
    }),
    /обновление/,
  );
  await lease.drainIdle();
  assert.deepEqual(events.slice(3), ['flush accounting', 'drain a', 'drain b']);
  active = true;
  assert.throws(() => lease.verify(), /busy/);
  lease.release();
  lease.release();
  assert.deepEqual(events.slice(-3), ['resume accounting', 'release b', 'release a']);
  assert.equal(await gate.invoke(() => 42), 42);
  const failed = acquireInstallation({
    gate: () => gate.acquire(),
    assertIdle: () => {},
    runs: [
      host('a'),
      {
        hold: () => {
          throw Error('second host busy');
        },
      },
    ],
    background: {
      hold: () => {
        throw Error('must not pause');
      },
      flush: async () => {},
    },
  });
  assert.equal(failed, undefined);
  assert.equal(events.at(-1), 'release a');
  assert.equal(await gate.invoke(() => 7), 7);
});
test('startup permits hydration/status reads but denies launch, user edits, auth, deletion and external effects', () => {
  const gate = new StartupAdmission(),
    release = gate.hold();
  for (const read of [
    c.loadStudio,
    c.getInfo,
    c.getGitHubStar,
    c.readProject,
    c.readOutput,
    c.getStartup,
    c.listProjectUsage,
  ])
    gate.assertAllowed(read);
  for (const mutation of [
    c.launchAgent,
    c.saveSection,
    c.chooseStudio,
    c.openStudio,
    c.beginConnectionLogin,
    c.deleteAgentData,
    c.copyOutput,
    c.installResource,
  ])
    assert.throws(() => gate.assertAllowed(mutation), /обновление/);
  release();
  gate.assertAllowed(c.launchAgent);
});
