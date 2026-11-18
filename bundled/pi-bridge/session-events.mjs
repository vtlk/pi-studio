/** Preserve ordered lifecycle/accounting events; heartbeat must not wait for persistence. */
export function sessionEvents(request, language) {
  let queue = Promise.resolve();
  const send = async (data) => {
    const result = await request('event', data);
    if (result.language === 'en' || result.language === 'ru') language(result.language);
    return result;
  };
  return (data) => {
    if (data.type === 'heartbeat') return send(data);
    const result = queue.then(() => send(data));
    queue = result.catch(() => {});
    return result;
  };
}
