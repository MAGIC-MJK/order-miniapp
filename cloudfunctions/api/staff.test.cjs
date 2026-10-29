const { test } = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const fs = require('node:fs')
const { createRequire } = require('node:module')

function fixture() {
  let store = { users: {}, merchants: {}, bills: { bill: { _id: 'bill', merchantId: 'buyer-shop', payableCents: 10000 } } }
  let openid = 'owner'
  let sequence = 0
  const db = {
    command: { in: (values) => ({ values }) },
    serverDate: () => '2026-10-27T00:00:00.000Z',
    collection(name) {
      store[name] ||= {}
      const query = {
        filter: {}, offset: 0, count: 100,
        where(filter) { this.filter = filter; return this },
        skip(offset) { this.offset = offset; return this },
        limit(count) { this.count = count; return this },
        orderBy() { return this },
        async get() {
          return { data: Object.values(store[name]).filter((row) => Object.entries(this.filter).every(([key, value]) => value?.values ? value.values.includes(row[key]) : row[key] === value)).slice(this.offset, this.offset + this.count) }
        },
        doc(id) {
          return {
            async get() { return { data: store[name][id] || null } },
            async set({ data }) { store[name][id] = { ...data, _id: id } },
            async update({ data }) { assert.ok(store[name][id]); Object.assign(store[name][id], data) }
          }
        },
        async add({ data }) { const id = `row-${++sequence}`; store[name][id] = { ...data, _id: id }; return { _id: id } }
      }
      return query
    },
    async runTransaction(callback) {
      const before = structuredClone(store)
      try { return await callback(db) } catch (error) { store = before; throw error }
    }
  }
  store.users.owner = { _id: 'owner', openid: 'owner', role: 'stall', merchantId: 'sample-stall', status: 'active' }
  const localRequire = createRequire(__filename)
  const context = {
    exports: {}, process: { env: { STALL_OPENIDS: 'owner' } },
    console: { error() {}, warn() {} },
    require: (name) => name === 'wx-server-sdk' ? { init() {}, database: () => db, getWXContext: () => ({ OPENID: openid }) } : localRequire(name)
  }
  vm.runInNewContext(fs.readFileSync(`${__dirname}/index.js`, 'utf8'), context)
  return {
    call: (who, action, payload = {}, viewAs = 'stall') => { openid = who; return context.exports.main({ action, payload, viewAs }) },
    user: (who) => store.users[who],
    logs: () => Object.values(store.audit_logs || {})
  }
}

const application = { name: '测试员工', phone: '13800138000', agreed: true }

test('申请须同意、校验手机号，待审账号不能获得档口数据或审核权限', async () => {
  const f = fixture()
  assert.equal((await f.call('employee', 'staff.apply', { ...application, agreed: false })).ok, false)
  assert.equal((await f.call('employee', 'staff.apply', { ...application, phone: 'wrong' })).ok, false)
  assert.equal((await f.call('employee', 'staff.apply', application)).ok, true)
  assert.equal(f.user('employee').role, 'customer')
  assert.equal((await f.call('employee', 'staff.apply', application)).ok, false)
  assert.equal((await f.call('employee', 'app.bootstrap')).error.code, 'FORBIDDEN')
  assert.equal((await f.call('employee', 'staff.list')).error.code, 'FORBIDDEN')
  assert.equal((await f.call('employee', 'staff.review', { id: 'employee', status: 'active' })).error.code, 'FORBIDDEN')
  assert.equal((await f.call('owner', 'staff.list')).data.items.length, 1)
})

test('开通、账单授权、停用和恢复；保留商家归属并拒绝越权和重复审核', async () => {
  const f = fixture()
  await f.call('employee', 'staff.apply', application)
  const merchantId = f.user('employee').merchantId
  assert.equal((await f.call('owner', 'staff.review', { id: 'employee', status: 'active' })).ok, true)
  assert.equal((await f.call('employee', 'auth.login', { requestedRole: 'stall' })).data.role, 'stall')
  assert.equal((await f.call('employee', 'staff.me')).data.isOwner, false)
  assert.equal((await f.call('employee', 'staff.review', { id: 'owner', status: 'disabled' })).error.code, 'FORBIDDEN')
  assert.equal((await f.call('owner', 'staff.review', { id: 'owner', status: 'disabled' })).error.code, 'FORBIDDEN')
  for (const viewAs of ['stall', 'customer']) {
    assert.equal((await f.call('employee', 'bill.export', {}, viewAs)).error.code, 'FORBIDDEN')
    assert.equal((await f.call('employee', 'bill.adjust', {}, viewAs)).error.code, 'FORBIDDEN')
    assert.equal((await f.call('employee', 'app.bootstrap', {}, viewAs)).data.bills.length, 0)
  }
  await f.call('owner', 'staff.review', { id: 'employee', status: 'active', canViewBills: true })
  assert.equal((await f.call('employee', 'app.bootstrap')).data.bills.length, 1)
  await f.call('owner', 'staff.review', { id: 'employee', status: 'disabled' })
  assert.equal(f.user('employee').merchantId, merchantId)
  assert.equal((await f.call('employee', 'order.transition')).error.code, 'FORBIDDEN')
  assert.equal((await f.call('employee', 'app.bootstrap')).error.code, 'FORBIDDEN')
  assert.equal((await f.call('employee', 'staff.apply', application)).error.code, 'FORBIDDEN')
  assert.equal((await f.call('owner', 'staff.review', { id: 'employee', status: 'disabled' })).error.code, 'CONFLICT')
  assert.equal((await f.call('owner', 'staff.review', { id: 'employee', status: 'active' })).ok, true)
  assert.equal((await f.call('employee', 'staff.me')).data.canViewBills, false)
  assert.ok(f.logs().some((row) => row.action === 'staff.review' && row.targetId === 'employee'))
})

test('拒绝后允许重新申请，人员列表包含全部申请', async () => {
  const f = fixture()
  await f.call('employee', 'staff.apply', application)
  await f.call('owner', 'staff.review', { id: 'employee', status: 'rejected' })
  assert.equal((await f.call('owner', 'staff.review', { id: 'employee', status: 'active' })).error.code, 'CONFLICT')
  assert.equal((await f.call('employee', 'staff.apply', application)).ok, true)
  for (let index = 0; index < 102; index++) await f.call(`applicant-${index}`, 'staff.apply', application)
  assert.equal((await f.call('owner', 'staff.list')).data.items.length, 103)
})
