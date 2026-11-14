/**
 * 「系统自带」OCR：Windows 10/11 内置的 Windows.Media.Ocr（WinRT）。
 *
 * 调用路径：主进程把识别图写临时 PNG → 启动 PowerShell 跑**内联的 WinRT 脚本**
 * （BitmapDecoder 解码 → OcrEngine.RecognizeAsync → 行/词包围盒 JSON 到 stdout）→
 * 主进程归一化成 OcrLineItem。
 *
 * 为什么脚本是**内联字符串**而不是 assets 文件：旧插件时代的 win_ocr_runner.ps1
 * 放在 electron/assets/ 里，但打包流程从不复制该目录——安装包里根本没有这个文件，
 * 属于「开发态能跑、装出来就坏」的暗雷。内联进 TS 随 esbuild 走，运行时写到
 * userData 一次性落地，彻底绕开资源路径问题。
 *
 * 特性：完全离线、零下载、零费用；精度依赖系统语言包（设置 → 时间和语言 → 语言）；
 * 引擎输出**视觉行**（不合并段落）且带**词级包围盒**——比 DeepSeek 的行级 det 盒更细。
 * 仅 Windows 可用；非 Windows 调用返回明确错误。
 */

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { OcrLineItem, OcrPageResult } from '../../shared/ipc/capabilities'

/** WinRT 脚本（内联）：参数 -ImagePath -Lang；stdout 输出一行 JSON */
const PS_SCRIPT = String.raw`
param([string]$ImagePath, [string]$Lang)
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

[Windows.Media.Ocr.OcrEngine, Windows.Foundation.Metadata, ContentType = WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation.Metadata, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.StorageFile, Windows.Foundation.Metadata, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.Streams.RandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime] | Out-Null
[Windows.Globalization.Language, Windows.Foundation.Metadata, ContentType = WindowsRuntime] | Out-Null

function Await-AsyncOp($asyncOp, $type) {
  $asTaskGeneric = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.IsGenericMethod
  } | Select-Object -First 1
  $asTask = $asTaskGeneric.MakeGenericMethod($type)
  $task = $asTask.Invoke($null, @($asyncOp))
  return $task.GetAwaiter().GetResult()
}

try {
  $fullPath = [System.IO.Path]::GetFullPath($ImagePath)
  $file = Await-AsyncOp ([Windows.Storage.StorageFile]::GetFileFromPathAsync($fullPath)) ([Windows.Storage.StorageFile])
  $stream = Await-AsyncOp ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  $decoder = Await-AsyncOp ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $bitmap = Await-AsyncOp ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])

  $engine = $null
  if ($Lang -and $Lang -ne 'auto') {
    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new($Lang))
  }
  if (-not $engine) {
    # 中文优先（学习应用的主场景），再退回用户首选语言
    foreach ($name in @('zh-Hans-CN', 'zh-CN')) {
      $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new($name))
      if ($engine) { break }
    }
  }
  if (-not $engine) {
    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
  }
  if (-not $engine) {
    Write-Output '{"ok":false,"error":"系统没有可用的 OCR 语言包（设置 → 时间和语言 → 语言 中添加）"}'
    exit 0
  }

  $ocrResult = Await-AsyncOp ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])

  $pixelW = [double]$bitmap.PixelWidth
  $pixelH = [double]$bitmap.PixelHeight
  $lines = @()
  foreach ($line in $ocrResult.Lines) {
    # 行盒**只用词框并集**：WinRT 的 OcrLine.BoundingRect 实测不可信（一个 26px 高的
    # 标题行能给 111px 的盒），用它行盒高度会被污染数倍 → 渲染字号随之爆炸
    $minX = [double]::MaxValue
    $minY = [double]::MaxValue
    $maxX = [double]::MinValue
    $maxY = [double]::MinValue
    $words = @()
    foreach ($w in $line.Words) {
      $words += @{
        t = $w.Text
        x = [Math]::Max(0.0, [Math]::Min(1.0, [Math]::Round($w.BoundingRect.X / $pixelW, 4)))
        y = [Math]::Max(0.0, [Math]::Min(1.0, [Math]::Round($w.BoundingRect.Y / $pixelH, 4)))
        w = [Math]::Round($w.BoundingRect.Width / $pixelW, 4)
        h = [Math]::Round($w.BoundingRect.Height / $pixelH, 4)
      }
      if ([double]$w.BoundingRect.X -lt $minX) { $minX = [double]$w.BoundingRect.X }
      if ([double]$w.BoundingRect.Y -lt $minY) { $minY = [double]$w.BoundingRect.Y }
      if (([double]$w.BoundingRect.X + [double]$w.BoundingRect.Width) -gt $maxX) { $maxX = [double]$w.BoundingRect.X + [double]$w.BoundingRect.Width }
      if (([double]$w.BoundingRect.Y + [double]$w.BoundingRect.Height) -gt $maxY) { $maxY = [double]$w.BoundingRect.Y + [double]$w.BoundingRect.Height }
    }
    if ($words.Count -eq 0) {
      # 无词的行回退 Line.BoundingRect（至少保住文本）
      $minX = [double]$line.BoundingRect.X
      $minY = [double]$line.BoundingRect.Y
      $maxX = $minX + [double]$line.BoundingRect.Width
      $maxY = $minY + [double]$line.BoundingRect.Height
    }
    $lines += @{
      t = $line.Text
      x = [Math]::Max(0.0, [Math]::Min(1.0, [Math]::Round($minX / $pixelW, 4)))
      y = [Math]::Max(0.0, [Math]::Min(1.0, [Math]::Round($minY / $pixelH, 4)))
      w = [Math]::Round(($maxX - $minX) / $pixelW, 4)
      h = [Math]::Round(($maxY - $minY) / $pixelH, 4)
      words = $words
    }
  }
  @{ ok = $true; lines = $lines } | ConvertTo-Json -Depth 5 -Compress
} catch {
  @{ ok = $false; error = "$_" } | ConvertTo-Json -Compress
}
`

