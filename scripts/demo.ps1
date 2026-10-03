# 一键演示：构建 -> CLI 演示 -> 重启验证持久化 -> HTTP API 演示
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot/..

Write-Host "==> 构建" -ForegroundColor Cyan
npm run build

Write-Host "`n==> 清空旧数据并运行 CLI 演示" -ForegroundColor Cyan
Remove-Item -Force data/wordboard.sqlite*,data/report.json -ErrorAction SilentlyContinue
node dist/cli/index.js demo

Write-Host "`n==> 重启后查看历史报告（验证 SQLite 持久化）" -ForegroundColor Cyan
$searchId = (node dist/cli/index.js report 1 --out data/report.json) | Out-Null
Write-Host "报告文件: $((Resolve-Path data/report.json).Path)"

Write-Host "`n==> 启动 HTTP 服务（默认自动选择空闲端口）" -ForegroundColor Cyan
$env:PORT = "0"
$proc = Start-Process -FilePath node -ArgumentList "dist/server/index.js" `
  -RedirectStandardOutput data/server.out -RedirectStandardError data/server.err `
  -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 2
$line = Get-Content data/server.out | Select-String "http://127.0.0.1:(\d+)"
$port = $line.Matches[0].Groups[1].Value
Write-Host "服务端口: $port"

try {
  Write-Host "`n-- 健康检查 --"
  Invoke-RestMethod "http://127.0.0.1:$port/api/health" | ConvertTo-Json -Compress

  Write-Host "`n-- 创建第二版字典（演示版本化）--"
  $body = @{ words = @("SHE","HE","HAT"); sourceNote = "compact-v2" } | ConvertTo-Json
  Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$port/api/dict/versions" `
    -ContentType "application/json" -Body $body | ConvertTo-Json -Compress

  Write-Host "`n-- 用新版本搜索棋盘 1 --"
  $sbody = @{ dictVersion = 2; minLength = 2 } | ConvertTo-Json
  Invoke-RestMethod -Method post "http://127.0.0.1:$port/api/boards/1/search" `
    -ContentType "application/json" -Body $sbody | ConvertTo-Json -Depth 6 -Compress

  Write-Host "`n-- 历史报告 1 仍保留旧版本依据 --"
  Invoke-RestMethod "http://127.0.0.1:$port/api/reports/1" | ConvertTo-Json -Depth 6 -Compress

  Write-Host "`n-- 核验非法路径（重复格，文本能拼成 HEEH 也拒绝）--"
  $vbody = @{
    word = "HEEH"
    path = @(
      @{ row = 0; col = 1 }, @{ row = 0; col = 2 },
      @{ row = 1; col = 0 }, @{ row = 0; col = 1 }
    )
  } | ConvertTo-Json -Depth 5
  Invoke-RestMethod -Method post "http://127.0.0.1:$port/api/boards/1/verify-path" `
    -ContentType "application/json" -Body $vbody | ConvertTo-Json -Depth 6 -Compress
}
finally {
  Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
  Write-Host "`nDemo finished, server stopped." -ForegroundColor Green
}
