import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { ConvexError } from "convex/values";
import { api } from "../../convex/_generated/api";
import {
  SESSION_RECORDING_CONSENT_VERSION,
  SESSION_RECORDING_LABEL,
} from "../../shared/sessionRecording";
import { resumeRecordingAfterConsent, stopRecordingImmediately } from "../lib/posthog";

export function SessionRecordingSettings() {
  const preferences = useQuery(api.accounts.analyticsPreferences, {});
  const save = useMutation(api.accounts.setSessionRecording);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const enabled =
    preferences?.recording?.enabled === true &&
    preferences.recording.version === SESSION_RECORDING_CONSENT_VERSION;

  async function change(checked: boolean) {
    if (!checked) stopRecordingImmediately();
    setPending(true);
    setError("");
    try {
      await save({ enabled: checked });
      if (checked) resumeRecordingAfterConsent();
    } catch (caught) {
      setError(
        caught instanceof ConvexError && typeof caught.data === "string"
          ? caught.data
          : caught instanceof Error
            ? caught.message
            : "Could not save your recording preference.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      className="surface-panel mt-8 p-5 sm:p-6"
      aria-busy={preferences === undefined || pending}
    >
      <h2 className="text-base font-semibold">Session recordings</h2>
      <label className="mt-4 flex items-start gap-3 text-sm leading-6">
        <input
          type="checkbox"
          className="mt-1 size-4 shrink-0 accent-primary"
          checked={enabled}
          disabled={!preferences || pending}
          onChange={(event) => void change(event.currentTarget.checked)}
        />
        <span>{SESSION_RECORDING_LABEL}</span>
      </label>
      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
