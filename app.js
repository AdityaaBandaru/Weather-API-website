const API_URL = "https://api.open-meteo.com/v1/forecast?latitude=25.240538&longitude=55.3152873&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,cloud_cover,wind_speed_10m,wind_direction_10m&hourly=temperature_2m,relative_humidity_2m,precipitation_probability,precipitation&timezone=Asia/Dubai&windspeed_unit=kmh";
const REFRESH_INTERVAL = 1000; // 1 second
const BRIDGE_URL = "http://localhost:5000/wind-speed";
const SERIAL_PUSH_INTERVAL = 30000; // minimum time between bridge posts
const SPEED_CHANGE_THRESHOLD = 0.5; // km/h difference before forcing an update

const elements = {
  temperature: document.getElementById("temperature"),
  apparent: document.getElementById("apparent"),
  humidity: document.getElementById("humidity"),
  cloudCover: document.getElementById("cloud-cover"),
  precipitation: document.getElementById("precipitation"),
  precipProb: document.getElementById("precip-prob"),
  windSpeed: document.getElementById("wind-speed"),
  windDirection: document.getElementById("wind-direction"),
  status: document.getElementById("status"),
  lastUpdated: document.getElementById("last-updated"),
  forecastBody: document.getElementById("forecast-body"),
};

const statusColors = {
  info: "#7dd3fc",
  success: "#86efac",
  error: "#fca5a5",
};

let lastBridgeSpeed = null;
let lastBridgePush = 0;

function formatValue(value, decimals = 1) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(decimals) : "--";
}

function toCardinal(degrees) {
  if (typeof degrees !== "number" || !Number.isFinite(degrees)) {
    return "--";
  }
  const markers = [
    "N",
    "NNE",
    "NE",
    "ENE",
    "E",
    "ESE",
    "SE",
    "SSE",
    "S",
    "SSW",
    "SW",
    "WSW",
    "W",
    "WNW",
    "NW",
    "NNW",
  ];
  const index = Math.round(degrees / 22.5) % markers.length;
  return `${markers[index]} (${Math.round(degrees)}°)`;
}

function setStatus(message, type = "info") {
  if (!elements.status) return;
  elements.status.textContent = message;
  elements.status.style.color = statusColors[type] ?? statusColors.info;
}

async function fetchWeather() {
  const response = await fetch(API_URL, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Weather API responded with ${response.status}`);
  }
  return response.json();
}

function updateCurrent(current, hourly) {
  elements.temperature.textContent = `${formatValue(current.temperature_2m)} °C`;
  elements.apparent.textContent = `${formatValue(current.apparent_temperature)} °C`;
  elements.humidity.textContent = `${formatValue(current.relative_humidity_2m, 0)} %`;
  elements.cloudCover.textContent = `${formatValue(current.cloud_cover, 0)} %`;
  elements.precipitation.textContent = `${formatValue(current.precipitation)} mm`;
  elements.windSpeed.textContent = `${formatValue(current.wind_speed_10m)} km/h`;
  elements.windDirection.textContent = toCardinal(current.wind_direction_10m);

  maybeSendWindSpeed(current.wind_speed_10m);

  if (hourly && Array.isArray(hourly.time) && Array.isArray(hourly.precipitation_probability)) {
    const index = hourly.time.indexOf(current.time);
    const probability = index >= 0 ? hourly.precipitation_probability[index] : null;
    elements.precipProb.textContent = `${formatValue(probability, 0)} %`;
  } else {
    elements.precipProb.textContent = "-- %";
  }
}

async function postWindSpeed(speedKmh) {
  if (!BRIDGE_URL) return;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2000);

  try {
    await fetch(BRIDGE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ windSpeedKmh: speedKmh }),
      mode: "cors",
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (error) {
    console.warn("Unable to reach serial bridge", error);
  } finally {
    clearTimeout(timeoutId);
  }
}

function maybeSendWindSpeed(speedKmh) {
  if (typeof speedKmh !== "number" || !Number.isFinite(speedKmh)) {
    return;
  }

  const now = Date.now();
  const hasChanged =
    lastBridgeSpeed === null || Math.abs(speedKmh - lastBridgeSpeed) >= SPEED_CHANGE_THRESHOLD;
  const longEnough = now - lastBridgePush >= SERIAL_PUSH_INTERVAL;

  if (!hasChanged && !longEnough) {
    return;
  }

  lastBridgeSpeed = speedKmh;
  lastBridgePush = now;
  postWindSpeed(speedKmh);
}

function getNearestIndex(times, targetTime) {
  if (!Array.isArray(times) || !targetTime) return 0;
  const exact = times.indexOf(targetTime);
  if (exact !== -1) return exact;

  const targetMs = Date.parse(`${targetTime}:00`);
  if (Number.isNaN(targetMs)) return 0;

  for (let i = 0; i < times.length; i += 1) {
    const entryMs = Date.parse(`${times[i]}:00`);
    if (!Number.isNaN(entryMs) && entryMs >= targetMs) {
      return i;
    }
  }
  return Math.max(times.length - 12, 0);
}

function formatHourLabel(timeString) {
  const [datePart, timePart] = timeString.split("T");
  if (!datePart || !timePart) return timeString;
  const date = new Date(`${datePart}T${timePart}:00`);
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Dubai",
  }).format(date);
}

function updateForecast(hourly, currentTime) {
  if (!hourly || !Array.isArray(hourly.time)) {
    elements.forecastBody.innerHTML = "";
    return;
  }

  const startIndex = getNearestIndex(hourly.time, currentTime);
  const endIndex = Math.min(startIndex + 12, hourly.time.length);
  const rows = [];

  for (let i = startIndex; i < endIndex; i += 1) {
    const label = formatHourLabel(hourly.time[i]);
    const temperature = hourly.temperature_2m?.[i];
    const humidity = hourly.relative_humidity_2m?.[i];
    const probability = hourly.precipitation_probability?.[i];
    const precip = hourly.precipitation?.[i];

    rows.push(`
      <tr>
        <td>${label}</td>
        <td>${formatValue(temperature)} °C</td>
        <td>${formatValue(humidity, 0)} %</td>
        <td>${formatValue(probability, 0)} %</td>
        <td>${formatValue(precip)} mm</td>
      </tr>
    `);
  }

  elements.forecastBody.innerHTML = rows.join("");
}

function markUpdated() {
  const timestamp = new Date().toLocaleString("en-GB", {
    hour12: false,
    timeZone: "Asia/Dubai",
  });
  elements.lastUpdated.textContent = `Last updated: ${timestamp}`;
}

async function refreshWeather() {
  try {
    const data = await fetchWeather();
    updateCurrent(data.current, data.hourly);
    updateForecast(data.hourly, data.current.time);
    markUpdated();
    if (elements.status) {
      elements.status.textContent = "";
    }
  } catch (error) {
    console.error("Failed to update weather dashboard", error);
    setStatus("Unable to load live data. Please check your connection and retry.", "error");
  }
}

function init() {
  refreshWeather();
  setInterval(refreshWeather, REFRESH_INTERVAL);
}

document.addEventListener("DOMContentLoaded", init);
