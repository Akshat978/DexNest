// Weather, from the one provider that asks for nothing.
//
// Open-Meteo needs no API key, no account and no attribution header, and its
// free tier is explicit about non-commercial use. That matters more than
// feature count here: a weather card is not worth a credential to store, a
// quota to monitor, or a signup that expires.
//
// WHAT THIS DOES NOT DO
//
// It does not find the operator's location. No IP geolocation, no probing —
// the location is configured once and stored, because a machine that quietly
// worked out where its owner is would be a surprising thing to find inside a
// local-first app.
//
// CACHING IS NOT AN OPTIMISATION HERE
//
// The phone polls, the desktop card polls, and the forecast changes on the
// hour at best. Without a cache a free service would be asked the same
// question hundreds of times a day, which is how a free service stops being
// available.

import { readFileSync, writeFileSync } from "node:fs";

/** Long enough to be a good citizen, short enough that a passing storm shows. */
const CACHE_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 8000;

export interface WeatherLocation {
  latitude: number;
  longitude: number;
  label: string;
}

export interface WeatherNow {
  temperature: number;
  feelsLike: number;
  /** One word or two, from the WMO code. */
  description: string;
  code: number;
  isDay: boolean;
}

export interface WeatherSnapshot {
  configured: boolean;
  location: WeatherLocation | null;
  now: WeatherNow | null;
  high: number | null;
  low: number | null;
  /** Chance of precipitation today, as a percentage. */
  rainChance: number | null;
  /** Today's temperature by hour, for a sparkline. Local hours, 0-23. */
  hourly: Array<{ hour: number; temperature: number }>;
  unit: "C";
  fetchedAt: string | null;
  /** Present when the last attempt failed; the rest may still be cached data. */
  problem: string | null;
}

/**
 * WMO weather codes, in words.
 *
 * Grouped rather than exhaustive: "light drizzle" and "moderate drizzle" are
 * the same decision about whether to take a coat, and a card that distinguishes
 * them is showing off rather than helping.
 */
function describe(code: number): string {
  if (code === 0) return "Clear";
  if (code <= 2) return "Partly cloudy";
  if (code === 3) return "Overcast";
  if (code <= 48) return "Fog";
  if (code <= 57) return "Drizzle";
  if (code <= 67) return "Rain";
  if (code <= 77) return "Snow";
  if (code <= 82) return "Showers";
  if (code <= 86) return "Snow showers";
  return "Thunderstorm";
}

const empty = (location: WeatherLocation | null, problem: string | null): WeatherSnapshot => ({
  configured: Boolean(location),
  location,
  now: null,
  high: null,
  low: null,
  rainChance: null,
  hourly: [],
  unit: "C",
  fetchedAt: null,
  problem
});

async function getJson(url: string): Promise<Record<string, unknown>> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: abort.signal });
    if (!response.ok) throw new Error(`The weather service returned ${response.status}.`);
    return (await response.json()) as Record<string, unknown>;
  } finally {
    clearTimeout(timer);
  }
}

export interface WeatherService {
  snapshot: () => Promise<WeatherSnapshot>;
  location: () => WeatherLocation | null;
  /** Resolves a place name to a location and stores it. */
  setLocation: (query: string) => Promise<WeatherLocation>;
  clearLocation: () => void;
}

export function createWeatherService(options: { settingsPath: string }): WeatherService {
  let cache: { at: number; value: WeatherSnapshot } | null = null;

  const read = (): WeatherLocation | null => {
    try {
      const raw = JSON.parse(readFileSync(options.settingsPath, "utf8")) as Partial<WeatherLocation>;
      if (typeof raw.latitude !== "number" || typeof raw.longitude !== "number") return null;
      return { latitude: raw.latitude, longitude: raw.longitude, label: String(raw.label ?? "Home") };
    } catch {
      // Missing or corrupt both mean "no location configured", which is a
      // normal state rather than an error worth surfacing.
      return null;
    }
  };

  const write = (location: WeatherLocation | null): void => {
    writeFileSync(options.settingsPath, `${JSON.stringify(location ?? {}, null, 2)}\n`, "utf8");
    cache = null;
  };

  return {
    location: read,

    clearLocation: () => write(null),

    async setLocation(query: string): Promise<WeatherLocation> {
      const trimmed = query.trim();
      if (!trimmed) throw new Error("Enter a town or city.");
      const data = await getJson(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(trimmed)}&count=1&language=en&format=json`
      );
      const first = (data.results as Array<Record<string, unknown>> | undefined)?.[0];
      if (!first) throw new Error(`No place called "${trimmed}" was found.`);

      const location: WeatherLocation = {
        latitude: Number(first.latitude),
        longitude: Number(first.longitude),
        // The admin region disambiguates the several Springfields; the country
        // makes it obvious when the wrong continent was matched.
        label: [first.name, first.admin1, first.country_code].filter(Boolean).join(", ")
      };
      write(location);
      return location;
    },

    async snapshot(): Promise<WeatherSnapshot> {
      const location = read();
      if (!location) return empty(null, null);

      if (cache && Date.now() - cache.at < CACHE_MS && cache.value.location?.label === location.label) {
        return cache.value;
      }

      try {
        const data = await getJson(
          "https://api.open-meteo.com/v1/forecast"
          + `?latitude=${location.latitude}&longitude=${location.longitude}`
          + "&current=temperature_2m,apparent_temperature,weather_code,is_day"
          + "&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max"
          + "&hourly=temperature_2m"
          // timezone=auto means every timestamp comes back in the location's own
          // local time, so nothing here has to convert anything.
          + "&timezone=auto&forecast_days=1"
        );

        const current = (data.current ?? {}) as Record<string, number>;
        const daily = (data.daily ?? {}) as Record<string, number[]>;
        const hourly = (data.hourly ?? {}) as Record<string, unknown[]>;

        const value: WeatherSnapshot = {
          configured: true,
          location,
          now: {
            temperature: Math.round(Number(current.temperature_2m)),
            feelsLike: Math.round(Number(current.apparent_temperature)),
            description: describe(Number(current.weather_code)),
            code: Number(current.weather_code),
            isDay: Number(current.is_day) === 1
          },
          high: daily.temperature_2m_max?.[0] !== undefined ? Math.round(daily.temperature_2m_max[0]!) : null,
          low: daily.temperature_2m_min?.[0] !== undefined ? Math.round(daily.temperature_2m_min[0]!) : null,
          rainChance: daily.precipitation_probability_max?.[0] ?? null,
          hourly: (hourly.time as string[] | undefined ?? []).map((stamp, index) => ({
            hour: Number(String(stamp).slice(11, 13)),
            temperature: Math.round(Number((hourly.temperature_2m as number[] | undefined)?.[index]))
          })).filter(point => Number.isFinite(point.temperature)),
          unit: "C",
          fetchedAt: new Date().toISOString(),
          problem: null
        };

        cache = { at: Date.now(), value };
        return value;
      } catch (error) {
        // A stale forecast beats no forecast: it was true an hour ago, which is
        // most of what a forecast ever claims.
        if (cache) return { ...cache.value, problem: "Could not refresh the forecast." };
        return empty(location, error instanceof Error ? error.message : String(error));
      }
    }
  };
}
