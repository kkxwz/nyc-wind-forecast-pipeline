import { loadNycHourlyForecast, refreshSnapshot } from './forecast.mjs';

const outputPath = process.argv[2] ?? 'forecast.json';

try {
  const snapshot = await refreshSnapshot(outputPath, loadNycHourlyForecast);
  console.log(`Published ${snapshot.hours.length} hourly forecasts to ${outputPath}`);
} catch (error) {
  console.error(`Forecast refresh rejected: ${error.message}`);
  process.exitCode = 1;
}
