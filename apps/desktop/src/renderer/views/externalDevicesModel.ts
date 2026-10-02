// How External Devices shows its provider's state. A provider the user simply
// hasn't turned on is "off", not an error: it used to get the red error banner
// and an "Error" chip on every fresh install.

export type ProviderView = "connected" | "off" | "problem";

export function providerView(status: string): ProviderView {
  if (status === "ready") return "connected";
  if (status === "disabled") return "off";
  return "problem";
}
