const MAX_DIAGNOSTIC_LENGTH = 500;

export function diagnosticMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/https?:\/\/\S+/gi, "[url redacted]")
    .replace(/\b[^\s@]+@[^\s@]+\.[^\s@]+\b/g, "[email redacted]")
    .replace(/\b(?:authorization|cookie)\s*[:=]\s*(?:bearer\s+)?[^\s,;]+/gi, "[secret redacted]")
    .replace(/\b(?:token|password|secret)\s*[:=]\s*[^\s,;]+/gi, "[secret redacted]")
    .slice(0, MAX_DIAGNOSTIC_LENGTH);
}
