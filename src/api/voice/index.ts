/**
 * Voice API — barrel export
 */

export { transcribeWithWhisper, estimateConfidence, isNonSpeechSegment } from './whisper'
export type { WhisperRequest, WhisperResponse, WhisperSegment } from './whisper'

export {
  synthesizeWithElevenLabs,
  streamSynthesis,
  getVoiceByName,
  getVoiceById,
  revokeAudioUrl,
  AVAILABLE_VOICES,
  DEFAULT_VOICE_ID,
} from './elevenLabs'
export type { ElevenLabsVoice, TTSRequest, TTSResponse } from './elevenLabs'

export { classifyVoiceIntent, routeVoiceCommand } from './routing'
export type { IntentClassification, VoiceRouteResult, TargetAgent } from './routing'
