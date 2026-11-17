/** Pi 1.5.2's public MCP client disables request timers for a non-finite timeout.
 * Its JSON config cannot express that value. Apply it only to Studio's authenticated,
 * in-memory team/internal entries; initialization still has waitForMcp's bounded readiness check.
 * Internal downloads own header/body-idle bounds; a healthy skill transfer has no total lifetime.
 * Other servers, transports and native cancellation keep their own policies.
 */
export function studioMcpDeadlines(servers, bootstrap) {
  return servers.map((server) => {
    const team =
      server.name === 'team' &&
      server.source === 'Pi Studio system' &&
      server.config.url === `${bootstrap.url}/mcp/team`;
    const internal =
      server.name === 'pi_studio' &&
      server.source === 'Pi Studio internal' &&
      server.config.url === `${bootstrap.url}/mcp`;
    if (
      (!team && !internal) ||
      server.config.headers?.Authorization !== `Bearer ${bootstrap.token}`
    )
      return server;
    return { ...server, config: { ...server.config, timeout: Infinity } };
  });
}
