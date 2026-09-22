import { SESSION_RECORDING_LABEL } from "../../shared/sessionRecording";

export function SessionRecordingCheckbox() {
  return (
    <label className="flex items-start gap-3 text-sm leading-6">
      <input
        type="checkbox"
        name="sessionRecordingConsent"
        value="true"
        className="mt-1 size-4 shrink-0 accent-primary"
        aria-label={SESSION_RECORDING_LABEL}
      />
      <span>{SESSION_RECORDING_LABEL}</span>
    </label>
  );
}
