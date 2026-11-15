import { spawn } from 'node:child_process';
/** Owned local pseudo-terminal, no Terminal.app/desktop input or OS focus. */
export function piPty(node: string, bridge: string, bootstrap: string) {
  return spawn(
    'python3',
    [
      '-c',
      `
import errno, os, pty, sys
pid, master = pty.fork()
if pid == 0:
    os.execv(sys.argv[1], sys.argv[1:])
while True:
    try:
        data = os.read(master, 65536)
        if not data: break
        os.write(1, data)
    except OSError as error:
        if error.errno == errno.EIO: break
        raise
os.close(master)
_, status = os.waitpid(pid, 0)
sys.exit(os.waitstatus_to_exitcode(status))
`,
      node,
      bridge,
      bootstrap,
    ],
    {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, TERM: 'xterm-256color', PI_OFFLINE: '1', PI_TELEMETRY: '0' },
    },
  );
}
