param(
    [Parameter(Mandatory=$true)][string]$InputPath,
    [Parameter(Mandatory=$true)][string]$OutputPath
)

$ErrorActionPreference = 'Stop'
$excel = $null
$workbook = $null

try {
    $excel = New-Object -ComObject Excel.Application
    $excel.Visible = $false
    $excel.DisplayAlerts = $false
    $excel.AskToUpdateLinks = $false

    # UpdateLinks=0 (n'actualise pas les liens externes), ReadOnly=$true (ne modifie jamais le
    # fichier source) : xlTypePDF = 0 pour ExportAsFixedFormat.
    $workbook = $excel.Workbooks.Open($InputPath, 0, $true)
    $workbook.ExportAsFixedFormat(0, $OutputPath)
}
finally {
    if ($workbook) {
        $workbook.Close($false)
        [System.Runtime.Interopservices.Marshal]::ReleaseComObject($workbook) | Out-Null
    }
    if ($excel) {
        $excel.Quit()
        [System.Runtime.Interopservices.Marshal]::ReleaseComObject($excel) | Out-Null
    }
    [System.GC]::Collect()
    [System.GC]::WaitForPendingFinalizers()
}

if (-not (Test-Path $OutputPath)) {
    throw "Excel n'a pas généré de fichier PDF."
}
