const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

exports.main = async () => {
  const { OPENID, APPID, UNIONID } = cloud.getWXContext()
  const db = cloud.database()
  const users = db.collection('users')
  const existing = await users.where({ openid: OPENID }).limit(1).get()

  if (existing.data.length) {
    return { openid: OPENID, role: existing.data[0].role }
  }

  await users.add({
    data: {
      openid: OPENID,
      appid: APPID,
      unionid: UNIONID || '',
      role: 'customer',
      createdAt: db.serverDate()
    }
  })

  return { openid: OPENID, role: 'customer', isNewUser: true }
}

