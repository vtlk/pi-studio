/** Pi 1.5.2's public MCP client disables request timers for a non-finite timeout.
 * Its JSON config cannot express that value. Apply it only to Studio's authenticated,
 * in-memory team entry; initialization still has waitForMcp's bounded readiness check.
 * Other servers, transports and native cancellation keep their own policies.
 */
export function studioMcpDeadlines(servers, bootstrap) {
  return servers.map((server) => {
    if (
      server.name !== 'team' ||
      server.source !== 'Pi Studio system' ||
      server.config.url !== `${bootstrap.url}/mcp/team` ||
      server.config.headers?.Authorization !== `Bearer ${bootstrap.token}`
    )
      return server;
    return { ...server, config: { ...server.config, timeout: Infinity } };
  });
}
