# NYC Wind Lab — Forecast Snapshot

A standalone prototype for refreshing an hourly air-temperature snapshot from the
[National Weather Service API](https://www.weather.gov/documentation/services-web-api).
The first integration point is Lower Manhattan. The
[WebGL2 tile seam demo](https://nyc-wind-seam-lab.adroitrabbit4.chatgpt.site/)
is a separate rendering prototype with synthetic wind data.

## Run it

Requires Node.js 20 or later. No dependencies or API key are required.

```sh
node --test
node refresh.mjs forecast.json
```

The refresh command discovers the current hourly forecast endpoint through
`/points`. It checks the response shape and hourly coverage, converts temperatures
to Celsius and timestamps to UTC, then atomically replaces the output file.
The JSON includes the issuing time, fetch time, coverage end, and hourly values.

## When the source changes

If the request fails, a field changes type, or a forecast is older than the
stored version, the command exits nonzero and preserves the last good file.
The tests replay a change from a numeric temperature to an object and check
that the old snapshot survives byte for byte.

The exported `forecastStatus` helper reports `stale` after two hours without a
successful refresh and `unavailable` outside forecast coverage. A map can use
that status to show a warning or hide the forecast layer while keeping other
layers available.

This is the ingestion and cache prototype. It pulls one forecast point per run;
it has no scheduler, public alerting integration, or street-level heat-risk score.
