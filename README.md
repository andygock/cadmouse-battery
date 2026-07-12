# CadMouse Battery

Small static viewer plus PowerShell logger for tracking a 3Dconnexion CadMouse Pro Wireless battery level over time.

## What it does

- `Log-CadMouseBattery.ps1` reads the 3Dconnexion driver state XML and appends a timestamped battery reading to a CSV file.
- `index.html` + `script.js` load that CSV, plot battery level over time, and detect discharge cycles.
- `sample/cadmouse-battery.csv` shows the expected output format.

## Requirements

- Windows
- 3Dconnexion driver installed
- PowerShell
- A modern browser
- Internet access for the chart dependencies loaded from CDN in `index.html`

## Logging battery data

Run `Log-CadMouseBattery.ps1` to append one row to the CSV:

- Source state file: `%LOCALAPPDATA%\3Dconnexion\3DxWare\3DxServiceState.xml`
- Output CSV: `%USERPROFILE%\cadmouse-battery.csv`
- Device name used by default: `CadMouse Pro Wireless`

The script writes rows like:

```csv
Timestamp,BatteryLevel
2026-07-02 12:00:00,78
```

The script always writes `Timestamp`, `BatteryLevel`, and `Error` columns. If the driver state cannot be read, the device is missing, or the reported battery level is invalid, it appends a row with the timestamp and an error message in the `Error` column.

### Scheduling

The intended use is to run the script on a regular interval with Windows Task Scheduler.

Example:

```powershell
powershell.exe -ExecutionPolicy Bypass -File "S:\www\cadmouse-battery\Log-CadMouseBattery.ps1"
```

If your mouse model appears under a different name in the 3Dconnexion XML, update `$deviceName` in the script.

## Viewing the data

Open `index.html` in a browser, then drop a CSV file onto the page or choose one with the file picker.

The viewer expects a CSV with these columns:

- `Timestamp`
- `BatteryLevel`
- `Error` is optional and ignored by the viewer

Rows must contain a valid timestamp and a numeric battery level from 0 to 100. Invalid rows are ignored.

## UI output

The page shows:

- number of parsed rows
- number of detected discharge cycles
- average discharge rate per day
- observed battery range
- a time-series chart
- a cycle table with start/end timestamps, level change, duration, and loss per day

## Project layout

- `index.html` - app shell and CDN imports
- `script.js` - CSV parsing, cycle detection, chart rendering, and table rendering
- `styles.css` - page styling
- `Log-CadMouseBattery.ps1` - battery logging script
- `sample/cadmouse-battery.csv` - example export

## Notes

- Timestamps are parsed as local time.
- The chart uses Chart.js 4.5.1 and chartjs-adapter-date-fns 3.0.0.
- The CSV parser is Papa Parse 5.5.4.
