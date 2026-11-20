import { randomUUID } from 'node:crypto';

const kinds = ['steering', 'followUp'];
const contentText = (message) =>
  typeof message.content === 'string'
    ? message.content
    : message.content
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('\n');

/** Pinned Pi 1.5.2 runtime-data adapter. No SDK files, methods or prototypes are patched.
 * Validate both native queue representations before a synchronous exact-object mutation.
 * Never clear/replay neighbouring inputs or run input hooks again.
 */
export function createQueueControls(session, emit) {
  const identities = new WeakMap();
  const identify = (message) => {
    if (!identities.has(message)) identities.set(message, randomUUID());
    return identities.get(message);
  };
  const read = () => {
    if (typeof session._emitQueueUpdate !== 'function') throw Error('queue_unsupported');
    return kinds.map((kind) => {
      const texts =
        kind === 'steering' ? session.getSteeringMessages() : session.getFollowUpMessages();
      const queue = session.agent[kind === 'steering' ? 'steeringQueue' : 'followUpQueue'];
      if (
        !Array.isArray(texts) ||
        !Array.isArray(queue?.messages) ||
        Object.isFrozen(texts) ||
        Object.isFrozen(queue.messages)
      )
        throw Error('queue_unsupported');
      const users = queue.messages
        .map((message, nativeIndex) => ({ message, nativeIndex }))
        .filter(({ message }) => message.role === 'user');
      if (
        users.length !== texts.length ||
        users.some(({ message }, index) => contentText(message) !== texts[index])
      )
        throw Error('queue_changed');
      return { kind, texts, queue, users };
    });
  };
  const snapshot = () => {
    const queues = read();
    return {
      steering: [...queues[0].texts],
      followUp: [...queues[1].texts],
      items: queues.flatMap(({ kind, texts, users }) =>
        users.map(({ message }, index) => ({
          id: identify(message),
          kind,
          text: texts[index],
        })),
      ),
    };
  };
  const publish = () => {
    try {
      emit({ type: 'studio_queue_update', ...snapshot() });
    } catch {
      /* Unsupported native shape keeps its ordinary read-only queue UI. */
    }
  };
  const unsubscribe = session.subscribe((event) => {
    // Native queue_update fires just before the core enqueue. Snapshot after that synchronous push.
    if (event.type === 'queue_update') queueMicrotask(publish);
  });
  return {
    snapshot,
    publish,
    close: unsubscribe,
    action(action, id) {
      if (action === 'snapshot') return { queue: snapshot() };
      if (!['peek', 'steer', 'edit', 'delete'].includes(action) || typeof id !== 'string')
        throw Error('queue_invalid');
      const queues = read();
      const source = queues.find(({ users }) =>
        users.some(({ message }) => identify(message) === id),
      );
      const index = source?.users.findIndex(({ message }) => identify(message) === id) ?? -1;
      if (!source || index < 0) throw Error('queue_changed');
      const { message, nativeIndex } = source.users[index];
      const text = source.texts[index];
      const images = Array.isArray(message.content)
        ? message.content.filter((part) => part.type === 'image')
        : [];
      if (
        (action === 'peek' || action === 'edit') &&
        (text.length > 200000 ||
          images.length > 32 ||
          images.reduce(
            (size, image) => size + (typeof image.data === 'string' ? image.data.length : Infinity),
            0,
          ) >
            40 * 1024 ** 2)
      )
        throw Error('queue_too_large');
      if (action === 'peek') return { text, images };
      if (action === 'steer' && source.kind === 'steering') return { queue: snapshot() };
      source.queue.messages.splice(nativeIndex, 1);
      source.texts.splice(index, 1);
      if (action === 'steer') {
        queues[0].queue.messages.push(message); // Same native object, images and identity.
        queues[0].texts.push(text);
      } else session._queuedMessagesWithImages?.delete(message);
      // Keep official queue_update/get_state/extension pending counts consistent as well.
      try {
        session._emitQueueUpdate();
      } catch {
        /* Committed; own publication still follows. */
      }
      publish();
      const result = action === 'edit' ? { text, images } : {};
      try {
        result.queue = snapshot();
      } catch {
        /* Never turn a committed edit into a failed removal. */
      }
      return result;
    },
  };
}