/** PowerShell 的 JSON 输出 → 共享契约行结构（词级 bbox 一并归一化） */
export function psLinesToOcrLines(parsed: {
  lines?: unknown
}): OcrLineItem[] {
  // PowerShell 5.1 的 ConvertTo-Json 对单元素数组偶尔降级成对象：两种形态都接
  const rawLines = parsed.lines as
    | Array<{ t?: string; x?: number; y?: number; w?: number; h?: number; words?: unknown }>
    | { t?: string; x?: number; y?: number; w?: number; h?: number; words?: unknown }
    | undefined
  const list = Array.isArray(rawLines) ? rawLines : rawLines ? [rawLines] : []
  const out: OcrLineItem[] = []
  for (const l of list) {
    const text = typeof l.t === 'string' ? l.t.trim() : ''
    if (!text || typeof l.x !== 'number' || typeof l.y !== 'number') continue
    const rawWords = (l.words ?? []) as Array<{ t?: string; x?: number; y?: number; w?: number; h?: number }>
    const words = rawWords
      .filter((w) => typeof w.t === 'string' && typeof w.x === 'number' && typeof w.y === 'number')
      .map((w) => ({
        text: w.t as string,
        bbox: { x: w.x as number, y: w.y as number, width: w.w ?? 0, height: w.h ?? 0 },
      }))
    out.push({
      text,
      bbox: { x: l.x, y: l.y, width: l.w ?? 0, height: l.h ?? 0 },
      ...(words.length > 0 ? { words } : {}),
    })
  }
  return out
}

const OCR_TIMEOUT_MS = 15_000

/** 跑一次 Windows OCR：imageDataUrl → 行级结果（bbox 已归一化） */
export async function systemOcr(imageDataUrl: string, lang?: string): Promise<OcrPageResult> {
  if (process.platform !== 'win32') {
    return { page: 0, lines: [], fullText: '', modelId: 'system-ocr', createdAt: 0, rawOcrText: '仅 Windows 支持系统自带 OCR' }
  }
  if (!/^data:image\/\w+;base64,/.test(imageDataUrl)) {
    return { page: 0, lines: [], fullText: '', modelId: 'system-ocr', createdAt: 0, rawOcrText: 'OCR 请求缺少图像' }
  }

  // 脚本常驻 userData（首次写入，之后复用）
  const scriptDir = path.join(os.homedir(), '.unyra')
  const scriptPath = path.join(scriptDir, 'win-ocr-runner.ps1')
  await fsp.mkdir(scriptDir, { recursive: true })
  try {
    if (!fs.existsSync(scriptPath) || fs.readFileSync(scriptPath, 'utf-8') !== PS_SCRIPT) {
      await fsp.writeFile(scriptPath, PS_SCRIPT, 'utf-8')
    }
  } catch {
    return { page: 0, lines: [], fullText: '', modelId: 'system-ocr', createdAt: 0, rawOcrText: '写入 OCR 脚本失败' }
  }

  const bytes = Buffer.from(imageDataUrl.slice(imageDataUrl.indexOf(',') + 1), 'base64')
  const imagePath = path.join(os.tmpdir(), `unyra-ocr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.png`)
  const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47])
  const isPng = bytes.subarray(0, 4).equals(pngHeader)
  const ext = isPng ? '.png' : '.jpg'
  const imagePathFull = imagePath + ext
  await fsp.writeFile(imagePathFull, bytes)

  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      const child = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-ImagePath', imagePathFull, '-Lang', lang ?? 'auto'],
        { windowsHide: true },
      )
      let out = ''
      let err = ''
      const timer = setTimeout(() => {
        try {
          child.kill()
        } catch {}
        reject(new Error('系统 OCR 超时'))
      }, OCR_TIMEOUT_MS)
      child.stdout.on('data', (d: Buffer) => {
        out += d.toString('utf-8')
      })
      child.stderr.on('data', (d: Buffer) => {
        err += d.toString('utf-8')
      })
      child.on('error', (e) => {
        clearTimeout(timer)
        reject(e)
      })
      child.on('close', () => {
        clearTimeout(timer)
        resolve(out || err)
      })
    })

    const start = stdout.indexOf('{')
    if (start < 0) {
      return { page: 0, lines: [], fullText: '', modelId: 'system-ocr', createdAt: 0, rawOcrText: stdout.slice(0, 300) }
    }
    const parsed = JSON.parse(stdout.slice(start)) as { ok?: boolean; error?: string; lines?: unknown }
    if (parsed.ok !== true) {
      return { page: 0, lines: [], fullText: '', modelId: 'system-ocr', createdAt: 0, rawOcrText: parsed.error ?? '系统 OCR 失败' }
    }
    const lines = psLinesToOcrLines(parsed as never)
    return {
      page: 0,
      lines,
      fullText: lines.map((l) => l.text).join('\n'),
      modelId: 'system-ocr',
      createdAt: Date.now(),
      rawOcrText: stdout.slice(start),
    }
  } catch (err) {
    return {
      page: 0,
      lines: [],
      fullText: '',
      modelId: 'system-ocr',
      createdAt: 0,
      rawOcrText: err instanceof Error ? err.message : '系统 OCR 失败',
    }
  } finally {
    await fsp.unlink(imagePathFull).catch(() => undefined)
  }
}
