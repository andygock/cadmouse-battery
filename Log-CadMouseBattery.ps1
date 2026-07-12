# Logs current CadMouse Pro Wireless battery level into a cadmouse-battery.csv file
#
# Useful to set this up into Windows task scheduler to log at regular intervals
#

$stateFile = "$env:LOCALAPPDATA\3Dconnexion\3DxWare\3DxServiceState.xml"
$csvFile = "$env:USERPROFILE\cadmouse-battery.csv"
$deviceName = "CadMouse Pro Wireless"
$maxWriteAttempts = 3
$csvColumns = @("Timestamp", "BatteryLevel", "Error")

function Update-CsvSchema {
    param (
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [string[]]$Columns
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        return
    }

    $existingRows = @(Import-Csv -LiteralPath $Path)
    if ($existingRows.Count -eq 0) {
        return
    }

    $existingColumns = $existingRows[0].PSObject.Properties.Name
    $missingColumns = $Columns | Where-Object { $_ -notin $existingColumns }
    if ($missingColumns.Count -eq 0) {
        return
    }

    $existingRows |
    ForEach-Object {
        $existingRow = $_
        $normalizedRow = [ordered]@{}

        foreach ($column in $Columns) {
            $normalizedRow[$column] = if ($column -in $existingColumns) {
                $existingRow.$column
            }
            else {
                ""
            }
        }

        [pscustomobject]$normalizedRow
    } |
    Export-Csv -LiteralPath $Path -NoTypeInformation
}

try {
    [xml]$xml = Get-Content $stateFile

    $device = $xml.DriverState.DeviceInfoList.Device |
    Where-Object { $_.Name -eq $deviceName } |
    Select-Object -First 1

    if ($null -eq $device) {
        throw "Device '$deviceName' was not found in '$stateFile'."
    }

    $batteryLife = $device.Battery.Life
    if ($null -eq $batteryLife -or $batteryLife -notmatch '^\d+$') {
        throw "Device '$deviceName' did not report a numeric battery level."
    }

    $batteryLevel = [int]$batteryLife
    if ($batteryLevel -lt 0 -or $batteryLevel -gt 100) {
        throw "Device '$deviceName' reported battery level '$batteryLevel', expected 0 to 100."
    }

    $row = [pscustomobject]@{
        Timestamp    = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
        BatteryLevel = $batteryLevel
        Error        = ""
    }
}
catch {
    $row = [pscustomobject]@{
        Timestamp    = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
        BatteryLevel = ""
        Error        = $_.Exception.Message
    }
}

for ($attempt = 1; $attempt -le $maxWriteAttempts; $attempt++) {
    try {
        Update-CsvSchema -Path $csvFile -Columns $csvColumns
        $row | Export-Csv -Path $csvFile -NoTypeInformation -Append -ErrorAction Stop
        break
    }
    catch {
        if ($attempt -eq $maxWriteAttempts) {
            throw
        }

        Start-Sleep -Milliseconds (250 * $attempt)
    }
}
