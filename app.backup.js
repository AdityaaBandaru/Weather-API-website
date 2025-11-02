const PRESET_LOCATIONS = [
  {
    id: "stirling_rak",
    label: "University of Stirling RAK – Ras Al Khaimah",
    headline: "University of Stirling RAK Weather",
    subtitle: "Live atmospheric metrics for Ras Al Khaimah, United Arab Emirates",
    latitude: 25.78953,
    longitude: 55.9432,
    timezone: "Asia/Dubai",
  },
  {
    id: "rak_city",
    label: "Ras Al Khaimah City, UAE",
    headline: "Ras Al Khaimah City Weather",
    subtitle: "Conditions across Ras Al Khaimah city centre",
    latitude: 25.8007,
    longitude: 55.9762,
    timezone: "Asia/Dubai",
  },
  {
    id: "dubai",
    label: "Dubai, UAE",
    headline: "Dubai Weather",
    subtitle: "Marine and urban readings for Dubai",
    latitude: 25.276987,
    longitude: 55.296249,
    timezone: "Asia/Dubai",
  },
  {
    id: "abu_dhabi",
    label: "Abu Dhabi, UAE",
    headline: "Abu Dhabi Weather",
    subtitle: "Gulf moisture outlook for Abu Dhabi",
    latitude: 24.453884,
    longitude: 54.3773438,
    timezone: "Asia/Dubai",
  },
  {
    id: "sharjah",
    label: "Sharjah, UAE",
    headline: "Sharjah Weather",
    subtitle: "Conditions across Sharjah emirate",
    latitude: 25.346255,
    longitude: 55.420932,
    timezone: "Asia/Dubai",
  },
];

const DEFAULT_LOCATION_ID = "stirling_rak";
const REFRESH_INTERVAL = 1000; // 1 second
const MIN_FETCH_INTERVAL = 15 * 1000; // 15 seconds to avoid rate limits
const HISTORY_STORE_KEY = "weather-history-v1";
const HISTORY_MAX = 600;
const HISTORY_DISPLAY_LIMIT = 120;

const statusColors = {
  info: "#7dd3fc",
  success: "#86efac",
  error: "#fca5a5",
};

const elements = {
  temperature: document.getElementById("temperature"),
  apparent: document.getElementById("apparent"),
  humidity: document.getElementById("humidity"),
  cloudCover: document.getElementById("cloud-cover"),
  precipitation: document.getElementById("precipitation"),
  precipProb: document.getElementById("precip-prob"),
  windSpeed: document.getElementById("wind-speed"),
  windDirection: document.getElementById("wind-direction"),
  humidityIndicator: document.getElementById("humidity-indicator"),
  windIndicator: document.getElementById("wind-indicator"),
  status: document.getElementById("status"),
  lastUpdated: document.getElementById("last-updated"),
  forecastBody: document.getElementById("forecast-body"),
  trendCanvas: document.getElementById("trend-chart"),
  historyBody: document.getElementById("history-body"),
  exportHistory: document.getElementById("export-history"),
  locationSelect: document.getElementById("location-select"),
  locationSearch: document.getElementById("location-search"),
  applyLocation: document.getElementById("apply-location"),
  subtitle: document.querySelector(".hero .subtitle"),
  heading: document.querySelector(".hero-copy h1"),
};

let currentLocation = PRESET_LOCATIONS.find((loc) => loc.id === DEFAULT_LOCATION_ID) ?? PRESET_LOCATIONS[0];
let historyStore = {};
let historyEntries = [];
let trendChart = null;
let lastFetchAt = 0;

function buildApiUrl(location) {
  const params = new URLSearchParams({
    latitude: location.latitude,
    longitude: location.longitude,
    current: [
      "temperature_2m",
      "relative_humidity_2m",
      "apparent_temperature",
      "precipitation",
      "cloud_cover",
      "wind_speed_10m",
      "wind_direction_10m",
    ].join(","),
    hourly: [
      "temperature_2m",
      "relative_humidity_2m",
      "precipitation_probability",
      "precipitation",
    ].join(","),
    timezone: location.timezone ?? "auto",
    windspeed_unit: "kmh",
  });
  return `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
}

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
  const url = buildApiUrl(currentLocation);
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Weather API responded with ${response.status}`);
  }
  return response.json();
}

