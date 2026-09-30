/* eslint-disable @typescript-eslint/no-explicit-any */
// Speak-to-type for the complaint description: the browser's own speech
// recognition (Web Speech API), English only, as in the #2038 design.
//
// Chrome and Edge send the audio to their vendor's speech service to
// transcribe it; Safari does the same through Apple's. Firefox has no
// recognition at all, so there the mic is simply not offered.

import * as React from "react";
import { Button } from "@egovernments/digit-ui-components-v2";
import { useDialogFocus } from "./useDialogFocus";
import { trackEvent } from "../../../utils/analytics";

type SpeechState = "idle" | "recording" | "ready" | "error";

/** Browser speech recognition, where it exists. */
function recognitionConstructor(): any {
  if (typeof window === "undefined") return null;
  return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;
}

export function speechToTextSupported(): boolean {
  return !!recognitionConstructor();
}

/**
 * Join a finalised phrase onto what was heard so far. Android Chrome in
 * continuous mode re-sends each final with everything before it, and some
 * engines repeat the last phrase, so a phrase that already contains, or is
 * contained in, the text so far replaces or is dropped rather than appended.
 */
function mergeFinal(heard: string, next: string): string {
  if (!next) return heard;
  if (!heard) return next;
  const a = heard.toLowerCase();
  const n = next.toLowerCase();
  if (n.startsWith(a)) return next;
  if (a.endsWith(n)) return heard;
  return `${heard} ${next}`;
}

/** The browser's own English variant (en-KE, en-IN…) if it has one, else en-US. */
function englishLocale(): string {
  const langs = (typeof navigator !== "undefined" && (navigator.languages || [navigator.language])) || [];
  return langs.find((l) => /^en(-|$)/i.test(l || "")) || "en-US";
}

/**
 * One recording session at a time: start, stop, and the transcript so far.
 * `interim` is what the recogniser is still unsure of; `transcript` is final.
 */
