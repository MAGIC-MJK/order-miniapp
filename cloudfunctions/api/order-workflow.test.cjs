const { test } = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const fs = require('node:fs')
const { createRequire } = require('node:module')

function fixture(legacy = false) {
  let store = {
    users: {
      owner: { _id: 'owner', openid: 'owner', role: 'stall', merchantId: 'sample-stall', status: 'active' },
      buyer: { _id: 'buyer', openid: 'buyer', role: 'customer', merchantId: 'shop', status: 'active' },
      stranger: { _id: 'stranger', openid: 'stranger', role: 'customer', merchantId: 'other', status: 'active' }
    },
    merchants: { shop: { _id: 'shop', name: '测试客户', status: 'active' }, other: { _id: 'other', status: 'active' } },
    products: {
      p1: { _id: 'p1', code: '301', name: '测试款', status: 'sale', colors: ['白', '黑'], sizes: ['L', 'XL'], basePriceCents: 1000, referenceTotal: 20, reserved: 5 },
      p2: { _id: 'p2', code: '302', name: '测试款二', status: 'sale', colors: ['白'], sizes: ['L'], basePriceCents: 3000, referenceTotal: 10, reserved: 1 }
    },
    orders: { order: {
      _id: 'order', merchantId: 'shop', dateKey: '2026-10-28', status: 'pending', revision: 1,
      items: [
        { id: 'white', productId: 'p1', productCode: '301', color: '白', size: 'L', quantity: 3, unitPriceCents: 1000, unitPrice: 10, subtotalCents: 3000 },
        { id: 'black', productId: 'p1', productCode: '301', color: '黑', size: 'XL', quantity: 2, unitPriceCents: 2000, unitPrice: 20, subtotalCents: 4000 },
        { id: 'second', productId: 'p2', productCode: '302', color: '白', size: 'L', quantity: 1, unitPriceCents: 3000, unitPrice: 30, subtotalCents: 3000 }
      ], totalCents: 10000, originalCents: 10000, payableCents: 10000,
      ...(legacy ? {} : { accountingStatus: 'unposted' })
    } },
    bills: legacy ? { 'shop_2026-10-28': { _id: 'shop_2026-10-28', merchantId: 'shop', dateKey: '2026-10-28', originalCents: 10000, payableCents: 10000, status: 'open' } } : {}
  }
  let sequence = 0
  let transactionQueue = Promise.resolve()
  const db = {
    command: { in: (values) => ({ values }), inc: (value) => ({ increment: value }) },
    serverDate: () => '2026-10-28T00:00:00.000Z',
    collection(name) {
      store[name] ||= {}
      return {
        filter: {}, count: 100,
        where(filter) { this.filter = filter; return this }, orderBy() { return this }, limit(count) { this.count = count; return this },
        async get() { return { data: structuredClone(Object.values(store[name]).filter((row) => Object.entries(this.filter).every(([key, value]) => value?.values ? value.values.includes(row[key]) : row[key] === value)).slice(0, this.count)) } },
        doc(id) { return {
          async get() { return { data: structuredClone(store[name][id] || null) } },
          async set({ data }) { store[name][id] = { ...structuredClone(data), _id: id } },
          async update({ data }) {
            assert.ok(store[name][id], `${name}/${id} missing`)
            for (const [key, value] of Object.entries(data)) store[name][id][key] = value?.increment !== undefined ? (store[name][id][key] || 0) + value.increment : structuredClone(value)
          }
        } },
        async add({ data }) { const id = `row-${++sequence}`; store[name][id] = { ...structuredClone(data), _id: id }; return { _id: id } }
      }
    },
    runTransaction(callback) {
      const result = transactionQueue.then(async () => {
        const before = structuredClone(store)
        try { return await callback(db) } catch (error) { store = before; throw error }
      })
      transactionQueue = result.catch(() => {})
      return result
    }
  }
  const localRequire = createRequire(__filename)
  let caller = 'owner'
  const context = { exports: {}, process: { env: { STALL_OPENIDS: 'owner' } }, console: { error() {}, warn() {} },
    require: (name) => name === 'wx-server-sdk' ? { init() {}, database: () => db, getWXContext: () => ({ OPENID: caller }) } : localRequire(name) }
  vm.runInNewContext(fs.readFileSync(`${__dirname}/index.js`, 'utf8'), context)
  return {
    row: (name, id) => store[name]?.[id], rows: (name) => Object.values(store[name] || {}),
    async call(action, payload = {}, who = 'owner') { caller = who; return context.exports.main({ action, payload, viewAs: who === 'owner' ? 'stall' : 'customer' }) },
    transition(nextStatus, extra = {}) { return this.call('order.transition', { orderId: 'order', nextStatus, ...extra }) }
  }
}