function updateIndicators(current) {
  if (elements.humidityIndicator) {
    const humidity = current.relative_humidity_2m;
    let message = "";
    let severity = "";
    if (typeof humidity === "number") {
      if (humidity >= 85) {
        message = "Peak humidity – ideal for condensation.";
        severity = "highlight";
      } else if (humidity >= 70) {
        message = "Strong humidity window.";
        severity = "";
      } else if (humidity >= 55) {
        message = "Moderate humidity.";
        severity = "warning";
      } else {
        message = "Dry conditions – expect lower yield.";
        severity = "alert";
      }
    }
    elements.humidityIndicator.textContent = message;
    elements.humidityIndicator.className = `indicator${severity ? ` ${severity}` : ""}`;
  }

  if (elements.windIndicator) {
    const windSpeed = current.wind_speed_10m;
    let message = "";
    let severity = "";
    if (typeof windSpeed === "number") {
      if (windSpeed <= 5) {
        message = "Calm winds – capture efficiency high.";
      } else if (windSpeed <= 15) {
        message = "Stable winds.";
        severity = "warning";
      } else {
        message = "Gusty – secure hardware.";
        severity = "alert";
      }
    }
    elements.windIndicator.textContent = message;
    elements.windIndicator.className = `indicator${severity ? ` ${severity}` : ""}`;
  }
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
    timeZone: currentLocation.timezone ?? "Asia/Dubai",
  }).format(date);
}

function updateTrendChart(hourly, startIndex, endIndex) {
  if (!elements.trendCanvas || typeof Chart === "undefined" || !hourly) return;

  const labels = [];
  const temperatureSeries = [];
  const humiditySeries = [];

  for (let i = startIndex; i < endIndex; i += 1) {
    labels.push(formatHourLabel(hourly.time[i]));
    temperatureSeries.push(hourly.temperature_2m?.[i] ?? null);
    humiditySeries.push(hourly.relative_humidity_2m?.[i] ?? null);
  }

  if (!trendChart) {
    const context = elements.trendCanvas.getContext("2d");
    trendChart = new Chart(context, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Temperature (°C)",
            data: temperatureSeries,
            borderColor: "#60a5fa",
            backgroundColor: "rgba(96, 165, 250, 0.15)",
            tension: 0.35,
            fill: true,
            pointRadius: 3,
          },
          {
            label: "Humidity (%)",
            data: humiditySeries,
            borderColor: "#fbbf24",
            backgroundColor: "rgba(251, 191, 36, 0.12)",
            tension: 0.35,
            fill: true,
            pointRadius: 3,
            yAxisID: "humidity",
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            grid: {
              color: "rgba(148, 163, 184, 0.12)",
            },
            ticks: {
              color: "rgba(226, 232, 240, 0.8)",
            },
          },
          humidity: {
            position: "right",
            grid: {
              drawOnChartArea: false,
            },
            ticks: {
              color: "rgba(226, 232, 240, 0.8)",
            },
            suggestedMin: 0,
            suggestedMax: 100,
          },
          x: {
            grid: {
              color: "rgba(148, 163, 184, 0.1)",
            },
            ticks: {
              color: "rgba(226, 232, 240, 0.7)",
              maxRotation: 0,
              minRotation: 0,
            },
          },
        },
        plugins: {
          legend: {
            labels: {
              color: "rgba(226, 232, 240, 0.85)",
            },
          },
          tooltip: {
            callbacks: {
              title(tooltipItems) {
                return tooltipItems[0]?.label ?? "";
              },
            },
          },
        },
      },
    });
    return;
  }

  trendChart.data.labels = labels;
  trendChart.data.datasets[0].data = temperatureSeries;
  trendChart.data.datasets[1].data = humiditySeries;
  trendChart.update("none");
}

