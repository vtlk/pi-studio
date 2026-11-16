/** Create DevTools inside the owned Chrome. Upstream `inspect` calls OS `open` and is forbidden here. */
export async function openDevTools(browser) {
  const endpointReply = await browser.invoke('agent_browser_get_cdp_url');
  const tabsReply = await browser.invoke('agent_browser_tab_list');
  const data = (reply) =>
    reply.structuredContent?.response?.data ??
    reply.content
      .filter((item) => item.type === 'text')
      .map((item) => {
        try {
          return JSON.parse(item.text)?.data;
        } catch {
          return undefined;
        }
      })
      .find(Boolean);
  const endpoint = new URL(data(endpointReply)?.cdpUrl);
  const active = data(tabsReply)?.tabs?.filter((item) => item.active === true);
  if (
    endpoint.protocol !== 'ws:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    !/^\/devtools\/browser\/[a-zA-Z0-9-]+$/.test(endpoint.pathname) ||
    active?.length !== 1 ||
    !/^[a-zA-Z0-9-]+$/.test(active[0].targetId)
  )
    throw new Error('Не подтверждён точный браузер/вкладка для DevTools.');
  const url = `devtools://devtools/bundled/inspector.html?ws=${endpoint.host}/devtools/page/${active[0].targetId}`;
  await new Promise((resolve, reject) => {
    const socket = new WebSocket(endpoint.href);
    let settled = false;
    const timer = setTimeout(() => finish(new Error('DevTools не подтвердили открытие.')), 10000);
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.close();
      if (error) reject(error);
      else resolve();
    };
    socket.addEventListener(
      'close',
      () => finish(new Error('Соединение DevTools закрыто до подтверждения.')),
      { once: true },
    );
    socket.addEventListener(
      'error',
      () => finish(new Error('Не удалось открыть DevTools этого браузера.')),
      { once: true },
    );
    socket.addEventListener(
      'open',
      () =>
        socket.send(
          JSON.stringify({
            id: 1,
            method: 'Target.createTarget',
            params: { url, newWindow: true, background: false },
          }),
        ),
      { once: true },
    );
    socket.addEventListener('message', ({ data }) => {
      try {
        const response = JSON.parse(String(data));
        if (response.id !== 1) return;
        finish(
          response.error || !response.result?.targetId
            ? new Error('Chrome отказался открыть DevTools.')
            : undefined,
        );
      } catch {
        finish(new Error('Некорректный ответ DevTools.'));
      }
    });
  });
  return {
    content: [{ type: 'text', text: JSON.stringify({ opened: true, ownedBrowserOnly: true }) }],
  };
}
