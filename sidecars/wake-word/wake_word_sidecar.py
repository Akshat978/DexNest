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
        # Built-in openWakeWord phrases (Hey Jarvis / Alexa) need the small,
        # static pretrained model files. Load from the local cache; if they are
        # not cached yet, fetch them once (a one-time local model cache, not
        # user data / telemetry) so a built-in phrase works after the user has
        # enabled wake word and installed openwakeword.
        try:
            return Model(wakeword_models=[model_ref])
        except Exception as exc:
            sys.stderr.write("DexNest wake: caching openWakeWord built-in models (%s)...\n" % model_ref)
            sys.stderr.flush()
            try:
                import openwakeword
                openwakeword.utils.download_models()
            except Exception as dexc:
                raise RuntimeError(
                    "Built-in wake model '%s' is not cached and could not be fetched: %s. "
                    "Run once with internet: \"python -c \\\"import openwakeword.utils; openwakeword.utils.download_models()\\\"\"."
                    % (model_ref, dexc)
                ) from exc
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
    parser.add_argument("--gain", default="auto")  # auto | 1x | 2x | 4x | 8x | 12x
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

        def device_info(dev):
            try:
                return sd.query_devices(dev if dev is not None else None, "input")
            except Exception:
                return {}

        def device_name(dev):
            info = device_info(dev)
            try:
                return str(info.get("name", "")) if isinstance(info, dict) else str(info)
            except Exception:
                return "default input" if dev is None else str(dev)

        def max_in_channels(dev):
            info = device_info(dev)
            try:
                n = int(info.get("max_input_channels", 1)) if isinstance(info, dict) else 1
            except Exception:
                n = 1
            return max(1, n)

        # Some mics (e.g. DJI MIC MINI) expose the real signal on one of several
        # channels while the others sit silent. Open up to 2 input channels and
        # pick the loudest one per chunk instead of blindly downmixing (which
        # would halve the level or land on a dead channel).
        def make_stream(dev, ch):
            return sd.InputStream(samplerate=sample_rate, channels=ch, dtype="int16", blocksize=frame, device=dev)

        def open_best(dev):
            ch = min(2, max_in_channels(dev))
            try:
                st = make_stream(dev, ch)
                st.start()
                return st, ch
            except Exception:
                # Fall back to plain mono if the multi-channel open fails.
                st = make_stream(dev, 1)
                st.start()
                return st, 1

        try:
            stream, channels_open = open_best(device)
        except Exception as exc:
            if device is None:
                raise
            sys.stderr.write("DexNest wake: input device %r failed (%s); using default input.\n" % (device, exc))
            sys.stderr.flush()
            device = None
            stream, channels_open = open_best(None)

        resolved_name = device_name(device)

        # Parse the requested input gain. "auto" adaptively normalizes quiet
        # mics (like the DJI over its USB dongle) without amplifying dead silence
        # into false triggers; fixed multipliers are also allowed.
        gain_mode = str(args.gain or "auto").lower()
        fixed_gain = None
        if gain_mode != "auto":
            try:
                fixed_gain = float(gain_mode.rstrip("x"))
            except Exception:
                fixed_gain = None
        AUTO_TARGET_RMS = 0.06   # target normalized RMS for speech-level audio
        AUTO_MAX_GAIN = 12.0     # safety cap so noise never explodes
        AUTO_MIN_RMS = 0.0008    # below this we treat input as silence (no gain)

        # Emit ready only once audio is actually flowing, so "listening" is real.
        send({
            "type": "ready", "model": str(model_ref), "selectedPhrase": phrase,
            "device": device, "deviceName": resolved_name,
            "channelsOpen": channels_open, "gainMode": gain_mode,
            "sampleRate": sample_rate, "threshold": round(float(args.sensitivity), 3),
        })

        # Rolling diagnostics so the UI can tell "mic silent" from "score never
        # crosses threshold". We emit an "audio" event ~once per second with the
        # raw + processed RMS levels and the peak wake score in the last 10s.
        score_window = []  # (ts, score)
        chunks = 0
        last_diag = 0.0
        DIAG_INTERVAL = 1.0
        WINDOW_S = 10.0
        try:
            while not _stop_event.is_set():
                data, _ = stream.read(frame)
                chunks += 1
                block = np.asarray(data, dtype=np.int16)
                if block.ndim == 1:
                    block = block.reshape(-1, 1)
                nch = block.shape[1]

                # Per-channel RMS (0..1 of full-scale int16); use the loudest.
                ch_rms = [float(np.sqrt(np.mean(np.square(block[:, c].astype(np.float64))))) / 32768.0 for c in range(nch)]
                best_ch = int(np.argmax(ch_rms)) if ch_rms else 0
                mono = block[:, best_ch].astype(np.float32)
                raw_rms = ch_rms[best_ch] if ch_rms else 0.0
                raw_min = int(block[:, best_ch].min()) if block.size else 0
                raw_max = int(block[:, best_ch].max()) if block.size else 0

                # Apply gain (auto-adaptive or fixed), then hard-clip to int16.
                if fixed_gain is not None:
                    applied_gain = fixed_gain
                elif raw_rms >= AUTO_MIN_RMS and raw_rms < AUTO_TARGET_RMS:
                    applied_gain = min(AUTO_MAX_GAIN, AUTO_TARGET_RMS / max(raw_rms, 1e-6))
                else:
                    applied_gain = 1.0
                if applied_gain != 1.0:
                    mono = np.clip(mono * applied_gain, -32768.0, 32767.0)
                audio = mono.astype(np.int16)

                proc_rms = float(np.sqrt(np.mean(np.square(mono)))) / 32768.0 if mono.size else 0.0
                peak = float(np.max(np.abs(mono))) / 32768.0 if mono.size else 0.0

                scores = oww.predict(audio)
                best = max(scores.values()) if scores else 0.0
                now = time.time()

                score_window.append((now, float(best)))
                cutoff = now - WINDOW_S
                while score_window and score_window[0][0] < cutoff:
                    score_window.pop(0)
                max_score = max((s for _, s in score_window), default=0.0)

                if best >= args.sensitivity and (now - last_wake) * 1000.0 >= args.cooldown_ms:
                    last_wake = now
                    send({"type": "wake", "model": str(model_ref), "score": round(float(best), 3), "ts": int(now * 1000)})

                if now - last_diag >= DIAG_INTERVAL:
                    last_diag = now
                    send({
                        "type": "audio",
                        "rms": round(proc_rms, 5),          # processed RMS (what the model hears)
                        "rawRms": round(raw_rms, 5),
                        "procRms": round(proc_rms, 5),
                        "peak": round(peak, 5),
                        "rawMin": raw_min,
                        "rawMax": raw_max,
                        "channels": nch,
                        "channel": best_ch,
                        "channelRms": [round(r, 5) for r in ch_rms],
                        "gainMode": gain_mode,
                        "gainApplied": round(float(applied_gain), 2),
                        "dtype": "int16",
                        "silent": raw_rms < 0.0015,
                        "chunks": chunks,
                        "sampleRate": sample_rate,
                        "deviceName": resolved_name,
                        "score": round(float(best), 3),
                        "maxScore10s": round(float(max_score), 3),
                        "threshold": round(float(args.sensitivity), 3),
                        "ts": int(now * 1000),
                    })
        finally:
            try:
                stream.stop()
                stream.close()
            except Exception:
                pass
    except Exception as exc:  # pragma: no cover - depends on hardware
        send({"type": "fatal", "error": str(exc)})


if __name__ == "__main__":
    main()
