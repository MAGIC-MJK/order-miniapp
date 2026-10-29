const crypto = require('crypto')
const https = require('https')
const cloud = require('wx-server-sdk')
const sampleProductSeeds = require('./data/sample-products.json')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const command = db.command
const initialStallOpenIds = []

function stableId(prefix, value) {
  return `${prefix}_${crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 24)}`
}

function randomId(prefix) {
  return stableId(prefix, `${Date.now()}-${crypto.randomBytes(16).toString('hex')}`)
}

function dateKey(date = new Date()) {
  return new Date(date.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

function asInteger(value, fallback = 0) {
  const result = Number(value)
  return Number.isFinite(result) ? Math.round(result) : fallback
}

function assert(condition, message, code = 'BAD_REQUEST') {
  if (!condition) {
    const error = new Error(message)
    error.code = code
    throw error
  }
}

function cleanText(value, max = 100) {
  return String(value || '').trim().slice(0, max)
}

function parseSize(value) {
  const raw = cleanText(value, 160)
  const match = raw.match(/^(.+?)[×xX*]\d+\s*件?$/)
  return cleanText(match ? match[1] : raw, 40).toUpperCase()
}

function expandCartItems(items) {
  return items.flatMap((item) => {
    if (cleanText(item.size, 40)) return [item]
    const specs = cleanText(item.specs, 160)
    const segments = specs.split(/[、,，;；/]+/).map((segment) => segment.trim()).filter(Boolean)
    const parsed = segments.map((segment) => segment.match(/^(.+?)[×xX*](\d+)\s*件?$/))
    if (parsed.length && parsed.every(Boolean)) {
      return parsed.map((match, index) => ({
        ...item,
        id: index === 0 ? item.id : `${cleanText(item.id, 60) || 'line'}-${index + 1}`,
        size: cleanText(match[1], 40).toUpperCase(),
        specs: cleanText(match[1], 40).toUpperCase(),
        quantity: asInteger(match[2])
      }))
    }
    return [{ ...item, size: parseSize(specs), specs: parseSize(specs) }]
  })
}

function isNotFound(error) {
  const message = String(error && (error.errMsg || error.message || error))
  return message.includes('does not exist') || message.includes('not found') || message.includes('DOCUMENT_NOT_FOUND')
}

async function getDocument(collection, id, transaction = db) {
  try {
    const result = await transaction.collection(collection).doc(id).get()
    return result.data || null
  } catch (error) {
    if (isNotFound(error)) return null
    throw error
  }
}

function stallOpenIds() {
  return new Set([
    ...initialStallOpenIds,
    ...String(process.env.STALL_OPENIDS || '').split(',').map((item) => item.trim()).filter(Boolean)
  ])
}

async function ensureUser(openid) {
  const users = db.collection('users')
  const configuredAsStall = stallOpenIds().has(openid)
  let user = await getDocument('users', openid)

  if (!user) {
    const role = configuredAsStall ? 'stall' : 'customer'
    const merchantId = role === 'stall' ? 'sample-stall' : stableId('merchant', openid)
    user = {
      openid,
      role,
      merchantId,
      status: 'active',
      profileComplete: false,
      createdAt: db.serverDate(),
      updatedAt: db.serverDate()
    }
    await users.doc(openid).set({ data: user })

    if (role === 'customer') {
      await db.collection('merchants').doc(merchantId).set({
        data: {
          ownerOpenid: openid,
          name: '待完善商家资料',
          phone: '',
          status: 'profile_incomplete',
          createdAt: db.serverDate(),
          updatedAt: db.serverDate()
        }
      })
    }
  } else if (configuredAsStall && user.role !== 'stall') {
    await users.doc(openid).update({
      data: { role: 'stall', merchantId: 'sample-stall', updatedAt: db.serverDate() }
    })
    user = { ...user, role: 'stall', merchantId: 'sample-stall' }
  }

  assert(user.status !== 'disabled', '账号已停用，请联系示例档口', 'ACCOUNT_DISABLED')
  return user
}

function requireStall(user) {
  assert(user.role === 'stall', '当前账号没有档口操作权限', 'FORBIDDEN')
}

function requireOwner(user) {
  requireStall(user)
  assert(stallOpenIds().has(user.openid), '仅主管理员可以管理档口人员', 'FORBIDDEN')
}

function staffIdentity(user) {
  return { isOwner: stallOpenIds().has(user.openid), canViewBills: stallOpenIds().has(user.openid) || user.staffCanViewBills === true }
}

function requireBilling(user) {
  if (user.authorizedRole === 'stall' || user.role === 'stall') {
    assert(staffIdentity(user).canViewBills, '主管理员尚未为您开通账单权限', 'FORBIDDEN')
  }
}

function staffApplication(user) {
  return {
    id: user._id || user.openid, name: user.staffName || '', phone: user.staffPhone || '',
    status: user.staffStatus || 'none', canViewBills: user.staffCanViewBills === true,
    reason: user.staffReviewReason || ''
  }
}

async function staffMeAction(user) {
  return { ...staffIdentity(user), application: staffApplication(user), isStaff: user.authorizedRole === 'stall' || user.role === 'stall' }
}

async function staffApplyAction(user, payload) {
  const name = cleanText(payload.name, 30)
  const phone = cleanText(payload.phone, 11)
  assert(name && /^1\d{10}$/.test(phone), '请填写姓名和正确的手机号')
  assert(payload.agreed === true, '请先阅读并同意协议与隐私政策')
  await db.runTransaction(async (transaction) => {
    const current = await getDocument('users', user.openid, transaction)
    assert(current && current.role !== 'stall' && !stallOpenIds().has(user.openid), '当前账号已拥有档口权限')
    assert(current.staffStatus !== 'pending', '申请正在审核中，请勿重复提交')
    assert(current.staffStatus !== 'disabled', '档口权限已停用，请联系主管理员恢复', 'FORBIDDEN')
    await transaction.collection('users').doc(user.openid).update({ data: {
      staffName: name, staffPhone: phone, staffStatus: 'pending', staffCanViewBills: false,
      staffReviewReason: '', staffAppliedAt: db.serverDate(), updatedAt: db.serverDate()
    } })
    await transaction.collection('audit_logs').add({ data: {
      actorOpenid: user.openid, action: 'staff.apply', targetId: user.openid, createdAt: db.serverDate()
    } })
  })
  return { saved: true }
}

async function staffListAction(user) {
  requireOwner(user)
  const items = []
  let offset = 0
  while (true) {
    const result = await db.collection('users').where({ staffStatus: command.in(['pending', 'active', 'rejected', 'disabled']) }).skip(offset).limit(100).get()
    items.push(...(result.data || []).filter((item) => !stallOpenIds().has(item.openid || item._id)).map(staffApplication))
    if ((result.data || []).length < 100) break
    offset += 100
  }
  return { items }
}

async function staffReviewAction(user, payload) {
  requireOwner(user)
  const targetId = cleanText(payload.id, 80)
  const status = cleanText(payload.status, 20)
  const reason = cleanText(payload.reason, 150)
  assert(targetId && !stallOpenIds().has(targetId) && targetId !== user.openid, '不能修改主管理员权限', 'FORBIDDEN')
  assert(['active', 'rejected', 'disabled'].includes(status), '审核状态不正确')
  await db.runTransaction(async (transaction) => {
    const target = await getDocument('users', targetId, transaction)
    assert(target && target.staffStatus, '人员申请不存在', 'NOT_FOUND')
    assert(!stallOpenIds().has(target.openid), '不能修改主管理员权限', 'FORBIDDEN')
    const allowed = { pending: ['active', 'rejected'], active: ['active', 'disabled'], disabled: ['active'], rejected: [] }
    assert((allowed[target.staffStatus] || []).includes(status), '申请状态已变化，请刷新后重试', 'CONFLICT')
    const customerMerchantId = target.customerMerchantId || (target.merchantId !== 'sample-stall' ? target.merchantId : stableId('merchant', targetId))
    await transaction.collection('users').doc(targetId).update({ data: {
      role: status === 'active' ? 'stall' : 'customer',
      merchantId: status === 'active' ? 'sample-stall' : customerMerchantId,
      customerMerchantId, staffStatus: status, staffCanViewBills: status === 'active' && payload.canViewBills === true,
      staffReviewReason: reason, staffReviewedBy: user.openid, staffReviewedAt: db.serverDate(), updatedAt: db.serverDate()
    } })
    await transaction.collection('audit_logs').add({ data: {
      actorOpenid: user.openid, action: 'staff.review', targetId,
      summary: { from: target.staffStatus, to: status, canViewBills: status === 'active' && payload.canViewBills === true, reason }, createdAt: db.serverDate()
    } })
  })
  return { saved: true }
}

async function requireActiveMerchant(user) {
  if (user.role !== 'customer' || user.authorizedRole === 'stall') return
  const merchant = await getDocument('merchants', user.merchantId)
  assert(merchant && (!merchant.status || merchant.status === 'active'), merchant?.status === 'pending' ? '商家资料正在审核，请稍后再试' : '商家账号暂不可使用，请联系示例档口', 'MERCHANT_NOT_ACTIVE')
}

function toClientProduct(product, priceCents) {
  return {
    id: product._id,
    code: product.code,
    name: product.name,
    price: Number((priceCents / 100).toFixed(2)),
    colors: product.colors || [],
    sizes: product.sizes || [],
    stockReference: asInteger(product.referenceTotal),
    reserved: asInteger(product.reserved),
    tone: product.tone || 'cream',
    status: product.status || 'sale',
    images: product.images || []
  }
}

async function listProductsForUser(user, onlyOnSale = true) {
  let query = db.collection('products')
  if (onlyOnSale) query = query.where({ status: 'sale' })
  const result = await query.orderBy('code', 'asc').limit(100).get()
  const products = result.data || []
  const priceDocs = await Promise.all(products.map((product) =>
    getDocument('customer_prices', `${user.merchantId}_${product._id}`)
  ))
  return products.map((product, index) =>
    toClientProduct(product, asInteger(priceDocs[index]?.unitPriceCents, product.basePriceCents))
  )
}

function sanitiseCartItem(item, index) {
  const quantity = asInteger(item.quantity)
  assert(quantity > 0 && quantity <= 999, `第 ${index + 1} 项数量不正确`)
  const size = parseSize(item.size || item.specs)
  assert(size, `第 ${index + 1} 项尺码不能为空`)
  return {
    id: cleanText(item.id, 80) || `line-${index + 1}`,
    productId: cleanText(item.productId, 80),
    productCode: cleanText(item.productCode, 40),
    externalProductCode: cleanText(item.externalProductCode, 40) || undefined,
    name: cleanText(item.name, 100),
    color: cleanText(item.color, 40),
    size,
    specs: size,
    quantity,
    source: ['manual', 'screenshot', 'link'].includes(item.source) ? item.source : 'manual',
    needsReview: Boolean(item.needsReview),
    confidence: Number.isFinite(Number(item.confidence)) ? Number(item.confidence) : undefined
  }
}

async function loginAction(user, payload, context) {
  const requestedRole = payload.requestedRole === 'stall' ? 'stall' : 'customer'
  const role = requestedRole === 'stall' && user.role !== 'stall' ? 'customer' : requestedRole
  const merchant = await getDocument('merchants', user.merchantId)
  return {
    openid: context.OPENID,
    role,
    authorizedRole: user.authorizedRole || user.role,
    ...staffIdentity(user),
    merchantId: user.merchantId,
    profileComplete: Boolean(user.profileComplete),
    isNewUser: !user.profileComplete,
    merchantStatus: merchant?.status || (user.role === 'stall' ? 'active' : 'profile_incomplete')
  }
}

async function bootstrapAction(user) {
  const products = await listProductsForUser(user, user.role !== 'stall')
  const cart = await getDocument('carts', user.merchantId)
  const merchant = await getDocument('merchants', user.merchantId)
  const orderQuery = user.role === 'stall'
    ? db.collection('orders')
    : db.collection('orders').where({ merchantId: user.merchantId })
  const returnQuery = user.role === 'stall'
    ? db.collection('returns')
    : db.collection('returns').where({ merchantId: user.merchantId })
  const billQuery = user.role === 'stall'
    ? db.collection('bills')
    : db.collection('bills').where({ merchantId: user.merchantId })
  const [orderResult, returnResult, billResult, customerResult] = await Promise.all([
    orderQuery.orderBy('createdAt', 'desc').limit(100).get(),
    returnQuery.orderBy('createdAt', 'desc').limit(100).get(),
    (user.authorizedRole === 'stall' || user.role === 'stall') && !staffIdentity(user).canViewBills ? Promise.resolve({ data: [] }) : billQuery.orderBy('dateKey', 'desc').limit(100).get(),
    user.role === 'stall' ? db.collection('merchants').limit(100).get() : Promise.resolve({ data: [] })
  ])
  const orders = orderResult.data || []
  const orderDates = new Map(orders.map((order) => [order._id, order.dateKey]))

  let inventory
  if (user.role === 'stall') {
    inventory = products.map((product) => ({
      productId: product.id,
      productCode: product.code,
      name: product.name,
      colors: product.colors,
      referenceTotal: product.stockReference,
      reserved: product.reserved || 0
    }))
  }

  return {
    user: { role: user.role, authorizedRole: user.authorizedRole || user.role, ...staffIdentity(user), merchantId: user.merchantId, profileComplete: Boolean(user.profileComplete), merchantStatus: merchant?.status || 'active' },
    merchant: merchant ? {
      id: merchant._id,
      name: merchant.name || '',
      contactName: merchant.contactName || '',
      phone: merchant.phone || '',
      address: merchant.address || '',
      status: merchant.status || 'active',
      productAliases: merchant.productAliases || []
    } : undefined,
    customers: user.role === 'stall' ? (customerResult.data || []).filter((item) => item._id !== 'sample-stall').map((item) => ({
      id: item._id,
      name: item.name || '未命名商家',
      contactName: item.contactName || '',
      phone: item.phone || '',
      address: item.address || '',
      status: item.status || 'active',
      productAliases: item.productAliases || []
    })) : undefined,
    products,
    cart: cart?.items || [],
    orders: orders.map((order) => ({
      id: order._id,
      merchantId: order.merchantId,
      merchantName: order.merchantName || '',
      date: order.dateKey,
      status: order.status,
      items: order.items || [],
      total: Number((asInteger(order.payableCents, order.totalCents) / 100).toFixed(2)),
      original: Number((asInteger(order.originalCents, order.totalCents) / 100).toFixed(2)),
      adjustment: Number((asInteger(order.adjustmentCents) / 100).toFixed(2)),
      returns: Number((asInteger(order.returnCents) / 100).toFixed(2)),
      discount: Number((asInteger(order.discountCents) / 100).toFixed(2)),
      batchKey: order.batchKey,
      revision: asInteger(order.revision, 1),
      appendCount: asInteger(order.appendCount, 1),
      accountingStatus: order.accountingStatus || (asInteger(order.payableCents) ? 'posted' : 'unposted'),
      deliveryMethod: order.deliveryMethod || 'pickup',
      exceptionFromStatus: order.exceptionFromStatus || (order.status === 'exception' ? (order.inventoryPosted || order.pickedAt ? 'packed' : 'picking') : ''),
      packingNote: order.packingNote || '',
      requestedItems: order.requestedItems || [],
      events: (order.events || []).map((event, index) => ({
        ...event, id: event.id || `${order._id}-event-${index}`,
        type: event.type === 'customer_received' ? 'received' : event.type === 'customer_issue' ? 'exception' : event.type,
        title: event.title || ({ customer_received: '客户确认收到', customer_issue: '客户反馈异常', corrected: '订单更正' }[event.type] || '订单状态更新'),
        detail: event.detail || event.note || '', operator: event.operator || event.actorRole || 'system'
      })),
      exceptionReason: order.exceptionReason || '',
      returnItems: (order.returnItems || []).map((item) => ({
        productId: item.productId,
        productCode: item.productCode,
        color: item.color,
        size: item.size,
        quantity: asInteger(item.quantity),
        unitPrice: Number((asInteger(item.unitPriceCents) / 100).toFixed(2)),
        amount: Number((asInteger(item.amountCents) / 100).toFixed(2))
      }))
    })),
    returns: (returnResult.data || []).map((returned) => ({
      id: returned._id,
      orderId: returned.orderId,
      date: returned.dateKey || orderDates.get(returned.orderId) || '',
      status: returned.status || 'confirmed',
      merchantId: returned.merchantId,
      merchantName: returned.merchantName || '',
      photos: returned.photos || [],
      receivedQuantity: asInteger(returned.receivedQuantity),
      exceptionReason: returned.exceptionReason || '',
      inventoryPosted: Boolean(returned.inventoryPosted),
      items: (returned.items || []).map((item) => ({
        productId: item.productId,
        productCode: item.productCode,
        color: item.color,
        size: item.size,
        quantity: asInteger(item.quantity),
        unitPrice: Number((asInteger(item.unitPriceCents) / 100).toFixed(2)),
        amount: Number((asInteger(item.amountCents) / 100).toFixed(2))
      })),
      amount: Number((asInteger(returned.amountCents) / 100).toFixed(2))
    })),
    bills: (billResult.data || []).map((bill) => ({
      id: bill._id,
      merchantId: bill.merchantId,
      date: bill.dateKey,
      original: Number((asInteger(bill.originalCents) / 100).toFixed(2)),
      adjustment: Number((asInteger(bill.adjustmentCents) / 100).toFixed(2)),
      returns: Number((asInteger(bill.returnCents) / 100).toFixed(2)),
      discount: Number((asInteger(bill.discountCents) / 100).toFixed(2)),
      payable: Number((asInteger(bill.payableCents) / 100).toFixed(2)),
      openingBalance: Number((asInteger(bill.openingBalanceCents) / 100).toFixed(2)),
      shipped: Number((asInteger(bill.shippedCents, bill.originalCents) / 100).toFixed(2)),
      corrections: Number((asInteger(bill.correctionCents) / 100).toFixed(2)),
      payments: Number((asInteger(bill.paymentCents) / 100).toFixed(2)),
      pendingPayments: Number((asInteger(bill.pendingPaymentCents) / 100).toFixed(2)),
      closingBalance: Number((asInteger(bill.payableCents) / 100).toFixed(2)),
      status: bill.status || 'open'
    })),
    inventory
  }
}

async function updateProfileAction(user, payload) {
  assert(user.role === 'customer', '仅客户账号需要商家资料', 'FORBIDDEN')
  const profile = payload.profile || {}
  const shopName = cleanText(profile.shopName, 40)
  const contactName = cleanText(profile.contactName, 20)
  const phone = cleanText(profile.phone, 20)
  const address = cleanText(profile.address, 120)
  assert(shopName && contactName, '商家名称和联系人不能为空')
  assert(/^1\d{10}$/.test(phone), '手机号格式不正确')
  await db.runTransaction(async (transaction) => {
    const merchant = await getDocument('merchants', user.merchantId, transaction)
    await transaction.collection('merchants').doc(user.merchantId).set({
      data: {
        ownerOpenid: user.openid,
        name: shopName,
        contactName,
        phone,
        address,
        status: merchant?.status === 'active' ? 'active' : 'pending',
        createdAt: merchant?.createdAt || db.serverDate(),
        updatedAt: db.serverDate()
      }
    })
    await transaction.collection('users').doc(user.openid).update({
      data: { profileComplete: true, updatedAt: db.serverDate() }
    })
  })
  const savedMerchant = await getDocument('merchants', user.merchantId)
  return { saved: true, merchantId: user.merchantId, status: savedMerchant?.status || 'pending' }
}

async function adminCustomerListAction(user) {
  requireStall(user)
  const data = await bootstrapAction(user)
  return {
    items: (data.customers || []).map((customer) => {
      const orders = data.orders.filter((item) => item.merchantId === customer.id)
      const returns = data.returns.filter((item) => item.merchantId === customer.id)
      const bills = data.bills.filter((item) => item.merchantId === customer.id)
      return {
        ...customer,
        canViewBills: staffIdentity(user).canViewBills,
        orderCount: orders.length,
        returnCount: returns.length,
        pendingReturnCount: returns.filter((item) => !['confirmed', 'rejected'].includes(item.status)).length,
        outstanding: Number(bills.filter((item) => item.status === 'open').reduce((sum, item) => sum + item.payable, 0).toFixed(2)),
        lastOrderDate: orders.map((item) => item.date).sort().reverse()[0] || '',
        aliasCount: (customer.productAliases || []).length
      }
    }).sort((left, right) => (left.status === 'pending' ? -1 : 0) - (right.status === 'pending' ? -1 : 0))
  }
}

async function adminCustomerDetailAction(user, payload) {
  requireStall(user)
  const merchantId = cleanText(payload.merchantId, 80)
  assert(merchantId, '缺少客户编号')
  const data = await bootstrapAction(user)
  const merchant = (data.customers || []).find((item) => item.id === merchantId)
  assert(merchant, '客户不存在', 'NOT_FOUND')
  const memberResult = await db.collection('users').where({ merchantId }).limit(100).get()
  return {
    merchant,
    canViewBills: staffIdentity(user).canViewBills,
    memberCount: (memberResult.data || []).length,
    orders: data.orders.filter((item) => item.merchantId === merchantId),
    returns: data.returns.filter((item) => item.merchantId === merchantId),
    bills: data.bills.filter((item) => item.merchantId === merchantId)
  }
}

async function adminCustomerStatusAction(user, payload) {
  requireStall(user)
  const merchantId = cleanText(payload.merchantId, 80)
  const status = cleanText(payload.status, 30)
  assert(['pending', 'active', 'paused', 'disabled'].includes(status), '客户状态不正确')
  const merchant = await getDocument('merchants', merchantId)
  assert(merchant && merchantId !== 'sample-stall', '客户不存在', 'NOT_FOUND')
  await db.collection('merchants').doc(merchantId).update({ data: { status, reviewedBy: user.openid, reviewedAt: db.serverDate(), updatedAt: db.serverDate() } })
  await db.collection('audit_logs').add({ data: {
    actorOpenid: user.openid, action: 'admin.customer.status', targetId: merchantId,
    summary: { from: merchant.status || 'active', to: status }, createdAt: db.serverDate()
  } })
  return { merchantId, status }
}

async function saveProductAliasAction(user, payload) {
  await requireActiveMerchant(user)
  const externalCode = cleanText(payload.externalCode, 40)
  const productId = cleanText(payload.productId, 80)
  const merchantId = user.role === 'stall' ? cleanText(payload.merchantId, 80) : user.merchantId
  assert(externalCode && productId && merchantId, '缺少款号映射参数')
  const [merchant, product] = await Promise.all([getDocument('merchants', merchantId), getDocument('products', productId)])
  assert(merchant, '客户账户不存在', 'NOT_FOUND')
  assert(product && product.status === 'sale', '档口商品不存在或已下架', 'NOT_FOUND')
  const aliases = (Array.isArray(merchant.productAliases) ? merchant.productAliases : [])
    .filter((item) => cleanText(item.externalCode, 40) !== externalCode)
  aliases.push({ externalCode, productId: product._id, productCode: product.code, updatedBy: user.openid, updatedAt: new Date().toISOString() })
  assert(aliases.length <= 1000, '客户款号映射数量超过上限')
  await db.collection('merchants').doc(merchantId).update({ data: { productAliases: aliases, updatedAt: db.serverDate() } })
  await db.collection('audit_logs').add({ data: {
    actorOpenid: user.openid, action: 'product.alias.save', targetId: merchantId,
    summary: { externalCode, productId: product._id, productCode: product.code }, createdAt: db.serverDate()
  } })
  return { externalCode, productId: product._id, productCode: product.code }
}

async function getPhoneNumberAction(user, payload) {
  assert(user.role === 'customer', '仅客户账号需要商家资料', 'FORBIDDEN')
  const code = cleanText(payload.code, 200)
  assert(code, '缺少手机号授权凭证')
  const result = await cloud.openapi.phonenumber.getPhoneNumber({ code })
  const phone = cleanText(result?.phoneInfo?.purePhoneNumber || result?.phoneInfo?.phoneNumber, 20)
  assert(/^1\d{10}$/.test(phone), '未能获取有效手机号', 'PHONE_AUTH_FAILED')
  return { phone }
}

async function saveCartAction(user, payload) {
  await requireActiveMerchant(user)
  assert(Array.isArray(payload.items) && payload.items.length <= 300, '订货车数据不正确')
  const items = expandCartItems(payload.items).map(sanitiseCartItem)
  await db.collection('carts').doc(user.merchantId).set({
    data: {
      merchantId: user.merchantId,
      ownerOpenid: user.openid,
      items,
      updatedAt: db.serverDate()
    }
  })
  return { saved: true }
}

async function resolvePricedLines(user, rawItems) {
  assert(Array.isArray(rawItems) && rawItems.length > 0 && rawItems.length <= 300, '订单商品不能为空')
  const items = expandCartItems(rawItems).map(sanitiseCartItem)
  const codes = [...new Set(items.map((item) => item.productCode).filter(Boolean))]
  assert(codes.length > 0, '订单缺少款号')
  const productDocs = []
  for (let index = 0; index < codes.length; index += 10) {
    const chunk = codes.slice(index, index + 10)
    const productResult = await db.collection('products').where({ code: command.in(chunk), status: 'sale' }).limit(10).get()
    productDocs.push(...(productResult.data || []))
  }
  const productMap = new Map(productDocs.map((product) => [product.code, product]))
  assert(productMap.size === codes.length, '部分商品已下架或不存在，请刷新订货车')

  const priceDocs = await Promise.all([...productMap.values()].map((product) =>
    getDocument('customer_prices', `${user.merchantId}_${product._id}`)
  ))
  const priceMap = new Map([...productMap.values()].map((product, index) => [
    product._id,
    asInteger(priceDocs[index]?.unitPriceCents, product.basePriceCents)
  ]))

  return items.map((item, index) => {
    const product = productMap.get(item.productCode)
    assert(product.colors.includes(item.color), `第 ${index + 1} 项花色无效`)
    assert(product.sizes.map((size) => String(size).toUpperCase()).includes(item.size), `第 ${index + 1} 项尺码无效`)
    const unitPriceCents = priceMap.get(product._id)
    return {
      ...item,
      id: cleanText(item.id, 80) || randomId('line'),
      productId: product._id,
      name: product.name,
      unitPriceCents,
      unitPrice: Number((unitPriceCents / 100).toFixed(2)),
      subtotalCents: unitPriceCents * item.quantity
    }
  })
}

async function submitOrderAction(user, payload) {
  await requireActiveMerchant(user)
  assert(user.role === 'customer', '仅客户账号可以提交订单', 'FORBIDDEN')
  const idempotencyKey = cleanText(payload.idempotencyKey, 120)
  assert(idempotencyKey, '缺少订单幂等键')
  const orderId = stableId('order', `${user.openid}:${idempotencyKey}`)
  const existing = await getDocument('orders', orderId)
  if (existing) return { orderId, duplicated: true, totalCents: existing.totalCents }

  const lines = await resolvePricedLines(user, payload.items)
  const totalCents = lines.reduce((sum, line) => sum + line.subtotalCents, 0)
  const day = dateKey()
  const merchant = await getDocument('merchants', user.merchantId)

  const result = await db.runTransaction(async (transaction) => {
    const duplicate = await getDocument('orders', orderId, transaction)
    if (duplicate) return { duplicated: true }

    for (const line of lines) {
      const product = await getDocument('products', line.productId, transaction)
      assert(product && product.status === 'sale', `${line.productCode} 已下架`)
      await transaction.collection('products').doc(line.productId).update({
        data: { reserved: command.inc(line.quantity), updatedAt: db.serverDate() }
      })
    }

    await transaction.collection('orders').doc(orderId).set({
      data: {
        openid: user.openid,
        merchantId: user.merchantId,
        merchantName: merchant?.name || '未命名商家',
        idempotencyKey,
        dateKey: day,
        status: 'pending',
        accountingStatus: 'unposted',
        items: lines,
        totalCents,
        originalCents: totalCents,
        adjustmentCents: 0,
        returnCents: 0,
        discountCents: 0,
        payableCents: totalCents,
        revision: 1,
        createdAt: db.serverDate(),
        updatedAt: db.serverDate()
      }
    })
    await transaction.collection('audit_logs').add({
      data: {
        actorOpenid: user.openid,
        action: 'order.submit',
        targetId: orderId,
        summary: { totalCents, itemCount: lines.length },
        createdAt: db.serverDate()
      }
    })
    return { duplicated: false }
  })

  if (!result.duplicated) {
    await db.collection('carts').doc(user.merchantId).set({
      data: { merchantId: user.merchantId, ownerOpenid: user.openid, items: [], updatedAt: db.serverDate() }
    })
  }
  return { orderId, duplicated: result.duplicated, totalCents }
}

async function transitionOrderAction(user, payload) {
  requireStall(user)
  const orderId = cleanText(payload.orderId, 100)
  const canonical = (status) => status === 'picked' ? 'packed' : status
  const nextStatus = canonical(cleanText(payload.nextStatus, 30))
  const note = cleanText(payload.note, 300)
  const labels = { picking: '开始配货', packed: '保存实配并入账', awaiting_pickup: '等待客户取货', in_transit: '确认发出', received: '档口代确认收货', exception: '登记异常' }
  assert(orderId && labels[nextStatus], '目标状态不正确')
  return db.runTransaction(async (transaction) => {
    const order = await getDocument('orders', orderId, transaction)
    assert(order, '订单不存在', 'NOT_FOUND')
    const current = canonical(order.status)
    if (current === nextStatus) return { status: current, duplicated: true }
    if (payload.revision !== undefined) assert(Number(payload.revision) === asInteger(order.revision, 1), '订单已变化，请刷新后重新核对', 'CONFLICT')
    const transitions = {
      pending: ['picking', 'exception'], picking: ['packed', 'exception'],
      packed: ['awaiting_pickup', 'in_transit', 'exception'],
      awaiting_pickup: ['received', 'exception'], in_transit: ['received', 'exception']
    }
    const recoveryStatus = ['pending', 'picking'].includes(order.exceptionFromStatus) ? 'picking' : canonical(order.exceptionFromStatus || (order.inventoryPosted || order.pickedAt ? 'packed' : 'picking'))
    const recovering = current === 'exception'
    assert(recovering ? nextStatus === recoveryStatus : (transitions[current] || []).includes(nextStatus), '当前订单状态不支持此操作，请刷新后重试', 'CONFLICT')
    if (recovering || nextStatus === 'exception' || nextStatus === 'received') assert(note, '请填写异常处理说明或收货确认依据')
    const update = { status: nextStatus, revision: asInteger(order.revision, 1) + 1, updatedAt: db.serverDate() }

    if (nextStatus === 'packed' && !recovering) {
      assert(!order.inventoryPosted, '该订单已完成出库，请刷新后核对', 'CONFLICT')
      const sourceItems = expandCartItems(order.items || [])
      assert(sourceItems.length > 0, '订单缺少商品明细')
      const submitted = payload.packedItems
      const quantities = new Map()
      if (Array.isArray(submitted) && submitted.some((item) => item.lineId)) {
        assert(submitted.length === sourceItems.length, '请逐项填写所有花色尺码的实配数量')
        for (const item of submitted) {
          const lineId = cleanText(item.lineId, 80)
          const line = sourceItems.find((candidate) => candidate.id === lineId)
          assert(line && !quantities.has(lineId), '实配明细重复或不属于原订单')
          const quantity = item.quantity
          assert(Number.isInteger(quantity) && quantity >= 0 && quantity <= line.quantity, `${line.productCode} 实配数量须为 0 到订货数量之间的整数`)
          quantities.set(lineId, quantity)
        }
      } else if (submitted !== undefined) {
        assert(Array.isArray(submitted) && submitted.length, '实配明细不能为空')
        const remaining = new Map()
        for (const item of submitted) {
          const productId = cleanText(item.productId, 80)
          const quantity = item.quantity
          assert(sourceItems.some((line) => line.productId === productId) && Number.isInteger(quantity) && quantity >= 0, '实配商品或数量不正确')
          remaining.set(productId, (remaining.get(productId) || 0) + quantity)
        }
        for (const line of sourceItems) {
          assert(remaining.has(line.productId), '实配明细缺少商品')
          const quantity = Math.min(line.quantity, remaining.get(line.productId))
          quantities.set(line.id, quantity)
          remaining.set(line.productId, remaining.get(line.productId) - quantity)
        }
        assert([...remaining.values()].every((quantity) => quantity === 0), '实配数量超过原订单')
      } else {
        assert(payload.nextStatus === 'picked', '请先核对并填写实配明细')
        sourceItems.forEach((line) => quantities.set(line.id, line.quantity))
      }
      const actualItems = sourceItems.map((line) => ({ ...line, orderedQuantity: line.quantity, quantity: quantities.get(line.id), subtotalCents: quantities.get(line.id) * asInteger(line.unitPriceCents) }))
      assert(actualItems.some((line) => line.quantity > 0), '全部缺货时请登记异常，不要确认出库')
      const short = actualItems.some((line) => line.quantity !== line.orderedQuantity)
      if (short) {
        assert(note, '少配或缺货时请填写说明')
        assert(!asInteger(order.returnCents) && !(order.returnItems || []).length, '已有退货记录，请先核对退货再更改实配数量', 'CONFLICT')
      }
      const orderedByProduct = new Map()
      for (const line of actualItems) {
        const total = orderedByProduct.get(line.productId) || { productCode: line.productCode, ordered: 0, packed: 0 }
        total.ordered += line.orderedQuantity
        total.packed += line.quantity
        orderedByProduct.set(line.productId, total)
      }
      for (const [productId, ordered] of orderedByProduct.entries()) {
        const product = await getDocument('products', productId, transaction)
        assert(product, `${ordered.productCode} 商品不存在`)
        await transaction.collection('products').doc(productId).update({
          data: {
            referenceTotal: Math.max(0, asInteger(product.referenceTotal) - ordered.packed),
            reserved: Math.max(0, asInteger(product.reserved) - ordered.ordered),
            updatedAt: db.serverDate()
          }
        })
        await transaction.collection('inventory_logs').add({
          data: {
            productId,
            productCode: ordered.productCode,
            type: 'order_out',
            quantity: -ordered.packed,
            orderId,
            actorOpenid: user.openid,
            createdAt: db.serverDate()
          }
        })
      }
      const actualTotal = actualItems.reduce((sum, line) => sum + line.subtotalCents, 0)
      const originalCents = actualItems.reduce((sum, line) => sum + asInteger(line.originalUnitPriceCents, line.unitPriceCents) * line.quantity, 0)
      const adjustmentCents = originalCents - actualTotal
      const payableCents = actualTotal - asInteger(order.returnCents) - asInteger(order.discountCents)
      assert(payableCents >= 0, '实配金额不足以抵扣已有退货和优惠，请先核对账单')
      const billId = `${order.merchantId}_${order.dateKey}`
      const bill = await getDocument('bills', billId, transaction)
      const previouslyPosted = order.accountingStatus !== 'unposted'
      assert(!previouslyPosted || bill, '旧订单原账单缺失，请先核对，避免重复入账', 'CONFLICT')
      const originalDelta = originalCents - (previouslyPosted ? asInteger(order.originalCents, order.totalCents) : 0)
      const adjustmentDelta = adjustmentCents - (previouslyPosted ? asInteger(order.adjustmentCents) : 0)
      const payableDelta = payableCents - (previouslyPosted ? asInteger(order.payableCents, order.totalCents) : 0)
      const billPayable = asInteger(bill?.payableCents) + payableDelta
      const billData = {
        merchantId: order.merchantId, dateKey: order.dateKey,
        originalCents: asInteger(bill?.originalCents) + originalDelta,
        shippedCents: asInteger(bill?.shippedCents, asInteger(bill?.originalCents)) + originalDelta,
        adjustmentCents: asInteger(bill?.adjustmentCents) + adjustmentDelta,
        returnCents: asInteger(bill?.returnCents), discountCents: asInteger(bill?.discountCents),
        payableCents: billPayable, status: billPayable === 0 ? 'settled' : 'open',
        createdAt: bill?.createdAt || db.serverDate(), updatedAt: db.serverDate()
      }
      if (bill) await transaction.collection('bills').doc(billId).update({ data: billData })
      else await transaction.collection('bills').doc(billId).set({ data: billData })
      Object.assign(update, {
        items: actualItems, requestedItems: sourceItems, requestedTotalCents: order.totalCents,
        totalCents: actualTotal, originalCents, adjustmentCents, payableCents,
        accountingStatus: 'posted', inventoryPosted: true, packingNote: note,
        pickedAt: db.serverDate(), postedAt: db.serverDate()
      })
    }
    if (nextStatus === 'picking') update.pickingAt = db.serverDate()
    if (nextStatus === 'awaiting_pickup' || nextStatus === 'in_transit') {
      update.deliveryMethod = nextStatus === 'in_transit' ? 'delivery' : 'pickup'
      update.handoverAt = db.serverDate()
    }
    if (nextStatus === 'received' && !recovering) { update.receivedAt = db.serverDate(); update.receiptConfirmedBy = 'stall' }
    if (nextStatus === 'exception') { update.exceptionReason = note; update.exceptionFromStatus = current }
    if (recovering) { update.exceptionReason = ''; update.exceptionFromStatus = '' }
    update.events = [...(order.events || []), {
      id: randomId('event'), type: nextStatus === 'packed' ? 'packed' : nextStatus === 'picking' ? 'picking' : nextStatus === 'received' ? 'received' : nextStatus === 'exception' ? 'exception' : 'handover',
      title: recovering ? '异常已核对，恢复处理' : labels[nextStatus], detail: note,
      createdAt: new Date().toISOString(), operator: 'stall', actorOpenid: user.openid
    }].slice(-100)
    await transaction.collection('orders').doc(orderId).update({ data: update })
    await transaction.collection('audit_logs').add({
      data: { actorOpenid: user.openid, action: `order.${nextStatus}`, targetId: orderId,
        summary: { from: current, to: nextStatus, note, ...(update.totalCents !== undefined ? { actualTotalCents: update.totalCents, payableCents: update.payableCents } : {}) }, createdAt: db.serverDate() }
    })
    return { status: nextStatus, duplicated: false }
  })
}

async function correctOrderAction(user, payload) {
  requireStall(user)
  const orderId = cleanText(payload.orderId, 100)
  const note = cleanText(payload.note, 300)
  assert(orderId && note, '请填写更正说明')
  const order = await getDocument('orders', orderId)
  assert(order, '订单不存在', 'NOT_FOUND')
  const revision = asInteger(order.revision, 1) + 1
  const events = [...(order.events || []), {
    type: 'corrected', note, actorRole: 'stall', actorOpenid: user.openid, createdAt: new Date().toISOString()
  }].slice(-50)
  await db.collection('orders').doc(orderId).update({ data: { revision, events, updatedAt: db.serverDate() } })
  await db.collection('audit_logs').add({ data: { actorOpenid: user.openid, action: 'order.correct', targetId: orderId, summary: { note }, createdAt: db.serverDate() } })
  return { revision }
}

async function acknowledgeOrderAction(user, payload) {
  await requireActiveMerchant(user)
  assert(user.role === 'customer', '仅客户可确认收货', 'FORBIDDEN')
  const orderId = cleanText(payload.orderId, 100)
  const action = cleanText(payload.action, 20)
  const note = cleanText(payload.note, 300)
  assert(['received', 'issue'].includes(action), '确认操作不正确')
  return db.runTransaction(async (transaction) => {
    const order = await getDocument('orders', orderId, transaction)
    assert(order, '订单不存在', 'NOT_FOUND')
    assert(order.merchantId === user.merchantId, '无权操作此订单', 'FORBIDDEN')
    const status = action === 'received' ? 'received' : 'exception'
    if (order.status === status) return { status, duplicated: true }
    const allowed = action === 'received' ? ['packed', 'picked', 'awaiting_pickup', 'in_transit'] : ['pending', 'picking', 'packed', 'picked', 'awaiting_pickup', 'in_transit', 'received']
    assert(allowed.includes(order.status), '当前订单不能执行此确认，请刷新后重试', 'CONFLICT')
    const update = {
      status, exceptionReason: action === 'issue' ? (note || '客户反馈数量或款式有误') : '',
      revision: asInteger(order.revision, 1) + 1, updatedAt: db.serverDate(),
      events: [...(order.events || []), {
        id: randomId('event'), type: action === 'received' ? 'received' : 'exception',
        title: action === 'received' ? '客户确认收到' : '客户反馈异常', detail: note,
        operator: 'customer', actorOpenid: user.openid, createdAt: new Date().toISOString()
      }].slice(-100)
    }
    if (action === 'received') { update.receivedAt = db.serverDate(); update.receiptConfirmedBy = 'customer' }
    else update.exceptionFromStatus = order.status
    await transaction.collection('orders').doc(orderId).update({ data: update })
    await transaction.collection('audit_logs').add({ data: { actorOpenid: user.openid, action: `order.customer.${action}`, targetId: orderId, createdAt: db.serverDate() } })
    return { status, duplicated: false }
  })
}

function returnToClient(returned) {
  return {
    id: returned._id,
    orderId: returned.orderId,
    date: returned.dateKey || '',
    status: returned.status,
    merchantId: returned.merchantId,
    merchantName: returned.merchantName || '',
    photos: returned.photos || [],
    receivedQuantity: asInteger(returned.receivedQuantity),
    exceptionReason: returned.exceptionReason || '',
    inventoryPosted: Boolean(returned.inventoryPosted),
    items: (returned.items || []).map((item) => ({
      productId: item.productId, productCode: item.productCode, color: item.color, size: item.size,
      quantity: asInteger(item.quantity), unitPrice: Number((asInteger(item.unitPriceCents) / 100).toFixed(2)),
      amount: Number((asInteger(item.amountCents) / 100).toFixed(2))
    })),
    amount: Number((asInteger(returned.amountCents) / 100).toFixed(2))
  }
}

async function submitReturnAction(user, payload) {
  await requireActiveMerchant(user)
  assert(user.role === 'customer', '仅客户可申请退货', 'FORBIDDEN')
  const orderId = cleanText(payload.orderId, 100)
  const order = await getDocument('orders', orderId)
  assert(order, '原订单不存在', 'NOT_FOUND')
  assert(order.merchantId === user.merchantId, '无权操作此订单', 'FORBIDDEN')
  assert(order.accountingStatus !== 'unposted', '订单尚未确认实配出库，暂不能申请退货', 'CONFLICT')
  assert(['packed', 'picked', 'awaiting_pickup', 'in_transit', 'received', 'completed'].includes(order.status) || order.status === 'exception' && (order.inventoryPosted || order.pickedAt), '订单尚未出库，暂不能申请退货', 'CONFLICT')
  const photos = (Array.isArray(payload.fileIds) ? payload.fileIds : []).map((item) => cleanText(item, 1000)).filter((item) => item.startsWith('cloud://')).slice(0, 6)
  assert(photos.length > 0, '请上传退货照片')
  const requested = Array.isArray(payload.items) ? payload.items : []
  assert(requested.length > 0 && requested.length <= 100, '请选择退货商品')
  const totals = new Map()
  const items = requested.map((item, index) => {
    const productCode = cleanText(item.productCode, 40)
    const color = cleanText(item.color, 40)
    const size = parseSize(item.size)
    const quantity = asInteger(item.quantity)
    const matches = (order.items || []).filter((line) => line.productCode === productCode && line.color === color && parseSize(line.size || line.specs) === size)
    const ordered = matches.reduce((sum, line) => sum + asInteger(line.quantity), 0)
    assert(ordered > 0, `第 ${index + 1} 项在原订单中不存在`)
    const key = `${productCode}:${color}:${size}`
    const total = asInteger(totals.get(key)) + quantity
    assert(quantity > 0 && total <= ordered, `${productCode} 退货数量超过原订单`)
    totals.set(key, total)
    const line = matches[0]
    const unitPriceCents = asInteger(line.unitPriceCents)
    return { productId: line.productId, productCode, color, size, quantity, unitPriceCents, amountCents: unitPriceCents * quantity, condition: 'resellable' }
  })
  const returnId = randomId('return')
  const merchant = await getDocument('merchants', user.merchantId)
  const returned = {
    _id: returnId, orderId, merchantId: user.merchantId, merchantName: merchant?.name || '', dateKey: dateKey(),
    status: 'photo_review', photos, items, proposedAmountCents: items.reduce((sum, item) => sum + item.amountCents, 0),
    amountCents: 0, receivedQuantity: 0, inventoryPosted: false
  }
  const { _id, ...storedReturn } = returned
  await db.collection('returns').doc(returnId).set({ data: { ...storedReturn, createdAt: db.serverDate(), updatedAt: db.serverDate() } })
  return returnToClient(returned)
}

async function transitionReturnAction(user, payload) {
  requireStall(user)
  const returnId = cleanText(payload.returnId, 100)
  const nextStatus = cleanText(payload.nextStatus, 30)
  const allowed = {
    photo_review: ['awaiting_goods', 'confirmed', 'exception'], awaiting_goods: ['inspection', 'confirmed', 'exception'],
    inspection: ['confirmed', 'exception'], exception: ['awaiting_goods', 'inspection']
  }
  return db.runTransaction(async (transaction) => {
    const returned = await getDocument('returns', returnId, transaction)
    assert(returned, '退货单不存在', 'NOT_FOUND')
    assert((allowed[returned.status] || []).includes(nextStatus), `退货单不能从 ${returned.status} 变更为 ${nextStatus}`, 'CONFLICT')
    const receivedQuantity = Math.max(0, asInteger(payload.receivedQuantity, (returned.items || []).reduce((sum, item) => sum + asInteger(item.quantity), 0)))
    const update = { status: nextStatus, receivedQuantity, exceptionReason: nextStatus === 'exception' ? cleanText(payload.exceptionReason, 300) : '', updatedAt: db.serverDate() }
    if (nextStatus === 'confirmed') {
      assert(!returned.inventoryPosted, '该退货已经回库', 'CONFLICT')
      const expected = (returned.items || []).reduce((sum, item) => sum + asInteger(item.quantity), 0)
      assert(receivedQuantity === expected, '实收数量与退货明细不一致，请先异常核对')
      const order = await getDocument('orders', returned.orderId, transaction)
      assert(order, '原订单不存在', 'NOT_FOUND')
      const amountCents = asInteger(returned.proposedAmountCents)
      const billId = `${order.merchantId}_${order.dateKey}`
      const bill = await getDocument('bills', billId, transaction)
      assert(bill, '原账单不存在', 'NOT_FOUND')
      for (const item of returned.items || []) {
        if (item.condition !== 'resellable') continue
        const product = await getDocument('products', item.productId, transaction)
        assert(product, `${item.productCode} 商品不存在`)
        await transaction.collection('products').doc(item.productId).update({ data: { referenceTotal: asInteger(product.referenceTotal) + asInteger(item.quantity), updatedAt: db.serverDate() } })
        await transaction.collection('inventory_logs').doc(stableId('inventory', `${returnId}:${item.productId}`)).set({ data: {
          productId: item.productId, productCode: item.productCode, type: 'return_in', quantity: asInteger(item.quantity), returnId,
          actorOpenid: user.openid, createdAt: db.serverDate()
        } })
      }
      update.inventoryPosted = true
      update.amountCents = amountCents
      await transaction.collection('orders').doc(returned.orderId).update({ data: {
        returnCents: asInteger(order.returnCents) + amountCents,
        payableCents: Math.max(0, asInteger(order.payableCents, order.totalCents) - amountCents),
        revision: asInteger(order.revision, 1) + 1, updatedAt: db.serverDate()
      } })
      await transaction.collection('bills').doc(billId).update({ data: {
        returnCents: asInteger(bill.returnCents) + amountCents,
        payableCents: Math.max(0, asInteger(bill.payableCents) - amountCents),
        updatedAt: db.serverDate()
      } })
    }
    await transaction.collection('returns').doc(returnId).update({ data: update })
    return returnToClient({ ...returned, ...update, _id: returnId })
  })
}

async function adjustBillAction(user, payload) {
  requireStall(user)
  const orderId = cleanText(payload.orderId, 100)
  const idempotencyKey = cleanText(payload.idempotencyKey, 120)
  assert(orderId && idempotencyKey, '缺少账单调整参数')
  const adjustmentId = stableId('adjustment', `${orderId}:${idempotencyKey}`)
  const existing = await getDocument('adjustments', adjustmentId)
  if (existing) return { payableCents: existing.payableCents, duplicated: true }

  const order = await getDocument('orders', orderId)
  assert(order, '订单不存在', 'NOT_FOUND')
  assert(order.accountingStatus !== 'unposted', '请先确认实配入账，再调整账单', 'CONFLICT')
  const overrides = new Map((Array.isArray(payload.priceOverrides) ? payload.priceOverrides : [])
    .map((item) => [cleanText(item.lineId, 80), asInteger(item.unitPriceCents)]))
  const discountCents = Math.max(0, asInteger(payload.discountCents))
  const returns = Array.isArray(payload.returns) ? payload.returns : []

  const adjustedItems = (order.items || []).map((line) => {
    const overridden = overrides.has(line.id) ? overrides.get(line.id) : line.unitPriceCents
    assert(overridden > 0 && overridden <= 100000000, `${line.productCode} 调整价格无效`)
    const originalUnitPriceCents = line.originalUnitPriceCents || (overridden !== line.unitPriceCents ? line.unitPriceCents : undefined)
    return {
      ...line,
      unitPriceCents: overridden,
      unitPrice: Number((overridden / 100).toFixed(2)),
      originalUnitPriceCents,
      originalUnitPrice: originalUnitPriceCents ? Number((originalUnitPriceCents / 100).toFixed(2)) : undefined,
      subtotalCents: overridden * line.quantity
    }
  })
  const adjustedTotal = adjustedItems.reduce((sum, line) => sum + line.subtotalCents, 0)
  let returnCents = 0
  const returnMap = new Map()
  const requestedBySpec = new Map()
  returns.forEach((item, index) => {
    const productCode = cleanText(item.productCode, 40)
    const quantity = asInteger(item.quantity)
    const color = cleanText(item.color, 40)
    const size = parseSize(item.size)
    const line = adjustedItems.find((candidate) =>
      candidate.productCode === productCode && candidate.color === color && parseSize(candidate.size || candidate.specs) === size
    )
    assert(line, `第 ${index + 1} 条退货未找到原订单款号`)
    const ordered = adjustedItems.filter((candidate) =>
      candidate.productCode === productCode && candidate.color === color && parseSize(candidate.size || candidate.specs) === size
    ).reduce((sum, candidate) => sum + candidate.quantity, 0)
    assert(quantity > 0 && quantity <= ordered, `${productCode} 退货数量超过原订单`)
    const key = `${line.productId}:${color}:${size}`
    const nextSpecQuantity = asInteger(requestedBySpec.get(key)) + quantity
    assert(nextSpecQuantity <= ordered, `${productCode} ${color} ${size}码累计退货数量超过原订单`)
    requestedBySpec.set(key, nextSpecQuantity)
    const existingReturn = returnMap.get(key)
    const nextQuantity = asInteger(existingReturn?.quantity) + quantity
    returnMap.set(key, {
      productId: line.productId,
      productCode,
      color,
      size,
      quantity: nextQuantity,
      unitPriceCents: line.unitPriceCents,
      amountCents: line.unitPriceCents * nextQuantity
    })
  })
  const normalisedReturns = [...returnMap.values()]
  returnCents = normalisedReturns.reduce((sum, item) => sum + item.amountCents, 0)
  const adjustmentCents = asInteger(order.originalCents) - adjustedTotal
  const payableCents = Math.max(0, adjustedTotal - returnCents - discountCents)
  const billId = `${order.merchantId}_${order.dateKey}`

  await db.runTransaction(async (transaction) => {
    const duplicate = await getDocument('adjustments', adjustmentId, transaction)
    if (duplicate) return
    const currentOrder = await getDocument('orders', orderId, transaction)
    assert(currentOrder, '订单不存在', 'NOT_FOUND')
    assert(asInteger(currentOrder.revision) === asInteger(order.revision), '订单刚刚发生变化，请刷新后重试', 'CONFLICT')
    const bill = await getDocument('bills', billId, transaction)
    assert(bill, '账单不存在', 'NOT_FOUND')
    const payableDelta = payableCents - asInteger(currentOrder.payableCents)

    const previousByProduct = new Map()
    for (const returned of currentOrder.returnItems || []) {
      previousByProduct.set(returned.productId, asInteger(previousByProduct.get(returned.productId)) + asInteger(returned.quantity))
    }
    const nextByProduct = new Map()
    for (const returned of normalisedReturns) {
      nextByProduct.set(returned.productId, asInteger(nextByProduct.get(returned.productId)) + asInteger(returned.quantity))
    }
    for (const productId of new Set([...previousByProduct.keys(), ...nextByProduct.keys()])) {
      const delta = asInteger(nextByProduct.get(productId)) - asInteger(previousByProduct.get(productId))
      if (!delta) continue
      const product = await getDocument('products', productId, transaction)
      assert(product, '退货商品不存在')
      assert(asInteger(product.referenceTotal) + delta >= 0, `${product.code} 库存不足以撤销退货`)
      await transaction.collection('products').doc(productId).update({
        data: { referenceTotal: asInteger(product.referenceTotal) + delta, updatedAt: db.serverDate() }
      })
      await transaction.collection('inventory_logs').add({
        data: {
          productId,
          productCode: product.code,
          type: delta > 0 ? 'return_in' : 'return_correction',
          quantity: delta,
          orderId,
          actorOpenid: user.openid,
          createdAt: db.serverDate()
        }
      })
    }

    for (const line of adjustedItems) {
      if (overrides.has(line.id)) {
        const priceId = `${order.merchantId}_${line.productId}`
        await transaction.collection('customer_prices').doc(priceId).set({
          data: {
            merchantId: order.merchantId,
            productId: line.productId,
            unitPriceCents: line.unitPriceCents,
            updatedBy: user.openid,
            updatedAt: db.serverDate()
          }
        })
      }
    }

    await transaction.collection('orders').doc(orderId).update({
      data: { items: adjustedItems, returnItems: normalisedReturns, adjustmentCents, returnCents, discountCents, payableCents, revision: asInteger(currentOrder.revision) + 1, updatedAt: db.serverDate() }
    })
    await transaction.collection('bills').doc(billId).update({
      data: {
        adjustmentCents: asInteger(bill.adjustmentCents) + adjustmentCents - asInteger(currentOrder.adjustmentCents),
        returnCents: asInteger(bill.returnCents) + returnCents - asInteger(currentOrder.returnCents),
        discountCents: asInteger(bill.discountCents) + discountCents - asInteger(currentOrder.discountCents),
        payableCents: asInteger(bill.payableCents) + payableDelta,
        updatedAt: db.serverDate()
      }
    })
    await transaction.collection('adjustments').doc(adjustmentId).set({
      data: {
        orderId,
        merchantId: order.merchantId,
        priceOverrides: [...overrides.entries()],
        returns: normalisedReturns,
        adjustmentCents,
        returnCents,
        discountCents,
        payableCents,
        actorOpenid: user.openid,
        createdAt: db.serverDate()
      }
    })
    if (normalisedReturns.length) {
      const returnId = stableId('return', orderId)
      const existingReturn = await getDocument('returns', returnId, transaction)
      await transaction.collection('returns').doc(returnId).set({
        data: {
          orderId,
          merchantId: order.merchantId,
          dateKey: order.dateKey,
          items: normalisedReturns,
          amountCents: returnCents,
          status: 'confirmed',
          adjustmentId,
          actorOpenid: user.openid,
          createdAt: existingReturn?.createdAt || db.serverDate(),
          updatedAt: db.serverDate()
        }
      })
    } else {
      const returnId = stableId('return', orderId)
      const existingReturn = await getDocument('returns', returnId, transaction)
      if (existingReturn) {
        await transaction.collection('returns').doc(returnId).update({
          data: { items: [], amountCents: 0, status: 'confirmed', adjustmentId, actorOpenid: user.openid, updatedAt: db.serverDate() }
        })
      }
    }
  })
  return { payableCents, duplicated: false }
}

function validateProductInput(raw) {
  const status = ['sale', 'draft', 'off'].includes(raw.status) ? raw.status : 'sale'
  const code = cleanText(raw.code, 40)
  const name = cleanText(raw.name, 100)
  const colors = [...new Set((Array.isArray(raw.colors) ? raw.colors : []).map((item) => cleanText(item, 40)).filter(Boolean))]
  const sizes = [...new Set((Array.isArray(raw.sizes) ? raw.sizes : []).map((item) => cleanText(item, 40)).filter(Boolean))]
  const basePriceCents = Math.round(Number(raw.price) * 100)
  const images = (Array.isArray(raw.images) ? raw.images : []).slice(0, 30).map((image) => ({
    fileId: cleanText(image.fileId, 500),
    type: ['cover', 'detail', 'package', 'display'].includes(image.type) ? image.type : 'detail'
  })).filter((image) => image.fileId)
  if (status === 'draft') {
    assert(code || name || images.length, '请至少填写款号、名称或添加一张图片')
  } else {
    assert(code && name, '款号和商品名称不能为空')
    assert(colors.length && sizes.length, '至少填写一个花色和尺码')
    assert(basePriceCents > 0, '销售价不正确')
  }
  return {
    code,
    name,
    colors,
    sizes,
    basePriceCents,
    referenceTotal: Math.max(0, asInteger(raw.stockReference)),
    tone: ['sand', 'dark', 'cream'].includes(raw.tone) ? raw.tone : 'cream',
    status,
    images
  }
}

async function upsertProductAction(user, payload) {
  requireStall(user)
  const input = validateProductInput(payload.product || {})
  const productId = cleanText(payload.product?.id, 80) || stableId('product', input.code)
  const current = await getDocument('products', productId)
  await db.collection('products').doc(productId).set({
    data: {
      ...input,
      reserved: asInteger(current?.reserved),
      createdAt: current?.createdAt || db.serverDate(),
      updatedAt: db.serverDate(),
      updatedBy: user.openid
    }
  })
  return { productId }
}

async function addStockAction(user, payload) {
  requireStall(user)
  const productId = cleanText(payload.productId, 80)
  const quantity = asInteger(payload.quantity)
  assert(productId && quantity > 0 && quantity <= 100000, '到货数量不正确')
  return db.runTransaction(async (transaction) => {
    const product = await getDocument('products', productId, transaction)
    assert(product, '商品不存在', 'NOT_FOUND')
    const referenceTotal = asInteger(product.referenceTotal) + quantity
    await transaction.collection('products').doc(productId).update({
      data: { referenceTotal, updatedAt: db.serverDate() }
    })
    await transaction.collection('inventory_logs').add({
      data: {
        productId,
        productCode: product.code,
        type: 'purchase_in',
        quantity,
        colors: Array.isArray(payload.colors) ? payload.colors.map((item) => cleanText(item, 40)) : [],
        note: cleanText(payload.note, 300),
        actorOpenid: user.openid,
        createdAt: db.serverDate()
      }
    })
    return { referenceTotal }
  })
}

function validateShareUrl(rawUrl) {
  let url
  try {
    url = new URL(String(rawUrl || ''))
  } catch (_) {
    throw Object.assign(new Error('链接格式不正确'), { code: 'BAD_URL' })
  }
  assert(url.protocol === 'https:', '只允许 HTTPS 链接')
  assert(url.hostname === 'erp.huice.com', '目前仅支持慧策 ERP 分享链接')
  assert(url.pathname.startsWith('/public/share/'), '不是有效的慧策分享链接')
  url.hash = ''
  return url.toString().slice(0, 1000)
}

async function createImportAction(user, payload) {
  await requireActiveMerchant(user)
  assert(user.role === 'customer', '仅客户账号可以导单', 'FORBIDDEN')
  const source = payload.source
  assert(source === 'screenshot' || source === 'link', '导单来源不正确')
  const taskId = randomId('import')
  const worker = await getDocument('import_tasks', 'worker_local-mac')
  const lastSeen = worker?.updatedAt instanceof Date ? worker.updatedAt.getTime() : new Date(worker?.updatedAt || 0).getTime()
  const workerOnline = Number.isFinite(lastSeen) && Date.now() - lastSeen < 30000
  const task = {
    ownerOpenid: user.openid,
    merchantId: user.merchantId,
    source,
    status: 'queued',
    progress: 0,
    message: workerOnline ? '等待本地识别服务处理' : '任务已保存，档口识别服务当前未在线',
    workerOnline,
    createdAt: db.serverDate(),
    updatedAt: db.serverDate()
  }
  if (source === 'screenshot') {
    assert(Array.isArray(payload.fileIds) && payload.fileIds.length > 0 && payload.fileIds.length <= 9, '请选择 1–9 张订单截图')
    task.fileIds = payload.fileIds.map((item) => cleanText(item, 500)).filter((item) => item.startsWith('cloud://'))
    assert(task.fileIds.length === payload.fileIds.length, '截图文件地址无效')
  } else {
    task.url = validateShareUrl(payload.url)
  }
  await db.collection('import_tasks').doc(taskId).set({ data: task })
  return { id: taskId, source, status: 'queued', progress: 0, message: task.message }
}

function toClientTask(task) {
  return {
    id: task._id,
    source: task.source,
    status: task.status,
    progress: task.progress,
    message: task.message,
    result: task.result || [],
    createdAt: task.createdAt || ''
  }
}

async function listImportsAction(user) {
  const result = await db.collection('import_tasks').where({ ownerOpenid: user.openid }).orderBy('createdAt', 'desc').limit(50).get()
  return { items: (result.data || []).map(toClientTask) }
}

async function getImportAction(user, payload) {
  const task = await getDocument('import_tasks', cleanText(payload.taskId, 100))
  assert(task, '导单任务不存在', 'NOT_FOUND')
  assert(user.role === 'stall' || task.ownerOpenid === user.openid, '无权查看此导单任务', 'FORBIDDEN')
  return toClientTask(task)
}

async function applyImportAction(user, payload) {
  const task = await getDocument('import_tasks', cleanText(payload.taskId, 100))
  assert(task, '导单任务不存在', 'NOT_FOUND')
  assert(task.ownerOpenid === user.openid, '无权使用此导单任务', 'FORBIDDEN')
  assert(task.status === 'completed' || task.status === 'review', '识别尚未完成')
  const resultItems = task.result || []
  const productIds = [...new Set(resultItems.map((item) => item.productId).filter(Boolean))]
  const priceEntries = await Promise.all(productIds.map(async (productId) => {
    const product = await getDocument('products', productId)
    const customerPrice = await getDocument('customer_prices', `${user.merchantId}_${productId}`)
    return [productId, asInteger(customerPrice?.unitPriceCents, product?.basePriceCents)]
  }))
  const priceMap = new Map(priceEntries)
  const pricedItems = resultItems.map((item) => {
    const unitPriceCents = asInteger(priceMap.get(item.productId), Math.round(Number(item.unitPrice) * 100))
    return { ...item, unitPrice: Number((unitPriceCents / 100).toFixed(2)) }
  })
  const fileIds = Array.isArray(task.fileIds) ? task.fileIds.filter(Boolean) : []
  if (fileIds.length) {
    try {
      await cloud.deleteFile({ fileList: fileIds })
    } catch (error) {
      console.warn(`[${task._id}] 导单原图清理失败`, error)
    }
  }
  const updateData = { appliedAt: db.serverDate(), fileIds: [], updatedAt: db.serverDate() }
  if (fileIds.length) updateData.sourceFilesDeletedAt = db.serverDate()
  await db.collection('import_tasks').doc(task._id).update({ data: updateData })
  return { items: pricedItems }
}

async function deleteExportAction(user, payload) {
  const fileId = cleanText(payload.fileId, 1000)
  assert(fileId.startsWith('cloud://') && fileId.includes('/exports/'), '只能清理账单导出文件')
  assert(user.role === 'stall' || fileId.includes(`/exports/${user.merchantId}/`), '无权清理此账单文件', 'FORBIDDEN')
  await cloud.deleteFile({ fileList: [fileId] })
  await db.collection('audit_logs').add({
    data: { actorOpenid: user.openid, action: 'bill.export.delete', targetId: stableId('file', fileId), createdAt: db.serverDate() }
  })
  return { deleted: true }
}

async function exportBillAction(user, payload) {
  const ExcelJS = require('exceljs')
  const selectedDate = /^\d{4}-\d{2}-\d{2}$/.test(String(payload.date || '')) ? String(payload.date) : dateKey()
  const merchantId = user.role === 'stall' && payload.merchantId ? cleanText(payload.merchantId, 80) : user.merchantId
  const merchant = await getDocument('merchants', merchantId)
  const orderResult = await db.collection('orders').where({ merchantId, dateKey: selectedDate }).limit(100).get()
  const orders = (orderResult.data || []).filter((order) => order.status !== 'cancelled' && order.accountingStatus !== 'unposted')
  assert(orders.length > 0, '所选日期没有已实配入账的订单', 'NO_DATA')

  const workbook = new ExcelJS.Workbook()
  workbook.creator = '档口订货'
  workbook.created = new Date()
  const sheet = workbook.addWorksheet('每日账单', { views: [{ state: 'frozen', ySplit: 4 }] })
  sheet.mergeCells('A1:H1')
  sheet.getCell('A1').value = '示例档口 · 客户每日账单'
  sheet.getCell('A1').font = { bold: true, size: 16 }
  sheet.getCell('A2').value = '客户'
  sheet.getCell('B2').value = merchant?.name || merchantId
  sheet.getCell('D2').value = '日期'
  sheet.getCell('E2').value = selectedDate
  sheet.addRow([])
  sheet.addRow(['订单号', '款号', '商品', '花色/规格', '数量', '单价', '小计', '状态'])
  sheet.getRow(4).font = { bold: true, color: { argb: 'FF2A2300' } }
  sheet.getRow(4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFD633' } }

  orders.forEach((order) => {
    ;(order.items || []).forEach((line) => {
      sheet.addRow([
        order._id,
        line.productCode,
        line.name,
        `${line.color} ${line.size || line.specs}码`,
        line.quantity,
        asInteger(line.unitPriceCents) / 100,
        asInteger(line.subtotalCents) / 100,
        order.status
      ])
    })
  })
  const original = orders.reduce((sum, order) => sum + asInteger(order.originalCents), 0)
  const adjustments = orders.reduce((sum, order) => sum + asInteger(order.adjustmentCents), 0)
  const returns = orders.reduce((sum, order) => sum + asInteger(order.returnCents), 0)
  const discounts = orders.reduce((sum, order) => sum + asInteger(order.discountCents), 0)
  const payable = orders.reduce((sum, order) => sum + asInteger(order.payableCents), 0)
  sheet.addRow([])
  sheet.addRow(['汇总', '', '', '', '', '原账单', original / 100, ''])
  sheet.addRow(['', '', '', '', '', '调价', -adjustments / 100, ''])
  sheet.addRow(['', '', '', '', '', '退货', -returns / 100, ''])
  sheet.addRow(['', '', '', '', '', '优惠', -discounts / 100, ''])
  const totalRow = sheet.addRow(['', '', '', '', '', '应付金额', payable / 100, ''])
  totalRow.font = { bold: true, size: 13 }
  ;['F', 'G'].forEach((column) => { sheet.getColumn(column).numFmt = '¥#,##0.00' })
  sheet.columns = [
    { width: 31 }, { width: 12 }, { width: 20 }, { width: 28 },
    { width: 10 }, { width: 12 }, { width: 14 }, { width: 14 }
  ]
  sheet.eachRow((row) => { row.alignment = { vertical: 'middle', wrapText: true } })

  const buffer = Buffer.from(await workbook.xlsx.writeBuffer())
  const safeMerchant = (merchant?.name || '客户').replace(/[\\/:*?"<>|]/g, '_').slice(0, 30)
  const fileName = `${safeMerchant}-${selectedDate}-账单.xlsx`
  const upload = await cloud.uploadFile({
    cloudPath: `exports/${merchantId}/${selectedDate}/${stableId('bill', `${merchantId}:${selectedDate}:${Date.now()}`)}.xlsx`,
    fileContent: buffer
  })
  return { fileId: upload.fileID, fileName }
}

async function seedAction(user) {
  requireStall(user)
  const seeds = sampleProductSeeds
  let seeded = 0
  await db.collection('merchants').doc('sample-stall').set({
    data: { ownerOpenid: user.openid, name: '示例档口', status: 'active', createdAt: db.serverDate(), updatedAt: db.serverDate() }
  })
  for (let start = 0; start < seeds.length; start += 10) {
    await Promise.all(seeds.slice(start, start + 10).map(async (seed) => {
      const id = stableId('product', seed.code)
      const current = await getDocument('products', id)
      if (current) return
      await db.collection('products').doc(id).set({
        data: {
          ...seed,
          reserved: 0,
          createdAt: db.serverDate(),
          updatedAt: db.serverDate()
        }
      })
      seeded += 1
    }))
  }
  return { seeded }
}

function downloadImage(url, redirects = 0) {
  assert(redirects <= 3, '商品图片重定向次数过多', 'IMAGE_DOWNLOAD_FAILED')
  return new Promise((resolve, reject) => {
    const request = https.get(url, { timeout: 15000 }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume()
        downloadImage(new URL(response.headers.location, url).toString(), redirects + 1).then(resolve, reject)
        return
      }
      if (response.statusCode !== 200) {
        response.resume()
        reject(new Error(`商品图片下载失败：HTTP ${response.statusCode}`))
        return
      }
      const chunks = []
      let size = 0
      response.on('data', (chunk) => {
        size += chunk.length
        if (size > 10 * 1024 * 1024) {
          request.destroy(new Error('商品图片超过 10MB'))
          return
        }
        chunks.push(chunk)
      })
      response.on('end', () => resolve(Buffer.concat(chunks)))
    })
    request.on('timeout', () => request.destroy(new Error('商品图片下载超时')))
    request.on('error', reject)
  })
}

async function migrateProductImagesAction(user) {
  requireStall(user)
  const results = []
  for (const seed of sampleProductSeeds) {
    const cover = (seed.images || []).find((image) => image.type === 'cover')
    assert(cover?.fileId?.startsWith('https://'), `${seed.code} 缺少远程封面图`, 'IMAGE_SOURCE_MISSING')
    const extension = /\.png(?:$|\?)/i.test(cover.fileId) ? 'png' : 'jpg'
    const upload = await cloud.uploadFile({
      cloudPath: `catalog/${seed.code}.${extension}`,
      fileContent: await downloadImage(cover.fileId)
    })
    const images = [
      { fileId: upload.fileID, type: 'cover' },
      ...(seed.images || []).filter((image) => image !== cover)
    ]
    const productId = stableId('product', seed.code)
    const current = await getDocument('products', productId)
    await db.collection('products').doc(productId).set({
      data: {
        ...seed,
        status: current?.status || 'sale',
        referenceTotal: asInteger(current?.referenceTotal, seed.referenceTotal),
        reserved: asInteger(current?.reserved),
        images,
        createdAt: current?.createdAt || db.serverDate(),
        updatedAt: db.serverDate()
      }
    })
    results.push({ code: seed.code, fileId: upload.fileID })
  }
  return { migrated: results.length, images: results }
}

const actions = {
  'staff.me': staffMeAction,
  'staff.apply': staffApplyAction,
  'staff.list': staffListAction,
  'staff.review': staffReviewAction,
  'auth.login': loginAction,
  'app.bootstrap': bootstrapAction,
  'profile.update': updateProfileAction,
  'profile.phone': getPhoneNumberAction,
  'admin.customer.list': adminCustomerListAction,
  'admin.customer.detail': adminCustomerDetailAction,
  'admin.customer.status': adminCustomerStatusAction,
  'product.alias.save': saveProductAliasAction,
  'cart.save': saveCartAction,
  'order.submit': submitOrderAction,
  'order.transition': transitionOrderAction,
  'order.correct': correctOrderAction,
  'order.acknowledge': acknowledgeOrderAction,
  'return.submit': submitReturnAction,
  'return.transition': transitionReturnAction,
  'bill.adjust': adjustBillAction,
  'bill.export': exportBillAction,
  'file.deleteExport': deleteExportAction,
  'product.upsert': upsertProductAction,
  'inventory.addStock': addStockAction,
  'import.create': createImportAction,
  'import.get': getImportAction,
  'import.list': listImportsAction,
  'import.apply': applyImportAction,
  'admin.seed': seedAction,
  'admin.migrateProductImages': migrateProductImagesAction
}

exports.main = async (event = {}) => {
  const startedAt = Date.now()
  const requestId = randomId('request')
  const context = cloud.getWXContext()
  const action = cleanText(event.action, 80)
  try {
    assert(context.OPENID, '无法获取微信身份', 'UNAUTHENTICATED')
    const user = await ensureUser(context.OPENID)
    if (action === 'app.bootstrap' && event.viewAs === 'stall') requireStall(user)
    const actingUser = user.role === 'stall' && event.viewAs === 'customer'
      ? { ...user, role: 'customer', authorizedRole: 'stall', profileComplete: true }
      : { ...user, authorizedRole: user.role }
    if (['bill.adjust', 'bill.export', 'file.deleteExport'].includes(action)) requireBilling(actingUser)
    if (['admin.seed', 'admin.migrateProductImages'].includes(action)) requireOwner(actingUser)
    const handler = actions[action]
    assert(handler, `不支持的操作：${action}`, 'UNKNOWN_ACTION')
    const data = await handler(actingUser, event.payload || {}, context)
    return { ok: true, data, requestId, durationMs: Date.now() - startedAt }
  } catch (error) {
    console.error(`[${requestId}]`, error)
    await db.collection('audit_logs').add({ data: {
      requestId,
      action,
      openid: context.OPENID || '',
      level: 'error',
      code: error.code || 'INTERNAL_ERROR',
      message: cleanText(error.message || '服务器处理失败', 300),
      durationMs: Date.now() - startedAt,
      createdAt: db.serverDate()
    } }).catch((logError) => console.error(`[${requestId}] audit log failed`, logError))
    return {
      ok: false,
      error: {
        code: error.code || 'INTERNAL_ERROR',
        message: error.code ? error.message : '服务器处理失败，请稍后重试',
        requestId
      },
      requestId
    }
  }
}
