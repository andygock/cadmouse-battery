const fileInput = document.getElementById("fileInput");
const dropzone = document.getElementById("dropzone");
const errorBox = document.getElementById("error");

// The cache deliberately contains a single, predictably keyed snapshot. Using
// `put` with this key means every successful CSV import replaces the previous
// plot data instead of allowing old imports to accumulate in IndexedDB.
const DATABASE_NAME = "cadmouse-battery";
const DATABASE_VERSION = 1;
const STORE_NAME = "plot-data";
const SNAPSHOT_KEY = "latest";

let chart;
let fileLoadStarted = false;

restorePlotData();

fileInput.addEventListener("change", (event) => {
  const file = event.target.files[0];
  if (file) loadFile(file);
});

dropzone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropzone.classList.add("dragover");
});

dropzone.addEventListener("dragleave", () => {
  dropzone.classList.remove("dragover");
});

dropzone.addEventListener("drop", (event) => {
  event.preventDefault();
  dropzone.classList.remove("dragover");

  const file = event.dataTransfer.files[0];
  if (file) loadFile(file);
});

function loadFile(file) {
  // Prevent an in-flight cache restore from replacing a plot the user has
  // explicitly chosen after opening the page.
  fileLoadStarted = true;
  errorBox.textContent = "";
  clearResults();

  Papa.parse(file, {
    header: true,
    skipEmptyLines: true,
    complete: (result) => {
      const rows = parseRows(result.data);
      if (rows.length < 2) {
        showError("CSV needs at least two valid rows.");
        return;
      }

      render(rows);

      // Rendering should remain successful even when browser storage is
      // unavailable (for example, in a restricted private-browsing context).
      // A storage failure is therefore reported in the console without hiding
      // or clearing the valid plot the user has just loaded.
      savePlotData(rows).catch((error) => {
        console.error("Could not save the plot data to IndexedDB.", error);
      });
    },
    error: (err) => showError(err.message),
  });
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function savePlotData(rows) {
  const database = await openDatabase();

  try {
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);

      // Dates are reconstructed from the original timestamp text on restore,
      // so the persisted snapshot only contains the data needed by the plot.
      store.put({
        id: SNAPSHOT_KEY,
        rows: rows.map((row) => ({
          timestamp: row.timestamp,
          level: row.level,
        })),
      });

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

async function restorePlotData() {
  try {
    const database = await openDatabase();
    let snapshot;

    try {
      snapshot = await new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, "readonly");
        const request = transaction.objectStore(STORE_NAME).get(SNAPSHOT_KEY);

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally {
      database.close();
    }

    if (!snapshot || !Array.isArray(snapshot.rows)) {
      return;
    }

    // Pass restored values through the same validation and sorting used for a
    // newly imported CSV. This prevents malformed or obsolete cached records
    // from reaching Chart.js if the stored schema ever changes.
    const rows = parseRows(
      snapshot.rows.map((row) => ({
        Timestamp: row.timestamp,
        BatteryLevel: row.level,
      })),
    );

    if (rows.length >= 2 && !fileLoadStarted) {
      render(rows);
    }
  } catch (error) {
    // IndexedDB is an enhancement rather than a requirement for importing a
    // CSV, so a restore failure must not make the rest of the app unusable.
    console.error("Could not restore the plot data from IndexedDB.", error);
  }
}

function parseRows(rawRows) {
  return rawRows
    .map((row) => {
      const timestamp = String(row.Timestamp ?? "").trim();
      const batteryLevel = String(row.BatteryLevel ?? "").trim();

      if (!timestamp || !batteryLevel) {
        return null;
      }

      return {
        timestamp,
        date: parseLocalDate(timestamp),
        level: Number(batteryLevel),
      };
    })
    .filter(
      (row) =>
        row &&
        row.timestamp &&
        row.date instanceof Date &&
        !Number.isNaN(row.date.getTime()) &&
        Number.isFinite(row.level) &&
        row.level > 0 &&
        row.level <= 100,
    )
    .sort((a, b) => a.date - b.date);
}

function parseLocalDate(value) {
  return new Date(value.replace(" ", "T"));
}

function getDischargeCycles(rows) {
  const cycles = [];
  let current = null;

  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1];
    const curr = rows[i];
    const delta = curr.level - prev.level;

    if (delta < 0) {
      if (!current) {
        current = {
          start: prev,
          end: curr,
        };
      } else {
        current.end = curr;
      }
    } else if (delta === 0 && current) {
      current.end = curr;
    } else if (delta > 0) {
      if (current && current.start.level > current.end.level) {
        cycles.push(current);
      }
      current = null;
    }
  }

  if (current && current.start.level > current.end.level) {
    cycles.push(current);
  }

  return cycles.map((cycle, index) => {
    const loss = cycle.start.level - cycle.end.level;
    const durationMs = cycle.end.date - cycle.start.date;
    const durationDays = durationMs / 86400000;
    const lossPerDay = durationDays > 0 ? loss / durationDays : 0;

    return {
      index: index + 1,
      ...cycle,
      loss,
      durationMs,
      durationDays,
      lossPerDay,
    };
  });
}

