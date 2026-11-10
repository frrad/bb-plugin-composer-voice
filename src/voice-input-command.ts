interface VoiceInputCommandHandler {
  state: "idle" | "recording" | "transcribing" | "error";
  start(): void;
  stop(): void;
}

const voiceInputHandlers = new Map<string, VoiceInputCommandHandler>();

export function registerVoiceInputHandler(
  composerKey: string,
  handler: VoiceInputCommandHandler,
): () => void {
  const previous = voiceInputHandlers.get(composerKey);
  voiceInputHandlers.set(composerKey, handler);

  return () => {
    if (voiceInputHandlers.get(composerKey) !== handler) return;
    if (previous === undefined) voiceInputHandlers.delete(composerKey);
    else voiceInputHandlers.set(composerKey, previous);
  };
}

export function runVoiceInputCommand(composerKey: string): void {
  const handler = voiceInputHandlers.get(composerKey);
  if (handler?.state === "recording") handler.stop();
  else if (handler?.state === "idle" || handler?.state === "error") {
    handler.start();
  }
}

export function voiceInputKeyAction(
  event: Pick<
    KeyboardEvent,
    "key" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey"
  >,
): "cancel" | "send" | null {
  if (event.key === "Escape") return "cancel";
  if (
    event.key === "Enter" &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey
  ) {
    return "send";
  }
  return null;
}
