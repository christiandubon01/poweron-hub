/**
 * CT-REL-2 Part A (goal 4): the EXACT banner text the owner sees while the
 * connected Host is running older Agent Host code. Driven ONLY by
 * presence.restartRequired (the Host is the single source of truth — the
 * browser never compares fingerprints itself).
 */
export const HOST_RESTART_REQUIRED_MESSAGE =
  'Host restart required — the connected Host is running older Agent Host code. Stop the Host window and run: npm.cmd run agent-host:control'

/** Warning only. This control does not restart or kill the Host. */
export default function HostRestartNotice({ required }: { required: boolean }) {
  if (!required) return null
  return <p className="ct-host-restart" role="status">{HOST_RESTART_REQUIRED_MESSAGE}</p>
}