function updateCurrent(current, hourly) {
  elements.temperature.textContent = `${formatValue(current.temperature_2m)} °C`;
  elements.apparent.textContent = `${formatValue(current.apparent_temperature)} °C`;
  elements.humidity.textContent = `${formatValue(current.relative_humidity_2m, 0)} %`;
  elements.cloudCover.textContent = `${formatValue(current.cloud_cover, 0)} %`;
  elements.precipitation.textContent = `${formatValue(current.precipitation)} mm`;
  elements.windSpeed.textContent = `${formatValue(current.wind_speed_10m)} km/h`;
  elements.windDirection.textContent = toCardinal(current.wind_direction_10m);

  if (hourly && Array.isArray(hourly.time) && Array.isArray(hourly.precipitation_probability)) {
    const index = hourly.time.indexOf(current.time);
    const probability = index >= 0 ? hourly.precipitation_probability[index] : null;
    elements.precipProb.textContent = `${formatValue(probability, 0)} %`;
  } else {
    elements.precipProb.textContent = "-- %";
  }

  updateIndicators(current);
}

function updateForecast(hourly, currentTime) {
  if (!hourly || !Array.isArray(hourly.time)) {
    elements.forecastBody.innerHTML = "";
    return { startIndex: 0, endIndex: 0 };
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
  return { startIndex, endIndex };
}

function markUpdated() {
  const timestamp = new Date().toLocaleString("en-GB", {
    hour12: false,
    timeZone: currentLocation.timezone ?? "Asia/Dubai",
  });
  elements.lastUpdated.textContent = `Last updated: ${timestamp}`;
}

function loadHistoryStore() {
  try {
    const raw = localStorage.getItem(HISTORY_STORE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    console.warn("Unable to load history store", error);
    return {};
  }
}

function persistHistoryStore() {
  try {
    localStorage.setItem(HISTORY_STORE_KEY, JSON.stringify(historyStore));
  } catch (error) {
    console.warn("Unable to persist history store", error);
  }
}

function loadHistoryForLocation() {
  historyEntries = Array.isArray(historyStore[currentLocation.id])
    ? historyStore[currentLocation.id]
    : [];
  renderHistory();
}

function renderHistory() {
  if (!elements.historyBody) return;
  if (!historyEntries.length) {
    elements.historyBody.innerHTML = `
      <tr>
        <td colspan="5">No logged entries yet.</td>
      </tr>
    `;
    return;
  }

  const displayEntries = historyEntries.slice(-HISTORY_DISPLAY_LIMIT).reverse();
  const rows = displayEntries.map((entry) => {
    const captured = new Date(entry.capturedAt);
    const timestamp = new Intl.DateTimeFormat("en-GB", {
      dateStyle: "short",
      timeStyle: "medium",
      hour12: false,
      timeZone: currentLocation.timezone ?? "Asia/Dubai",
    }).format(captured);
    return `
      <tr>
        <td>${timestamp}</td>
        <td>${formatValue(entry.temperature)} °C</td>
        <td>${formatValue(entry.humidity, 0)} %</td>
        <td>${formatValue(entry.precipitation)} mm</td>
        <td>${formatValue(entry.windSpeed)} km/h</td>
      </tr>
    `;
  });

  elements.historyBody.innerHTML = rows.join("");
}

function appendHistoryEntry(current) {
  const entry = {
    capturedAt: Date.now(),
    observationTime: current.time,
    temperature: current.temperature_2m,
    humidity: current.relative_humidity_2m,
    precipitation: current.precipitation,
    windSpeed: current.wind_speed_10m,
  };

  const lastEntry = historyEntries[historyEntries.length - 1];
  if (lastEntry && lastEntry.observationTime === entry.observationTime) {
    return;
  }

  historyEntries = [...historyEntries.slice(-HISTORY_MAX + 1), entry];
  historyStore[currentLocation.id] = historyEntries;
  persistHistoryStore();
  renderHistory();
}

function exportHistoryToCsv() {
  if (!historyEntries.length) {
    return;
  }

  const header = "Timestamp,Observation Time,Temperature (°C),Humidity (%),Precipitation (mm),Wind (km/h)";
  const rows = historyEntries.map((entry) => {
    const captured = new Date(entry.capturedAt);
    const timestamp = new Intl.DateTimeFormat("en-GB", {
      dateStyle: "short",
      timeStyle: "medium",
      hour12: false,
      timeZone: currentLocation.timezone ?? "Asia/Dubai",
    }).format(captured);
    return [
      timestamp,
      entry.observationTime,
      formatValue(entry.temperature),
      formatValue(entry.humidity, 0),
      formatValue(entry.precipitation),
      formatValue(entry.windSpeed),
    ].join(",");
  });

  const blob = new Blob([`${header}\n${rows.join("\n")}`], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${currentLocation.id}-weather-history.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

async function refreshWeather({ force = false } = {}) {
  const now = Date.now();
  if (!force && lastFetchAt && now - lastFetchAt < MIN_FETCH_INTERVAL) {
    return;
  }
  try {
    const data = await fetchWeather();
    updateCurrent(data.current, data.hourly);
    const range = updateForecast(data.hourly, data.current.time);
    updateTrendChart(data.hourly, range.startIndex, range.endIndex);
    appendHistoryEntry(data.current);
    markUpdated();
    lastFetchAt = Date.now();
    if (elements.status) {
      elements.status.textContent = "";
    }
  } catch (error) {
    console.error("Failed to update weather dashboard", error);
    setStatus("Unable to load live data. Please check your connection and retry.", "error");
  }
}

function applyLocation(location, { silent = false } = {}) {
  currentLocation = location;
  if (elements.heading) {
    elements.heading.textContent = location.headline ?? `${location.label} Weather`;
  }
  if (elements.subtitle) {
    elements.subtitle.textContent = location.subtitle ?? `Live atmospheric metrics for ${location.label}`;
  }
  if (elements.locationSelect) {
    elements.locationSelect.value = location.id;
  }
  if (elements.locationSearch) {
    elements.locationSearch.value = "";
  }
  loadHistoryForLocation();
  lastFetchAt = 0;
  if (!silent) {
    setStatus(`Switching to ${location.label}…`, "info");
    refreshWeather({ force: true });
  }
}

function handleLocationSearch() {
  if (!elements.locationSearch) return;
  const query = elements.locationSearch.value.trim().toLowerCase();
  if (!query) return;

  const match = PRESET_LOCATIONS.find((loc) => loc.label.toLowerCase().includes(query));
  if (match) {
    applyLocation(match);
  }
}

function setupLocations() {
  if (!elements.locationSelect) return;
  elements.locationSelect.innerHTML = "";
  PRESET_LOCATIONS.forEach((location) => {
    const option = document.createElement("option");
    option.value = location.id;
    option.textContent = location.label;
    elements.locationSelect.append(option);
  });

  elements.locationSelect.addEventListener("change", (event) => {
    const next = PRESET_LOCATIONS.find((loc) => loc.id === event.target.value);
    if (next) {
      applyLocation(next);
    }
  });

  if (elements.applyLocation) {
    elements.applyLocation.addEventListener("click", handleLocationSearch);
  }
  if (elements.locationSearch) {
    elements.locationSearch.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        handleLocationSearch();
      }
    });
  }

  applyLocation(currentLocation, { silent: true });
}

function init() {
  historyStore = loadHistoryStore();
  setupLocations();
  loadHistoryForLocation();

  if (elements.exportHistory) {
    elements.exportHistory.addEventListener("click", exportHistoryToCsv);
  }

  refreshWeather({ force: true });
  setInterval(() => {
    refreshWeather();
  }, REFRESH_INTERVAL);
}

document.addEventListener("DOMContentLoaded", init);