function render(rows) {
  const cycles = getDischargeCycles(rows);
  const levels = rows.map((row) => row.level);

  document.getElementById("rowsParsed").textContent = rows.length;
  document.getElementById("cycleCount").textContent = cycles.length;
  document.getElementById("range").textContent =
    `${Math.min(...levels)}% to ${Math.max(...levels)}%`;

  const averageLossPerDay = cycles.length
    ? cycles.reduce((sum, cycle) => sum + cycle.lossPerDay, 0) / cycles.length
    : 0;

  document.getElementById("avgLossDay").textContent = cycles.length
    ? `${averageLossPerDay.toFixed(2)}% / day`
    : "-";

  renderChart(rows);
  renderCycleTable(cycles);
}

function clearResults() {
  document.getElementById("rowsParsed").textContent = "0";
  document.getElementById("cycleCount").textContent = "0";
  document.getElementById("avgLossDay").textContent = "-";
  document.getElementById("range").textContent = "-";
  document.getElementById("cycleTable").textContent = "";

  if (chart) {
    chart.destroy();
    chart = null;
  }
}

function renderChart(rows) {
  const ctx = document.getElementById("chart");

  if (chart) chart.destroy();

  chart = new Chart(ctx, {
    type: "line",
    data: {
      datasets: [
        {
          label: "Battery level",
          data: rows.map((row) => ({
            x: row.date.getTime(),
            y: row.level,
            timestamp: row.timestamp,
          })),
          borderWidth: 2,
          pointRadius: 1,
          pointHoverRadius: 4,
          tension: 0,
          fill: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      parsing: false,
      interaction: {
        mode: "nearest",
        intersect: false,
      },
      scales: {
        y: {
          min: 0,
          max: 100,
          title: {
            display: true,
            text: "Battery level (%)",
          },
        },
        x: {
          type: "time",
          bounds: "data",
          time: {
            unit: "day",
            stepSize: 1,
            displayFormats: {
              day: "yyyy-MM-dd",
            },
            tooltipFormat: "yyyy-MM-dd HH:mm:ss",
          },
          ticks: {
            source: "auto",
            autoSkip: false,
            maxRotation: 0,
            major: {
              enabled: true,
            },
          },
          grid: {
            drawTicks: true,
          },
          title: {
            display: true,
            text: "Date",
          },
        },
      },
      plugins: {
        tooltip: {
          callbacks: {
            title: (items) => {
              if (!items.length) return "";
              return items[0].raw.timestamp;
            },
            label: (item) => `Battery level: ${item.raw.y}%`,
          },
        },
      },
    },
  });
}

function renderCycleTable(cycles) {
  const tbody = document.getElementById("cycleTable");
  tbody.innerHTML = "";

  for (const cycle of cycles) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
          <td>${cycle.index}</td>
          <td>${escapeHtml(cycle.start.timestamp)}</td>
          <td>${escapeHtml(cycle.end.timestamp)}</td>
          <td>${cycle.start.level}%</td>
          <td>${cycle.end.level}%</td>
          <td>${cycle.loss.toFixed(1)}%</td>
          <td>${formatDuration(cycle.durationMs)}</td>
          <td>${cycle.lossPerDay.toFixed(2)}% / day</td>
        `;
    tbody.appendChild(tr);
  }
}

function formatDuration(ms) {
  const hours = ms / 3600000;
  if (hours < 48) return `${hours.toFixed(1)} h`;
  return `${(hours / 24).toFixed(2)} d`;
}

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[char],
  );
}

function showError(message) {
  errorBox.textContent = message;
}
