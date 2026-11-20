import { randomUUID } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';

const SOURCE = 'NOAA / National Weather Service';
const NYC_POINT = 'https://api.weather.gov/points/40.7128,-74.0060';
const HOUR_MS = 60 * 60 * 1000;
const HEADERS = {
  Accept: 'application/geo+json',
  'User-Agent': 'NYC-Wind-Seam-Lab/0.1',
};

function timestamp(value, field) {
  if (typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new Error(`Invalid ${field}: expected a timestamp with a timezone`);
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid ${field}`);
  return parsed;
}

export function normalizeForecast(payload, fetchedAt = new Date()) {
  const properties = payload?.properties;
  const issued = timestamp(properties?.updateTime, 'properties.updateTime');
  if (!Array.isArray(properties.periods) || properties.periods.length === 0) {
    throw new Error('Invalid properties.periods: expected a non-empty array');
  }

  let previousEnd;
  const hours = properties.periods.map((period, index) => {
    const start = timestamp(period?.startTime, `periods[${index}].startTime`);
    const end = timestamp(period?.endTime, `periods[${index}].endTime`);
    if (end - start !== HOUR_MS || (previousEnd !== undefined && start !== previousEnd)) {
      throw new Error(`Non-contiguous hourly forecast at period ${index}`);
    }
    if (!Number.isFinite(period.temperature) || !['F', 'C'].includes(period.temperatureUnit)) {
      throw new Error(`Invalid temperature or unit at period ${index}`);
    }
    previousEnd = end;
    const celsius = period.temperatureUnit === 'F' ? (period.temperature - 32) * 5 / 9 : period.temperature;
    return {
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
      temperatureC: Math.round(celsius * 100) / 100,
    };
  });

  return {
    schemaVersion: 1,
    source: SOURCE,
    issuedAt: new Date(issued).toISOString(),
    fetchedAt: fetchedAt.toISOString(),
    coverageEndsAt: hours.at(-1).end,
    hours,
  };
}

export function forecastStatus(snapshot, now = new Date()) {
  const current = now.getTime();
  const covered = snapshot.hours.some(hour => Date.parse(hour.start) <= current && current < Date.parse(hour.end));
  if (!covered) return 'unavailable';
  return current - Date.parse(snapshot.fetchedAt) >= 2 * HOUR_MS ? 'stale' : 'current';
}

export async function refreshSnapshot(outputPath, load, now = new Date()) {
  const snapshot = normalizeForecast(await load(), now);
  if (forecastStatus(snapshot, now) === 'unavailable') throw new Error('Forecast does not cover the refresh time');

  let existing;
  try {
    existing = JSON.parse(await readFile(outputPath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (existing && Date.parse(existing.issuedAt) > Date.parse(snapshot.issuedAt)) {
    throw new Error('Incoming forecast is older than the stored forecast');
  }

  const temporaryPath = `${outputPath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, JSON.stringify(snapshot, null, 2) + '\n', { flag: 'wx' });
    await rename(temporaryPath, outputPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
  return snapshot;
}

async function weatherJson(url) {
  const response = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`NWS request failed with HTTP ${response.status}`);
  return response.json();
}

export async function loadNycHourlyForecast() {
  const point = await weatherJson(NYC_POINT);
  const hourly = point?.properties?.forecastHourly;
  if (typeof hourly !== 'string' ||
      !/^https:\/\/api\.weather\.gov\/gridpoints\/[A-Z]{3}\/\d+,\d+\/forecast\/hourly$/.test(hourly)) {
    throw new Error('Missing or unexpected NWS hourly forecast endpoint');
  }
  return weatherJson(hourly);
}