const full = [{ lineId: 'white', quantity: 3 }, { lineId: 'black', quantity: 2 }, { lineId: 'second', quantity: 1 }]
const short = [{ lineId: 'white', quantity: 2 }, { lineId: 'black', quantity: 1 }, { lineId: 'second', quantity: 1 }]
function ok(result) { assert.equal(result.ok, true, JSON.stringify(result)); return result.data }

test('新订单从下单到实配入账：下单仅预留、重复提交不再预留', async () => {
  const f = fixture()
  const payload = { idempotencyKey: 'submit-once', items: [{ id: 'new', productCode: '301', color: '白', size: 'L', quantity: 2 }] }
  const result = ok(await f.call('order.submit', payload, 'buyer'))
  assert.equal(f.row('orders', result.orderId).accountingStatus, 'unposted')
  assert.equal(f.rows('bills').length, 0)
  assert.equal(f.row('products', 'p1').reserved, 7)
  assert.equal(ok(await f.call('order.submit', payload, 'buyer')).duplicated, true)
  assert.equal(f.row('products', 'p1').reserved, 7)
  ok(await f.call('order.transition', { orderId: result.orderId, nextStatus: 'picking' }))
  ok(await f.call('order.transition', { orderId: result.orderId, nextStatus: 'packed', packedItems: [{ lineId: 'new', quantity: 2 }] }))
  assert.equal(f.rows('bills')[0].payableCents, 2000)
})

test('逐花色尺码少配：金额、库存、预留、原始记录和重复请求一致', async () => {
  const f = fixture()
  ok(await f.transition('picking'))
  ok(await f.transition('packed', { packedItems: short, note: '白色缺1件，黑色缺1件', revision: 2 }))
  const order = f.row('orders', 'order')
  assert.equal(order.totalCents, 7000)
  assert.equal(order.requestedTotalCents, 10000)
  assert.equal(order.requestedItems[0].quantity, 3)
  assert.equal(order.items[0].quantity, 2)
  assert.equal(order.items[1].quantity, 1)
  assert.equal(order.accountingStatus, 'posted')
  assert.equal(f.row('products', 'p1').referenceTotal, 17)
  assert.equal(f.row('products', 'p1').reserved, 0)
  assert.equal(f.row('products', 'p2').referenceTotal, 9)
  assert.equal(f.row('bills', 'shop_2026-10-28').payableCents, 7000)
  const before = JSON.stringify([f.rows('bills'), f.rows('products'), f.rows('inventory_logs')])
  const duplicates = await Promise.all([f.transition('packed', { packedItems: short }), f.transition('packed', { packedItems: short })])
  duplicates.forEach((result) => assert.equal(ok(result).duplicated, true))
  assert.equal(JSON.stringify([f.rows('bills'), f.rows('products'), f.rows('inventory_logs')]), before)
  ok(await f.transition('awaiting_pickup'))
  ok(await f.transition('received', { note: '本人到档口取货，已核对数量' }))
  assert.equal(f.row('orders', 'order').receiptConfirmedBy, 'stall')
})

test('旧订单已经记账，只核算差额；兼容旧 picked，发货和客户确认可完成', async () => {
  const f = fixture(true)
  ok(await f.transition('picking'))
  ok(await f.transition('picked', { packedItems: short, note: '缺货少配' }))
  assert.equal(f.row('orders', 'order').status, 'packed')
  assert.equal(f.row('bills', 'shop_2026-10-28').payableCents, 7000)
  ok(await f.transition('in_transit'))
  assert.equal(f.row('orders', 'order').deliveryMethod, 'delivery')
  assert.equal((await f.call('order.acknowledge', { orderId: 'order', action: 'received' }, 'stranger')).error.code, 'FORBIDDEN')
  ok(await f.call('order.acknowledge', { orderId: 'order', action: 'received' }, 'buyer'))
  assert.equal(ok(await f.call('order.acknowledge', { orderId: 'order', action: 'received' }, 'buyer')).duplicated, true)
  assert.equal(f.row('orders', 'order').receiptConfirmedBy, 'customer')
  assert.equal(f.row('orders', 'order').events.at(-1).operator, 'customer')
})

