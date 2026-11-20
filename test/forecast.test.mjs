import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { forecastStatus, refreshSnapshot } from '../forecast.mjs';

const fetched = new Date('2026-07-15T16:15:00Z');

function sample() {
  return {
    properties: {
      updateTime: '2026-07-15T15:30:00Z',
      periods: [12, 13, 14, 15].map(hour => ({
        startTime: `2026-07-15T${hour}:00:00-04:00`,
        endTime: `2026-07-15T${hour + 1}:00:00-04:00`,
        temperature: 95,
        temperatureUnit: 'F',
      })),
    },
  };
}

async function withSnapshot(context) {
  const directory = await mkdtemp(join(tmpdir(), 'nyc-wind-forecast-'));
  context.after(() => rm(directory, { force: true, recursive: true }));
  return { directory, output: join(directory, 'forecast.json') };
}

test('writes normalized UTC hours and Celsius temperatures', async context => {
  const { output } = await withSnapshot(context);
  const snapshot = await refreshSnapshot(output, sample, fetched);
  assert.deepEqual(snapshot.hours[0], {
    start: '2026-07-15T16:00:00.000Z',
    end: '2026-07-15T17:00:00.000Z',
    temperatureC: 35,
  });
  assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), snapshot);
});

test('rejects an upstream temperature shape change and preserves the previous file', async context => {
  const { directory, output } = await withSnapshot(context);
  await refreshSnapshot(output, sample, fetched);
  const previous = await readFile(output, 'utf8');
  const changed = sample();
  changed.properties.periods[0].temperature = { value: 35, unitCode: 'wmoUnit:degC' };
  await assert.rejects(refreshSnapshot(output, () => changed, fetched), /Invalid temperature/);
  assert.equal(await readFile(output, 'utf8'), previous);
  assert.deepEqual(await readdir(directory), ['forecast.json']);
});

test('preserves the previous snapshot if NWS is unavailable or rolls back', async context => {
  const { output } = await withSnapshot(context);
  await refreshSnapshot(output, sample, fetched);
  const previous = await readFile(output, 'utf8');
  await assert.rejects(refreshSnapshot(output, () => { throw new Error('NWS unavailable'); }, fetched), /NWS unavailable/);
  const older = sample();
  older.properties.updateTime = '2026-07-15T14:30:00Z';
  await assert.rejects(refreshSnapshot(output, () => older, fetched), /older/);
  assert.equal(await readFile(output, 'utf8'), previous);
});

test('reports cached coverage as current, stale, then unavailable', async context => {
  const { output } = await withSnapshot(context);
  const snapshot = await refreshSnapshot(output, sample, fetched);
  assert.equal(forecastStatus(snapshot, fetched), 'current');
  assert.equal(forecastStatus(snapshot, new Date('2026-07-15T18:15:00Z')), 'stale');
  assert.equal(forecastStatus(snapshot, new Date('2026-07-15T20:00:00Z')), 'unavailable');
});
