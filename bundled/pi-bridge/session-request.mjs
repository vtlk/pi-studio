/** The session capability is sent only to Studio's loopback URL; never print response bodies. */
export function sessionRequest(bootstrap) {
  const headers = {
    Authorization: `Bearer ${bootstrap.token}`,
    'Content-Type': 'application/json',
  };
  return async (path, data) => {
    let response;
    try {
      response = await fetch(`${bootstrap.url}/${path}`, {
        headers,
        method: data === undefined ? 'GET' : 'POST',
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new Error(
        'Pi Studio session bridge unavailable. Keep Studio open and reopen the agent from Studio.',
      );
    }
    if (!response.ok) {
      const body = await response.json().catch(() => undefined);
      if (response.status === 400 && body?.error?.reason === 'terminal_profile')
        throw new Error(
          'Перезапустите Windows Terminal, чтобы загрузить профиль Pi Studio, затем откройте диалог снова. / Restart Windows Terminal to load the Pi Studio profile, then reopen the dialogue from Studio.',
        );
      throw new Error(
        `Pi Studio session bridge disconnected (HTTP ${response.status}). Reopen the agent from Studio.`,
      );
    }
    return response.json();
  };
}
