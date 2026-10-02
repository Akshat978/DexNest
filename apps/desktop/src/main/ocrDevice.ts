// Which device Tools' OCR runs on. GPU is opt-in (AGENTS.md: "GPU must not be
// used unless explicitly enabled ... Never on by default"): with nothing
// saved, OCR runs on the CPU. A device the user saved is always kept.

export type OcrDevice = "gpu" | "cpu";

export const DEFAULT_OCR_DEVICE: OcrDevice = "cpu";

export function isOcrDevice(value: unknown): value is OcrDevice {
  return value === "cpu" || value === "gpu";
}

/** The device asked for, else the one saved in Tools settings, else the CPU. */
export function resolveOcrDevice(requested: unknown, saved: unknown): OcrDevice {
  if (isOcrDevice(requested)) return requested;
  if (isOcrDevice(saved)) return saved;
  return DEFAULT_OCR_DEVICE;
}
