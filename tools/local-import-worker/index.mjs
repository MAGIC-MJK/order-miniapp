import crypto from 'node:crypto'
import { loadEnvFile } from 'node:process'
import { fileURLToPath } from 'node:url'
import cloudbase from '@cloudbase/node-sdk'
import puppeteer from 'puppeteer-core'

try {
  loadEnvFile(fileURLToPath(new URL('.env', import.meta.url)))
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}

const required = ['CLOUDBASE_ENV_ID', 'TENCENTCLOUD_SECRETID', 'TENCENTCLOUD_SECRETKEY']
const missing = required.filter((key) => !process.env[key])
if (missing.length) {
  console.error(`缺少环境变量：${missing.join(', ')}`)
  process.exit(1)
}

const app = cloudbase.init({
  env: process.env.CLOUDBASE_ENV_ID,
  secretId: process.env.TENCENTCLOUD_SECRETID,
  secretKey: process.env.TENCENTCLOUD_SECRETKEY
})
const db = app.database()
const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434'
const model = process.env.OLLAMA_MODEL || 'minicpm-v4.5'
const pollMs = Math.max(1000, Number(process.env.WORKER_POLL_MS) || 3000)
const confidenceThreshold = Math.min(1, Math.max(0, Number(process.env.IMPORT_CONFIDENCE_THRESHOLD) || 0.85))
const runOnce = process.argv.includes('--once')
const workerId = process.env.WORKER_ID || 'local-mac'

function clean(value, max = 100) {
  return String(value || '').trim().slice(0, max)
}

function safeJson(value) {
  const text = String(value || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  return JSON.parse(text)
}

function validateShareUrl(raw) {
  const url = new URL(raw)
  if (url.protocol !== 'https:' || url.hostname !== 'erp.huice.com' || !url.pathname.startsWith('/public/share/')) {
    throw new Error('仅允许处理慧策 HTTPS 分享链接')
  }
  return url.toString()
}

async function getCatalog(merchantId) {
  const [productResult, merchantResult] = await Promise.all([
    db.collection('products').where({ status: 'sale' }).limit(100).get(),
    db.collection('merchants').doc(merchantId).get()
  ])
  const products = productResult.data || []
  const aliases = Array.isArray(merchantResult.data?.productAliases) ? merchantResult.data.productAliases : []
  return { products, aliases }
}

async function downloadCloudImages(fileIds) {
  const result = await app.getTempFileURL({ fileList: fileIds })
  const entries = result.fileList || []
  return Promise.all(entries.map(async (entry) => {
    if (entry.code && entry.code !== 'SUCCESS') throw new Error(entry.message || '获取截图临时地址失败')
    const response = await fetch(entry.tempFileURL)
    if (!response.ok) throw new Error(`下载截图失败：${response.status}`)
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length > 12 * 1024 * 1024) throw new Error('单张截图超过 12MB')
    return buffer.toString('base64')
  }))
}

async function renderLink(rawUrl) {
  const url = validateShareUrl(rawUrl)
  const executablePath = process.env.CHROME_EXECUTABLE_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--disable-dev-shm-usage'] })
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1440, height: 2200, deviceScaleFactor: 1 })
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 })
    await new Promise((resolve) => setTimeout(resolve, 2500))
    const text = clean(await page.evaluate(() => document.body?.innerText || ''), 240000)
    const screenshot = await page.screenshot({ type: 'jpeg', quality: 86, fullPage: true })
    if (screenshot.length > 12 * 1024 * 1024) throw new Error('链接页面过长，请改用截图导单')
    return { text, image: Buffer.from(screenshot).toString('base64') }
  } finally {
    await browser.close()
  }
}

function buildPrompt(products, linkText = '') {
  const catalog = products.map((product) => ({
    productId: product._id,
    productCode: product.code,
    name: product.name,
    colors: product.colors,
    sizes: product.sizes
  }))
  return `你是服装档口订单识别助手。识别订单截图或分享页中的裤子款号、花色、尺码和数量。

只允许匹配以下商品目录：
${JSON.stringify(catalog)}

规则：
1. 相同款号、花色、尺码必须合并数量。
2. 图片外观只能帮助匹配款式，文字表格中的尺码和数量优先。
3. 不确定时不要编造，保留最可能的款号并把 confidence 设为 0.7 以下。
4. quantity 必须是正整数。
5. 只返回 JSON，不要解释，格式为：
{"items":[{"productCode":"503","color":"米白","size":"L","quantity":2,"confidence":0.95}],"notes":[]}
${linkText ? `\n分享页文本：\n${linkText}` : ''}`
}

