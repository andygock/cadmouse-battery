const fileInput = document.getElementById("fileInput");
const dropzone = document.getElementById("dropzone");
const errorBox = document.getElementById("error");

let chart;

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
    },
    error: (err) => showError(err.message),
  });
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
        row.level >= 0 &&
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
          pointRadius: 2,
          pointHoverRadius: 5,
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
