const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const db = cloud.database()
  const { idempotencyKey, items = [] } = event

  if (!idempotencyKey || !Array.isArray(items) || !items.length) {
    throw new Error('订单参数不完整')
  }

  const duplicated = await db.collection('orders').where({ openid: OPENID, idempotencyKey }).limit(1).get()
  if (duplicated.data.length) return { orderId: duplicated.data[0]._id, duplicated: true }

  // 正式版需要在此处从 products/customer_prices 读取服务端价格，禁止信任客户端单价。
  const result = await db.collection('orders').add({
    data: {
      openid: OPENID,
      idempotencyKey,
      items,
      status: 'pending',
      createdAt: db.serverDate()
    }
  })

  return { orderId: result._id, duplicated: false }
}

