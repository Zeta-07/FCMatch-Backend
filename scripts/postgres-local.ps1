param(
    [string]$Bin = $env:PG_BIN,
    [ValidateSet('start', 'stop')][string]$Action = 'start'
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
if (-not $Bin) { $Bin = Join-Path (Split-Path $root -Parent) '.tools/postgres/pgsql/bin' }
if (-not (Test-Path -LiteralPath (Join-Path $Bin 'pg_ctl.exe'))) { throw 'Configura PG_BIN con la carpeta bin de PostgreSQL 18.' }
$local = Join-Path $root '.local'
$data = Join-Path $local 'postgres'
if (-not (Test-Path -LiteralPath $root)) { throw 'Repositorio no encontrado.' }
[System.IO.Directory]::CreateDirectory($local) | Out-Null
if ($Action -eq 'stop') {
    & "$Bin/pg_ctl.exe" -D $data -m fast -w stop
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo detener PostgreSQL.' }
    exit
}
if (-not (Test-Path -LiteralPath (Join-Path $data 'PG_VERSION'))) {
    $password = [Convert]::ToHexString([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
    $pwfile = Join-Path $local 'postgres-admin-password'
    [System.IO.File]::WriteAllText($pwfile, $password)
    & "$Bin/initdb.exe" -D $data -U fcmatch_admin --encoding=UTF8 --locale=C --auth=scram-sha-256 --pwfile=$pwfile
    if ($LASTEXITCODE -ne 0) { throw 'Falló initdb.' }
}
& "$Bin/pg_ctl.exe" -D $data status
if ($LASTEXITCODE -ne 0) {
    & "$Bin/pg_ctl.exe" -D $data -l (Join-Path $local 'postgres.log') -o '-h 127.0.0.1 -p 5433' -w start
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo iniciar PostgreSQL en 127.0.0.1:5433.' }
}
$envFile = Join-Path $root '.env'
if (-not (Test-Path -LiteralPath $envFile)) {
    $appPassword = [Convert]::ToHexString([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
    $env:PGPASSWORD = [System.IO.File]::ReadAllText((Join-Path $local 'postgres-admin-password'))
    try {
        "CREATE ROLE fcmatch LOGIN PASSWORD '$appPassword' NOSUPERUSER NOCREATEDB NOCREATEROLE;" | & "$Bin/psql.exe" -h 127.0.0.1 -p 5433 -U fcmatch_admin -d postgres -v ON_ERROR_STOP=1
        if ($LASTEXITCODE -ne 0) { throw 'Falló la creación del usuario de desarrollo.' }
        foreach ($name in @('fcmatch', 'fcmatch_test')) {
            & "$Bin/createdb.exe" -h 127.0.0.1 -p 5433 -U fcmatch_admin -O fcmatch $name
            if ($LASTEXITCODE -ne 0) { throw "Falló la creación de $name." }
        }
    } finally { $env:PGPASSWORD = $null }
    $template = [System.IO.File]::ReadAllText((Join-Path $root '.env.example'))
    [System.IO.File]::WriteAllText($envFile, $template.Replace(':CAMBIAR@', ":$appPassword@"))
}
'PostgreSQL local preparado. Credenciales en .env y .local/, excluidos de Git.'
