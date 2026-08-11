<#
.SYNOPSIS
    Developer helper for the DSR solution. Prevents the "file is locked by DSR.API" build failure.

.DESCRIPTION
    MSBuild cannot overwrite bin\Debug\net9.0\*.dll while the API is running, because the running
    process holds those assemblies open. The fix is always the same: stop the process, then build.
    This script does that in the right order, and offers a watch mode that removes the problem
    entirely by rebuilding and restarting on file change.

.EXAMPLE
    .\dev.ps1 stop         # kill any running API (frees the DLL locks and port 5199)
    .\dev.ps1 build        # stop, then build
    .\dev.ps1 run          # stop, build, run the API
    .\dev.ps1 watch        # stop, then `dotnet watch run` -- rebuilds automatically, no locks
    .\dev.ps1 client       # run the React dev server
    .\dev.ps1 status       # what is running, and on which ports
#>
param(
    [Parameter(Position = 0)]
    [ValidateSet('stop', 'build', 'run', 'watch', 'client', 'status')]
    [string]$Command = 'status'
)

$ErrorActionPreference = 'Stop'
$root      = $PSScriptRoot
$apiPath   = Join-Path $root 'src\DSR.API'
$clientDir = Join-Path $root 'client'
$apiPort   = 5199
$vitePort  = 5173

function Stop-Api {
    # DSR.API is the built executable; `dotnet run` also leaves a dotnet host holding the DLLs.
    $processes = Get-Process -Name 'DSR.API' -ErrorAction SilentlyContinue

    # Only target dotnet processes whose command line points at this solution, so an unrelated
    # dotnet process elsewhere on the machine is left alone.
    $dotnetHosts = Get-CimInstance Win32_Process -Filter "Name = 'dotnet.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -and $_.CommandLine -like "*DSR.API*" }

    if (-not $processes -and -not $dotnetHosts) {
        Write-Host 'No API process running.' -ForegroundColor DarkGray
        return
    }

    foreach ($p in $processes) {
        Write-Host "Stopping DSR.API (PID $($p.Id))" -ForegroundColor Yellow
        Stop-Process -Id $p.Id -Force
    }
    foreach ($p in $dotnetHosts) {
        Write-Host "Stopping dotnet host for DSR.API (PID $($p.ProcessId))" -ForegroundColor Yellow
        try { Stop-Process -Id $p.ProcessId -Force } catch {}
    }

    # Wait for the OS to release the file handles; building immediately can still hit a lock.
    for ($i = 0; $i -lt 20; $i++) {
        Start-Sleep -Milliseconds 250
        if (-not (Get-NetTCPConnection -LocalPort $apiPort -State Listen -ErrorAction SilentlyContinue)) { break }
    }
    Write-Host 'API stopped; DLL locks and port released.' -ForegroundColor Green
}

function Show-Status {
    Write-Host "`nDSR solution status" -ForegroundColor Cyan
    Write-Host ('-' * 46)

    foreach ($item in @(
        @{ Name = "API   (port $apiPort)";  Port = $apiPort },
        @{ Name = "Client(port $vitePort)"; Port = $vitePort }
    )) {
        $listening = Get-NetTCPConnection -LocalPort $item.Port -State Listen -ErrorAction SilentlyContinue
        $state = if ($listening) { 'RUNNING' } else { 'stopped' }
        $colour = if ($listening) { 'Green' } else { 'DarkGray' }
        Write-Host ("{0,-22} {1}" -f $item.Name, $state) -ForegroundColor $colour
    }

    try {
        $health = Invoke-RestMethod "http://127.0.0.1:$apiPort/health/live" -TimeoutSec 3
        Write-Host ("{0,-22} {1}" -f 'API health', $health) -ForegroundColor Green
    } catch {
        Write-Host ("{0,-22} {1}" -f 'API health', 'unreachable') -ForegroundColor DarkGray
    }
    Write-Host ''
}

switch ($Command) {
    'stop'   { Stop-Api }

    'build'  {
        Stop-Api
        Push-Location $root
        try { dotnet build --nologo } finally { Pop-Location }
    }

    'run'    {
        Stop-Api
        Push-Location $apiPath
        try { dotnet run } finally { Pop-Location }
    }

    'watch'  {
        # The real fix: dotnet watch owns the process lifecycle, so it stops the app before
        # rebuilding and never fights itself over a locked DLL.
        Stop-Api
        Push-Location $apiPath
        try { dotnet watch run } finally { Pop-Location }
    }

    'client' {
        Push-Location $clientDir
        try {
            if (-not (Test-Path 'node_modules')) { npm install }
            npm run dev
        } finally { Pop-Location }
    }

    'status' { Show-Status }
}
