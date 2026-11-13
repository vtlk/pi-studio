/** Observe Pi's own transport; do not establish a second client or reimplement OAuth. */
export function observeMcpTransport(createDefaultTransport, statuses) {
  return (entry, cwd, auth) => {
    const transport = createDefaultTransport(entry, cwd, auth);
    statuses.set(entry.name, 'connecting');
    const requests = new Map();
    transport.onMessage((message) => {
      const method = requests.get(message.id);
      if (!method) return;
      requests.delete(message.id);
      if (message.error) statuses.set(entry.name, 'error');
      else if (
        method === 'tools/list' ||
        (method === 'initialize' && !message.result?.capabilities?.tools)
      )
        statuses.set(entry.name, 'ready');
    });
    transport.onError(() => statuses.set(entry.name, 'error'));
    transport.onClose(() => statuses.set(entry.name, 'closed'));
    return {
      start: () => transport.start(),
      send: (message, options) => {
        if (message.method === 'initialize' || message.method === 'tools/list')
          requests.set(message.id, message.method);
        return transport.send(message, options);
      },
      close: () => transport.close(),
      onMessage: (listener) => transport.onMessage(listener),
      onError: (listener) => transport.onError(listener),
      onClose: (listener) => transport.onClose(listener),
      setProtocolVersion: (version) => transport.setProtocolVersion?.(version),
    };
  };
}
export async function waitForMcp(statuses, names, timeout = 20_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const failed = names.find((name) => ['error', 'closed'].includes(statuses.get(name)));
    if (failed)
      throw new Error(
        `MCP «${failed}» не подключён. Откройте /mcp в Pi и проверьте вход/настройки.`,
      );
    if (names.every((name) => statuses.get(name) === 'ready')) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(
    `Не завершена загрузка MCP: ${names.filter((name) => statuses.get(name) !== 'ready').join(', ')}. Проверьте /mcp в Pi.`,
  );
}
