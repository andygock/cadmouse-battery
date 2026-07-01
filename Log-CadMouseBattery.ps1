# Logs current CadMouse Pro Wireless battery level into a cadmouse-battery.csv file
#
# Useful to set this up into Windows task scheduler to log at regular intervals
#

$stateFile = "$env:LOCALAPPDATA\3Dconnexion\3DxWare\3DxServiceState.xml"
$csvFile = "$env:USERPROFILE\cadmouse-battery.csv"
$deviceName = "CadMouse Pro Wireless"

try {
    [xml]$xml = Get-Content $stateFile

    $device = $xml.DriverState.DeviceInfoList.Device |
    Where-Object { $_.Name -eq $deviceName } |
    Select-Object -First 1

    $row = [pscustomobject]@{
        Timestamp    = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
        BatteryLevel = [int]$device.Battery.Life
    }
}
catch {
    $row = [pscustomobject]@{
        Timestamp    = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
        BatteryLevel = ""
        Error        = $_.Exception.Message
    }
}

$row | Export-Csv -Path $csvFile -NoTypeInformation -Append