function parseHuiceText(text) {
  const items = []
  const lines = String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  for (let index = 0; index < lines.length - 5; index += 1) {
    const productLine = lines[index].match(/^(.+)-([^-]+)-([A-Za-z0-9]+)$/)
    if (!productLine || !lines[index + 1].startsWith('总数量:') || lines[index + 2] !== lines[index] || lines[index + 4] !== '数量:') continue
    const [color, size] = lines[index + 3].split(';')
    const quantity = Number(lines[index + 5])
    if (!color || !size || !Number.isInteger(quantity) || quantity <= 0) continue
    const skuAndName = productLine[1]
    const codeMatch = skuAndName.match(/^([A-Za-z0-9#._-]+)/)
    const externalProductCode = clean(codeMatch?.[1] || skuAndName, 40)
    items.push({ productCode: externalProductCode, color: clean(color, 40), size: clean(size, 40), quantity, confidence: 1 })
    index += 5
  }
  return { items }
}

async function askOllama(prompt, images) {
  const response = await fetch(`${ollamaBaseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      format: 'json',
      options: { temperature: 0 },
      messages: [{ role: 'user', content: prompt, ...(images.length ? { images } : {}) }]
    }),
    signal: AbortSignal.timeout(10 * 60 * 1000)
  })
  if (!response.ok) throw new Error(`Ollama 调用失败：${response.status}`)
  const data = await response.json()
  return safeJson(data.message?.content)
}

function normaliseResult(raw, products, aliases, source) {
  const productMap = new Map(products.map((product) => [String(product.code), product]))
  const aliasMap = new Map(aliases.map((alias) => [String(alias.externalCode), productMap.get(String(alias.productCode)) || products.find((product) => product._id === alias.productId)]))
  const grouped = new Map()
  for (const candidate of Array.isArray(raw.items) ? raw.items : []) {
    const externalProductCode = clean(candidate.productCode, 40)
    const product = productMap.get(externalProductCode) || aliasMap.get(externalProductCode)
    const productCode = product?.code || externalProductCode
    const color = clean(candidate.color, 40)
    const size = clean(candidate.size, 40).toUpperCase()
    const quantity = Math.round(Number(candidate.quantity))
    const confidence = Math.min(1, Math.max(0, Number(candidate.confidence) || 0))
    if (!quantity || quantity < 1 || quantity > 999) continue
    const colorValid = Boolean(product?.colors?.includes(color))
    const sizeValid = Boolean(product?.sizes?.map((item) => item.toUpperCase()).includes(size))
    const key = `${externalProductCode}|${productCode}|${color}|${size}`
    const previous = grouped.get(key)
    grouped.set(key, {
      product,
      externalProductCode,
      productCode,
      color,
      size,
      quantity: quantity + (previous?.quantity || 0),
      confidence: Math.min(confidence, previous?.confidence ?? 1),
      needsReview: !product || !colorValid || !sizeValid || confidence < confidenceThreshold
    })
  }
  return [...grouped.values()].map((line) => ({
    id: `import-${crypto.randomUUID()}`,
    productId: line.product?._id,
    productCode: line.productCode,
    externalProductCode: !line.product || line.externalProductCode !== line.productCode ? line.externalProductCode : undefined,
    name: line.product?.name || `待映射外部款号 ${line.externalProductCode}`,
    color: line.color,
    size: line.size,
    specs: line.size,
    quantity: line.quantity,
    unitPrice: line.product ? Number((Number(line.product.basePriceCents) / 100).toFixed(2)) : 0,
    source,
    confidence: line.confidence,
    needsReview: line.needsReview
  }))
}

async function claimTask() {
  const result = await db.collection('import_tasks').where({ status: 'queued' }).orderBy('createdAt', 'asc').limit(1).get()
  const task = result.data?.[0]
  if (!task) return null
  const latest = await db.collection('import_tasks').doc(task._id).get()
  if (latest.data.status !== 'queued') return null
  await db.collection('import_tasks').doc(task._id).update({
    status: 'processing',
    progress: 10,
    message: `本地模型 ${model} 正在识别`,
    workerId,
    startedAt: new Date(),
    updatedAt: new Date()
  })
  return task
}

async function processTask(task) {
  try {
    const { products, aliases } = await getCatalog(task.merchantId)
    if (!products.length) throw new Error('商品目录为空，请先执行初始化商品数据')
    let images = []
    let linkText = ''
    if (task.source === 'screenshot') images = await downloadCloudImages(task.fileIds || [])
    if (task.source === 'link') {
      const rendered = await renderLink(task.url)
      linkText = rendered.text
      images = [rendered.image]
    }
    await db.collection('import_tasks').doc(task._id).update({ progress: 45, message: '正在提取并合并同类项', updatedAt: new Date() })
    const raw = task.source === 'link' ? parseHuiceText(linkText) : await askOllama(buildPrompt(products, linkText), images)
    const result = normaliseResult(raw, products, aliases, task.source)
    if (!result.length) throw new Error('未识别到可用订单行，请换清晰截图重试')
    const needsReview = result.some((item) => item.needsReview)
    await db.collection('import_tasks').doc(task._id).update({
      status: needsReview ? 'review' : 'completed',
      progress: 100,
      message: needsReview ? '已导入，部分款式需要人工确认' : '识别完成，已合并同类项',
      result,
      modelInfo: { provider: 'ollama', model, confidenceThreshold },
      finishedAt: new Date(),
      updatedAt: new Date()
    })
    console.log(`[${task._id}] 完成，共 ${result.length} 行`)
  } catch (error) {
    console.error(`[${task._id}]`, error)
    await db.collection('import_tasks').doc(task._id).update({
      status: 'failed',
      message: clean(error.message, 300),
      finishedAt: new Date(),
      updatedAt: new Date()
    })
    if (Array.isArray(task.fileIds) && task.fileIds.length) {
      try {
        await app.deleteFile({ fileList: task.fileIds })
        await db.collection('import_tasks').doc(task._id).update({ fileIds: [], sourceFilesDeletedAt: new Date(), updatedAt: new Date() })
      } catch (cleanupError) {
        console.error(`[${task._id}] 失败截图清理未完成`, cleanupError)
      }
    }
  }
}

async function loop() {
  console.log(`导单 worker 已启动，模型：${model}`)
  do {
    await db.collection('import_tasks').doc(`worker_${workerId}`).set({ kind: 'worker_status', online: true, model, updatedAt: new Date() })
    const task = await claimTask()
    if (task) await processTask(task)
    if (runOnce) break
    await new Promise((resolve) => setTimeout(resolve, task ? 200 : pollMs))
  } while (true)
}

loop().catch((error) => {
  console.error(error)
  process.exit(1)
})
