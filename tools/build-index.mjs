#!/usr/bin/env node
/**
 * 依据官方 marketplace index v1 契约生成 / 校验 index.json
 *
 * 契约: https://github.com/QuantumNous/new-api-plugins/blob/main/docs/marketplace.md
 * 目录约定: plugins/<kind>/<key>/<version>/plugin.js  (+ 同目录 README.md 供人看)
 *
 * 用法:
 *   node tools/build-index.mjs           # 重新生成 index.json
 *   node tools/build-index.mjs --check   # 只校验(index.json 与插件源码是否一致),不写文件
 *
 * 生成内容全部来自插件自身编译后的 meta 与文件字节,不做手工编辑:
 *   - key / version 必须与目录名一致,否则报错退出
 *   - sha256 = plugin.js 字节哈希(安装时前端会校验)
 *   - path 为相对路径,由市场按 index URL 同源解析(GitHub raw / jsDelivr / 镜像皆可)
 */
import { readdirSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TASKS_DIR = join(ROOT, 'plugins', 'tasks')
const INDEX_PATH = join(ROOT, 'index.json')
const CHECK = process.argv.includes('--check')
const INDEX_NAME = 'xiaoqi NewAPI Task Plugins'

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')
const compareVersion = (a, b) => {
  const A = a.split('.').map(Number)
  const B = b.split('.').map(Number)
  for (let i = 0; i < Math.max(A.length, B.length); i += 1) {
    const diff = (A[i] || 0) - (B[i] || 0)
    if (diff) return diff
  }
  return 0
}
const isDir = (p) => existsSync(p) && statSync(p).isDirectory()

const plugins = []
for (const key of readdirSync(TASKS_DIR).sort()) {
  const keyDir = join(TASKS_DIR, key)
  if (!isDir(keyDir)) continue

  const versions = readdirSync(keyDir)
    .filter((version) => isDir(join(keyDir, version)) && existsSync(join(keyDir, version, 'plugin.js')))
    .sort(compareVersion)
  if (versions.length === 0) continue

  const entries = []
  let latestMeta = null
  for (const version of versions) {
    const rel = `plugins/tasks/${key}/${version}/plugin.js`
    const abs = join(ROOT, rel)
    const bytes = readFileSync(abs)
    const meta = (await import(pathToFileURL(abs).href)).meta

    if (meta.key !== key) throw new Error(`${rel}: meta.key="${meta.key}" 与目录名 "${key}" 不一致`)
    if (meta.version !== version) throw new Error(`${rel}: meta.version="${meta.version}" 与目录名 "${version}" 不一致`)

    const entry = {
      version,
      path: rel,
      sha256: sha256(bytes),
      minApiVersion: meta.apiVersion ?? 1,
      kind: 'task',
    }
    if (Array.isArray(meta.allowedHosts) && meta.allowedHosts.length) entry.allowedHosts = meta.allowedHosts
    if (meta.baseUrl) entry.baseUrl = meta.baseUrl
    if (meta.auth) entry.auth = meta.auth
    entries.push(entry)
    latestMeta = meta // 版本升序,循环结束时即最新版
  }

  const plugin = {
    key,
    name: latestMeta.name,
    icon: latestMeta.icon,
    description: latestMeta.description,
    models: latestMeta.models ?? [],
    latest: entries[entries.length - 1].version,
    versions: entries,
  }
  if (Array.isArray(latestMeta.channelTypes) && latestMeta.channelTypes.length) plugin.channelTypes = latestMeta.channelTypes
  // 编译后的展示元数据(最新版):routes / protocols / 用量钩子(本仓库三个插件均无按秒用量钩子)
  for (const field of ['routes', 'protocols', 'usageSchema', 'usageExamples', 'usageProfiles']) {
    const value = latestMeta[field]
    if (Array.isArray(value) ? value.length > 0 : value) plugin[field] = value
  }
  plugins.push(plugin)
}

const index = { indexVersion: 1, name: INDEX_NAME, plugins }
const serialized = `${JSON.stringify(index, null, 2)}\n`
const totalVersions = plugins.reduce((sum, plugin) => sum + plugin.versions.length, 0)

if (CHECK) {
  const current = existsSync(INDEX_PATH) ? readFileSync(INDEX_PATH, 'utf8') : ''
  if (current !== serialized) {
    console.error('index.json 与插件源码不一致,请运行: node tools/build-index.mjs')
    process.exit(1)
  }
  console.log(`index.json 校验通过:${plugins.length} 个插件 / ${totalVersions} 个版本`)
  process.exit(0)
}

writeFileSync(INDEX_PATH, serialized)
console.log(`index.json 已生成:${plugins.length} 个插件 / ${totalVersions} 个版本`)
for (const plugin of plugins) {
  console.log(`  ${plugin.key}@${plugin.latest}  模型 ${plugin.models.length} 个  ${plugin.versions.map((v) => v.version).join(', ')}`)
}