export function useSpeechToText() {
  const [state, setState] = React.useState<SpeechState>("idle");
  const [transcript, setTranscript] = React.useState("");
  const [interim, setInterim] = React.useState("");
  const [seconds, setSeconds] = React.useState(0);
  const [errorCode, setErrorCode] = React.useState<string | null>(null);
  const recRef = React.useRef<any>(null);
  const finalRef = React.useRef("");
  // The phrase still being recognised, kept so an early end does not lose it.
  const interimRef = React.useRef("");
  const stateRef = React.useRef<SpeechState>("idle");
  const timerRef = React.useRef<number | null>(null);

  const setBoth = (next: SpeechState) => {
    stateRef.current = next;
    setState(next);
  };

  const stopTimer = () => {
    if (timerRef.current != null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const teardown = () => {
    stopTimer();
    const rec = recRef.current;
    recRef.current = null;
    if (rec) {
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
      try {
        rec.abort();
      } catch {
        // Already stopped.
      }
    }
  };

  React.useEffect(() => teardown, []);

  const start = React.useCallback(() => {
    const Recognition = recognitionConstructor();
    if (!Recognition) return;
    teardown();
    finalRef.current = "";
    interimRef.current = "";
    setTranscript("");
    setInterim("");
    setSeconds(0);
    setErrorCode(null);

    const rec = new Recognition();
    rec.lang = englishLocale();
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    // Rebuilt from the whole session's results on each event, so a result
    // the engine revises or repeats is counted once.
    rec.onresult = (event: any) => {
      let heard = "";
      let pending = "";
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        const text = (result[0]?.transcript || "").trim();
        if (!text) continue;
        if (result.isFinal) heard = mergeFinal(heard, text);
        else pending = `${pending} ${text}`.trim();
      }
      finalRef.current = heard;
      interimRef.current = pending;
      setTranscript(heard);
      setInterim(pending);
    };
    // What the citizen saw while recording is the result, whether or not the
    // engine finalised its last phrase (iOS Safari ends without doing so).
    const keepHeard = () => {
      const heard = mergeFinal(finalRef.current, interimRef.current);
      finalRef.current = heard;
      interimRef.current = "";
      setTranscript(heard);
      setInterim("");
      return heard;
    };
    rec.onerror = (event: any) => {
      // Our own teardown clears these handlers before it aborts, so an error
      // that arrives here is a real failure. That includes "aborted", which is
      // how Safari reports a failed recognition.
      if (recRef.current !== rec) return;
      stopTimer();
      // A failure mid-dictation (the network dropping, say) keeps what was
      // already heard rather than discarding it.
      if (keepHeard()) {
        setBoth("ready");
        return;
      }
      setErrorCode(event?.error || "unknown");
      setBoth("error");
    };
    // Recognition also ends on its own after a long silence. Whatever ended
    // it, what was heard so far is the result.
    rec.onend = () => {
      stopTimer();
      recRef.current = null;
      if (stateRef.current !== "recording") return;
      if (keepHeard()) {
        setBoth("ready");
      } else {
        setErrorCode("no-speech");
        setBoth("error");
      }
    };

    recRef.current = rec;
    try {
      rec.start();
    } catch {
      setErrorCode("unknown");
      setBoth("error");
      return;
    }
    setBoth("recording");
    timerRef.current = window.setInterval(() => setSeconds((s) => s + 1), 1000);
  }, []);

  /** Stop listening; the transcript arrives as the recogniser finishes. */
  const stop = React.useCallback(() => {
    const rec = recRef.current;
    if (rec) {
      try {
        rec.stop();
      } catch {
        // Already stopped.
      }
    }
  }, []);

  const reset = React.useCallback(() => {
    teardown();
    finalRef.current = "";
    interimRef.current = "";
    setTranscript("");
    setInterim("");
    setSeconds(0);
    setErrorCode(null);
    setBoth("idle");
  }, []);

  return { state, transcript, interim, seconds, errorCode, start, stop, reset };
}

const clock = (sec: number) =>
  `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;

const MicGlyph = ({ size = 22 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <rect x="9" y="2" width="6" height="12" rx="3" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <path d="M12 19v3" />
  </svg>
);

/** Delete keeps the outline button's shape in the error colour. */
const DANGER_OUTLINE: React.CSSProperties = {
  borderColor: "var(--color-error, #DC2626)",
  color: "var(--color-error, #DC2626)",
};

const StopGlyph = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </svg>
);
const RetakeGlyph = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="M3 12a9 9 0 1 0 3-6.7" />
    <path d="M3 4v5h5" />
  </svg>
);
const TrashGlyph = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="M3 6h18" />
    <path d="M8 6V4h8v2" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
  </svg>
);

export const MicButton = ({ label, onClick }: { label: string; onClick: () => void }) => (
  <button
    type="button"
    className="cms-mic-button"
    onClick={onClick}
    aria-label={label}
    title={label}
    data-analytics-event="pgr.file-complaint.voice.open"
  >
    <MicGlyph size={20} />
  </button>
);

interface VoiceSheetProps {
  open: boolean;
  onClose: () => void;
  /** Called with the finished transcript when the citizen keeps it. */
  onUse: (text: string) => void;
  tr: (key: string, fallback: string) => string;
}

/**
 * The recorder: a card at the foot of the screen on a phone, a dialog on
 * desktop. Opening it starts listening; Stop gives the transcript, which the
 * citizen can add to the description, record again, or throw away.
 */
export function VoiceSheet({ open, onClose, onUse, tr }: VoiceSheetProps) {
  const speech = useSpeechToText();
  const { state, transcript, interim, seconds, errorCode, start, stop, reset } = speech;
  const sheetRef = React.useRef<HTMLDivElement>(null);
  useDialogFocus(open, sheetRef, state);

  // Outcomes, which no click shows: a transcript came back, or recording
  // failed and why (the recogniser's own error code, never the words).
  React.useEffect(() => {
    if (!open) return;
    if (state === "ready") {
      trackEvent("pgr.file-complaint.voice.transcribed", { category: "pgr", value: seconds });
    } else if (state === "error") {
      trackEvent("pgr.file-complaint.voice.failed", { category: "pgr", label: errorCode || "unknown" });
    }
    // Once per state change; seconds and errorCode are read as they stand then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, state]);

  React.useEffect(() => {
    if (open) start();
    else reset();
    // Start once per opening; start/reset are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  React.useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const recording = state === "recording";
  const ready = state === "ready";
  const failed = state === "error";

  const errorText =
    errorCode === "not-allowed"
      ? tr("CS_VOICE_MIC_BLOCKED", "Microphone access is blocked. Allow it for this site in your browser settings, then try again.")
      : errorCode === "service-not-allowed"
      ? // Safari refuses speech recognition while Siri is switched off.
        tr("CS_VOICE_SERVICE_OFF", "Voice input is turned off on this device. On an iPhone or Mac, turn on Siri in Settings, then try again.")
      : errorCode === "no-speech"
      ? tr("CS_VOICE_NO_SPEECH", "We didn't hear anything. Try again and speak close to the microphone.")
      : errorCode === "audio-capture"
      ? tr("CS_VOICE_NO_MIC", "No microphone was found on this device.")
      : errorCode === "network"
      ? tr("CS_VOICE_NETWORK", "Voice input needs an internet connection. Check it and try again.")
      : tr("CS_VOICE_FAILED", "Voice input stopped unexpectedly. Try again.");

  const title = recording
    ? tr("CS_VOICE_RECORDING", "Recording…")
    : ready
    ? tr("CS_VOICE_READY", "Transcription ready")
    : tr("CS_VOICE_TRY_AGAIN", "Couldn't record");
  const hint = recording
    ? tr("CS_VOICE_ENGLISH_ONLY", "Voice input currently works in English only.")
    : ready
    ? tr("CS_VOICE_READY_HINT", "Add it to your description, record again, or delete it.")
    : errorText;

  return (
    <div className="cms-sheet-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div ref={sheetRef} tabIndex={-1} className="cms-sheet cms-voice" role="dialog" aria-modal="true" aria-labelledby="cms-voice-title">
        <h2 id="cms-voice-title" className="cms-sheet-head">
          {title}
        </h2>
        <p className="cms-sheet-hint" aria-live="polite">
          {hint}
        </p>

        <div className={`cms-voice-live ${state}`}>
          <span className="cms-voice-pulse" aria-hidden="true">
            {recording ? (
              <>
                <span className="cms-voice-ring" />
                <span className="cms-voice-ring late" />
              </>
            ) : null}
            <span className="cms-voice-dot">
              <MicGlyph size={27} />
            </span>
          </span>
          <span className="cms-voice-bars" aria-hidden="true">
            {Array.from({ length: 16 }, (_, i) => (
              <span
                key={i}
                style={
                  recording
                    ? { animationDelay: `${i * 45}ms`, animationDuration: `${620 + (i % 5) * 110}ms` }
                    : { transform: `scaleY(${(0.25 + ((i * 37) % 60) / 100).toFixed(2)})` }
                }
              />
            ))}
          </span>
          <span className="cms-voice-time">{clock(seconds)}</span>
        </div>

        {recording && (transcript || interim) ? (
          <p className="cms-voice-text">
            {transcript} <span className="cms-voice-interim">{interim}</span>
          </p>
        ) : null}
        {ready ? <p className="cms-voice-result">{transcript}</p> : null}

        {recording ? (
          <div className="cms-sheet-actions">
            <Button variant="outline" onClick={onClose} data-analytics-event="pgr.file-complaint.voice.cancel">
              {tr("CS_COMMON_CANCEL", "Cancel")}
            </Button>
            <Button variant="destructive" leading={<StopGlyph />} onClick={stop} data-analytics-event="pgr.file-complaint.voice.stop">
              {tr("CS_VOICE_STOP", "Stop")}
            </Button>
          </div>
        ) : ready ? (
          <div className="cms-sheet-stack">
            <Button
              width="full"
              onClick={() => {
                onUse(transcript);
                onClose();
              }}
              data-analytics-event="pgr.file-complaint.voice.use"
            >
              {tr("CS_VOICE_USE", "Upload")}
            </Button>
            <div className="cms-sheet-actions">
              <Button variant="outline" leading={<RetakeGlyph />} onClick={start} data-analytics-event="pgr.file-complaint.voice.retake">
                {tr("CS_VOICE_RETAKE", "Retake")}
              </Button>
              <Button
                variant="outline"
                leading={<TrashGlyph />}
                onClick={onClose}
                style={DANGER_OUTLINE}
                data-analytics-event="pgr.file-complaint.voice.delete"
              >
                {tr("CS_INFO_DELETE", "Delete")}
              </Button>
            </div>
            <Button variant="ghost" width="full" onClick={onClose} data-analytics-event="pgr.file-complaint.voice.cancel">
              {tr("CS_COMMON_CANCEL", "Cancel")}
            </Button>
          </div>
        ) : failed ? (
          <div className="cms-sheet-actions">
            <Button variant="outline" onClick={onClose} data-analytics-event="pgr.file-complaint.voice.cancel">
              {tr("CS_COMMON_CANCEL", "Cancel")}
            </Button>
            <Button onClick={start} data-analytics-event="pgr.file-complaint.voice.retry">
              {tr("CS_VOICE_RETRY", "Try again")}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