test('非法跳转、过早收货、越权、漏行、重复行、超配、负数、小数、无说明和陈旧版本均拒绝', async () => {
  const f = fixture()
  assert.equal((await f.transition('packed', { packedItems: full })).error.code, 'CONFLICT')
  assert.equal((await f.call('order.acknowledge', { orderId: 'order', action: 'received' }, 'buyer')).error.code, 'CONFLICT')
  assert.equal((await f.call('order.transition', { orderId: 'order', nextStatus: 'picking' }, 'buyer')).error.code, 'FORBIDDEN')
  ok(await f.transition('picking'))
  for (const packedItems of [full.slice(1), [full[0], full[0], full[2]], [{ lineId: 'missing', quantity: 1 }, ...full.slice(1)], [{ ...full[0], quantity: 4 }, ...full.slice(1)], [{ ...full[0], quantity: -1 }, ...full.slice(1)], [{ ...full[0], quantity: 1.5 }, ...full.slice(1)], full.map((item) => ({ ...item, quantity: 0 }))]) {
    assert.equal((await f.transition('packed', { packedItems, note: '测试无效输入' })).ok, false)
    assert.equal(f.rows('bills').length, 0)
    assert.equal(f.row('products', 'p1').referenceTotal, 20)
  }
  assert.equal((await f.transition('packed', { packedItems: short })).ok, false)
  assert.equal((await f.transition('packed', { packedItems: full, revision: 1 })).error.code, 'CONFLICT')
})

test('异常恢复保留流水，不重复出库入账；配货前异常恢复后仍可出库', async () => {
  const f = fixture()
  ok(await f.transition('exception', { note: '错款待核对' }))
  ok(await f.transition('picking', { note: '核对完成，按原款配货' }))
  ok(await f.transition('packed', { packedItems: full }))
  ok(await f.transition('exception', { note: '交货前再次核对' }))
  const count = f.rows('inventory_logs').length
  ok(await f.transition('packed', { note: '核对无误，恢复交货' }))
  assert.equal(f.rows('inventory_logs').length, count)
  assert.equal(f.row('bills', 'shop_2026-10-28').payableCents, 10000)
  ok(await f.transition('in_transit'))
  ok(await f.call('order.acknowledge', { orderId: 'order', action: 'issue', note: '数量待核对' }, 'buyer'))
  assert.equal((await f.transition('picking', { note: '不允许重新扣库存' })).error.code, 'CONFLICT')
  ok(await f.transition('in_transit', { note: '核对完成，继续配送' }))
  assert.equal(f.rows('inventory_logs').length, count)
})

test('旧版按商品汇总实配兼容；账单丢失时整笔回滚库存', async () => {
  const f = fixture()
  ok(await f.transition('picking'))
  ok(await f.transition('picked', { packedItems: [{ productId: 'p1', quantity: 5 }, { productId: 'p2', quantity: 1 }] }))
  assert.equal(f.row('products', 'p1').referenceTotal, 15)
  const legacy = fixture(true)
  legacy.row('orders', 'order').dateKey = 'missing-bill'
  ok(await legacy.transition('picking'))
  assert.equal((await legacy.transition('packed', { packedItems: full })).error.code, 'CONFLICT')
  assert.equal(legacy.row('products', 'p1').referenceTotal, 20)
  assert.equal(legacy.rows('inventory_logs').length, 0)
})

test('并发实配提交只出库入账一次，单个订单增量不覆盖同日其他账款', async () => {
  const f = fixture(true)
  f.row('orders', 'order').accountingStatus = 'unposted'
  f.row('bills', 'shop_2026-10-28').originalCents = 5000
  f.row('bills', 'shop_2026-10-28').payableCents = 4200
  f.row('bills', 'shop_2026-10-28').paymentCents = 800
  ok(await f.transition('picking'))
  const results = await Promise.all([f.transition('packed', { packedItems: full, revision: 2 }), f.transition('packed', { packedItems: full, revision: 2 })])
  assert.equal(results.filter((result) => ok(result).duplicated).length, 1)
  assert.equal(f.rows('inventory_logs').length, 2)
  assert.equal(f.row('bills', 'shop_2026-10-28').originalCents, 15000)
  assert.equal(f.row('bills', 'shop_2026-10-28').payableCents, 14200)
  assert.equal(f.row('bills', 'shop_2026-10-28').paymentCents, 800)
})

test('未实配订单不允许账单调整或退货，旧 picked 订单继续交付不重出库', async () => {
  const f = fixture()
  assert.equal((await f.call('bill.adjust', { orderId: 'order', idempotencyKey: 'adjust' })).error.code, 'CONFLICT')
  assert.equal((await f.call('return.submit', { orderId: 'order', items: [], fileIds: [] }, 'buyer')).error.code, 'CONFLICT')
  const legacy = fixture(true)
  legacy.row('orders', 'order').status = 'picked'
  ok(await legacy.transition('awaiting_pickup'))
  assert.equal(legacy.rows('inventory_logs').length, 0)
  assert.equal(legacy.row('bills', 'shop_2026-10-28').payableCents, 10000)
})
