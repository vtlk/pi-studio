/** All native UI invocations finish before replacement; no Electron/renderer dependency. */
export class InvocationGate {
  private active = 0;
  private held = false;
  async invoke<T>(action: () => T | Promise<T>): Promise<T> {
    if (this.held) throw new Error('Устанавливается обновление Pi Studio. Дождитесь перезапуска.');
    this.active++;
    try {
      return await action();
    } finally {
      this.active--;
    }
  }
  acquire() {
    if (this.held || this.active) return undefined;
    this.held = true;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.held = false;
    };
  }
}
