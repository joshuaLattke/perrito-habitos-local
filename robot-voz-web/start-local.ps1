param(
    [ValidateRange(1024, 65535)][int]$Port = 8000,
    [switch]$OpenBrowser
)
$ErrorActionPreference = 'Stop'
$robotPythonOptions = @(
    $env:ROBOT_PYTHON,
    (Join-Path $PSScriptRoot '.venv\Scripts\python.exe'),
    'C:\RobotVoz\.venv\Scripts\python.exe'
)
$robotPython = $robotPythonOptions | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
if (-not $robotPython) {
    throw 'No se encuentra el Python con los modelos. Configura ROBOT_PYTHON con la ruta de su python.exe.'
}
$env:ROBOT_PORT = [string]$Port
$env:ROBOT_HOST = '127.0.0.1'
$env:HF_HUB_OFFLINE = '1'
$env:TRANSFORMERS_OFFLINE = '1'
Write-Host "Laboratorio local: http://localhost:$Port"
Write-Host 'Para detener el servidor, pulsa Ctrl+C o cierra esta ventana.'
$env:ROBOT_OPEN_BROWSER = if ($OpenBrowser) { '1' } else { '0' }
& $robotPython -B -u (Join-Path $PSScriptRoot 'app.py')
if ($LASTEXITCODE -ne 0) { throw 'No se pudo iniciar el servidor. Revisa el mensaje anterior.' }
