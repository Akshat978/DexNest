#!/usr/bin/env python
"""DexNest local wake-word sidecar (Phase 23.9 / built-in phrases).

A REAL local wake-word detector built on openWakeWord. It listens to the
microphone locally, runs the wake model on-device, and emits newline-delimited
JSON events on stdout. No cloud, no raw audio is ever saved, and only metadata
(scores/timestamps) crosses the boundary.

Phrase modes (--phrase):
  hey_jarvis   built-in/local openWakeWord model (if already installed locally)
  alexa        built-in/local openWakeWord model (if already installed locally)
  custom_nest  custom-trained model at sidecars/wake-word/models/nest.onnx
  custom_path  custom model file from --model-path

Modes:
  --check            Report dependency/model availability as JSON and exit.
  (default)          Run the detector loop and emit {"type":"wake", ...} events.

Protocol (stdout, one JSON object per line):
  {"type":"check",  "ok": bool, "selectedPhrase": "...", "modelSource": "...",
                    "modelAvailable": bool, "deps": {...}, "error": "..."|null}
  {"type":"ready",  "model": "...", "selectedPhrase": "...", "device": <int|null>}
  {"type":"wake",   "model": "...", "score": 0.0-1.0, "ts": <epoch_ms>}
  {"type":"fatal",  "error": "..."}

stdin commands (one JSON per line): {"type":"shutdown"}
"""
import argparse
import json
import os
import sys
import threading
import time

BUILTIN_PHRASES = {"hey_jarvis", "alexa", "hey_mycroft", "hey_rhasspy"}

# Set when the parent asks us to stop, or when stdin closes (parent died). This
# guarantees the sidecar releases the microphone and exits instead of orphaning
# and holding the mic device open forever across sessions.
_stop_event = threading.Event()


def _watch_stdin():
    """Exit cleanly on a shutdown command or when stdin reaches EOF.

    Electron writes {"type":"shutdown"} on quit; if the parent process is killed
    abruptly, the stdin pipe closes (EOF) and `for line in sys.stdin` ends, so we
    still stop and free the microphone.
    """
    try:
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            try:
                msg = json.loads(line)
            except Exception:
                continue
            if msg.get("type") == "shutdown":
                break
    except Exception:
        pass
    _stop_event.set()


def send(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def probe_deps():
    deps = {"openwakeword": False, "sounddevice": False, "onnxruntime": False, "numpy": False}
    for name in deps:
        try:
            __import__(name)
            deps[name] = True
        except Exception:
            pass
    return deps


def custom_nest_path(models_dir):
    candidate = os.path.join(models_dir, "nest.onnx")
    if os.path.isfile(candidate):
        return candidate
    if os.path.isdir(models_dir):
        for name in os.listdir(models_dir):
            if name.lower().startswith("nest") and name.lower().endswith((".onnx", ".tflite")):
                return os.path.join(models_dir, name)
    return None


def resolve_model(phrase, model_path, models_dir):
    """Return (model_ref, model_source). model_ref is a file path or built-in name."""
    if phrase == "custom_path":
        return (model_path or None), "custom_path"
    if phrase == "custom_nest":
        return custom_nest_path(models_dir), "custom_nest"
    if phrase in BUILTIN_PHRASES:
        return phrase, "builtin"
    # default fallback
    return phrase, "builtin"


def load_model(model_ref, model_source):
    from openwakeword.model import Model
    if model_source == "builtin":
        # DexNest is local/offline-first. Do not download models from this
        # sidecar; the user must install/cache wake models explicitly.
        return Model(wakeword_models=[model_ref])
    # custom file
    return Model(wakeword_models=[model_ref])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--phrase", default="hey_jarvis")
    parser.add_argument("--model-path", default="")
    parser.add_argument("--models-dir", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "models"))
    parser.add_argument("--sensitivity", type=float, default=0.5)
    parser.add_argument("--device", default="")
    parser.add_argument("--cooldown-ms", type=int, default=1500)
    # Back-compat: previous interface used --model + --wake-word.
    parser.add_argument("--model", default="")
    parser.add_argument("--wake-word", default="Nest")
    args = parser.parse_args()

    phrase = args.phrase
    model_path = args.model_path or args.model
    deps = probe_deps()
    model_ref, model_source = resolve_model(phrase, model_path, args.models_dir)

    if args.check:
        report = {
            "type": "check",
            "ok": False,
            "selectedPhrase": phrase,
            "modelSource": model_source,
            "modelAvailable": False,
            "deps": deps,
            "error": None,
        }
        missing = [n for n in ("openwakeword", "sounddevice") if not deps[n]]
        if missing:
            report["error"] = (
                "Wake engine dependencies missing: " + ", ".join(missing)
                + ". Install with: python -m pip install openwakeword sounddevice numpy"
            )
            send(report)
            return
        if model_source in ("custom_nest", "custom_path"):
            if not model_ref or not os.path.isfile(model_ref):
                report["error"] = (
                    "Custom wake model not found"
                    + (f" at {model_ref}" if model_ref else "")
                    + ". Train a model and save it as sidecars/wake-word/models/nest.onnx, "
                    "or choose a built-in phrase (Hey Jarvis)."
                )
                send(report)
                return
            report["modelAvailable"] = True
            report["ok"] = True
            send(report)
            return
        # Built-in: try to load only what is already available locally.
        try:
            load_model(model_ref, model_source)
            report["modelAvailable"] = True
            report["ok"] = True
        except Exception as exc:
            report["error"] = (
                "Wake model '" + str(model_ref) + "' is not available locally: " + str(exc)
                + ". Install/cache the model locally or use a custom model path."
            )
        send(report)
        return

    # Run mode.
    if not deps["openwakeword"] or not deps["sounddevice"]:
        send({"type": "fatal", "error": "openWakeWord/sounddevice not installed."})
        return
    if model_source in ("custom_nest", "custom_path") and (not model_ref or not os.path.isfile(model_ref)):
        send({"type": "fatal", "error": "Custom wake model not found for phrase '" + phrase + "'."})
        return

    try:
        import numpy as np
        import sounddevice as sd

        oww = load_model(model_ref, model_source)

        device = None
        if args.device:
            try:
                device = int(args.device)
            except ValueError:
                device = args.device

        sample_rate = 16000
        frame = 1280  # 80ms at 16kHz, openWakeWord's expected chunk
        last_wake = 0.0

        # Watch stdin so we exit + release the mic when the parent stops/dies.
        threading.Thread(target=_watch_stdin, daemon=True).start()
        send({"type": "ready", "model": str(model_ref), "selectedPhrase": phrase, "device": device})

        with sd.InputStream(samplerate=sample_rate, channels=1, dtype="int16", blocksize=frame, device=device) as stream:
            while not _stop_event.is_set():
                data, _ = stream.read(frame)
                audio = np.frombuffer(data, dtype=np.int16)
                scores = oww.predict(audio)
                best = max(scores.values()) if scores else 0.0
                now = time.time()
                if best >= args.sensitivity and (now - last_wake) * 1000.0 >= args.cooldown_ms:
                    last_wake = now
                    send({"type": "wake", "model": str(model_ref), "score": round(float(best), 3), "ts": int(now * 1000)})
        # InputStream context closes here, releasing the microphone device.
    except Exception as exc:  # pragma: no cover - depends on hardware
        send({"type": "fatal", "error": str(exc)})


if __name__ == "__main__":
    main()
