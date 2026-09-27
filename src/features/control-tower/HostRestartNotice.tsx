import { HOST_RESTART_REQUIRED_MESSAGE } from './hostCodeWarning'

/** Warning only. This control does not restart or kill the Host. */
export default function HostRestartNotice({ required }: { required: boolean }) {
  if (!required) return null
  return <p className="ct-host-restart" role="status">{HOST_RESTART_REQUIRED_MESSAGE}</p>
}
