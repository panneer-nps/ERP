$ErrorActionPreference = 'Stop'

$envFile = Join-Path $PSScriptRoot '.env'
$exampleFile = Join-Path $PSScriptRoot '.env.example'
if (-not (Test-Path -LiteralPath $envFile)) {
    Copy-Item -LiteralPath $exampleFile -Destination $envFile
}

$securePassword = Read-Host 'Enter the new brick_erp_app password you set in psql' -AsSecureString
if ($securePassword.Length -lt 16) {
    throw 'Use an app password of at least 16 characters.'
}

$passwordPointer = [IntPtr]::Zero
$plainPassword = $null
try {
    $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
    $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
    $encodedPassword = [Uri]::EscapeDataString($plainPassword)
    $contents = Get-Content -LiteralPath $envFile -Raw
    $connectionLine = "DATABASE_URL=postgres://brick_erp_app:${encodedPassword}@localhost:5432/brick_erp"
    if ($contents -match '(?m)^DATABASE_URL=.*$') {
        $contents = [regex]::Replace($contents, '(?m)^DATABASE_URL=.*$', [System.Text.RegularExpressions.MatchEvaluator]{ param($match) $connectionLine }, 1)
    } else {
        $contents = $contents.TrimEnd() + "`r`n$connectionLine`r`n"
    }
    Set-Content -LiteralPath $envFile -Value $contents -Encoding utf8
    Write-Output 'backend/.env updated. The password was not printed.'
} finally {
    if ($passwordPointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
    }
    $plainPassword = $null
    $encodedPassword = $null
    $contents = $null
    $securePassword.Dispose()
}
