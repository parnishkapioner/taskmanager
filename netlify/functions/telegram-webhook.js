// Telegram Webhook — принимает сообщения от бота и сохраняет задачи в Supabase

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_KEY
const TG_TOKEN = process.env.TG_TOKEN
const TG_CHAT_ID = process.env.TG_CHAT_ID

async function supabaseInsert(data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/tasks`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify(data)
  })
  return res.ok
}

async function sendTg(chatId, text) {
  await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' })
  })
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 200, body: 'ok' }

  let body
  try { body = JSON.parse(event.body) } catch { return { statusCode: 200, body: 'ok' } }

  const message = body.message
  if (!message) return { statusCode: 200, body: 'ok' }

  const chatId = String(message.chat.id)
  const text = (message.text || '').trim()

  // Проверяем что это наш чат
  if (chatId !== String(TG_CHAT_ID)) {
    await sendTg(chatId, '⛔ Нет доступа')
    return { statusCode: 200, body: 'ok' }
  }

  // /start
  if (text === '/start') {
    await sendTg(chatId,
      '👋 Привет! Я твой таск-менеджер.\n\n' +
      'Просто напиши мне задачу — я сохраню.\n\n' +
      '<b>Команды:</b>\n' +
      '/tasks — показать активные задачи\n' +
      '/dump — быстрый brain dump\n' +
      '/help — справка\n\n' +
      '<b>Приоритет:</b> добавь в конце !high, !medium или !low\n' +
      'Пример: <i>Позвонить врачу !high</i>'
    )
    return { statusCode: 200, body: 'ok' }
  }

  // /help
  if (text === '/help') {
    await sendTg(chatId,
      '<b>Как добавить задачу:</b>\n' +
      'Просто напиши текст — сохранится со средним приоритетом\n\n' +
      '<b>Приоритет:</b>\n' +
      'Позвонить врачу !high → 🔴 высокий\n' +
      'Купить молоко !low → 🟢 низкий\n\n' +
      '<b>Дедлайн:</b>\n' +
      'Сдать отчёт !high !2024-12-31\n\n' +
      '<b>Brain dump:</b>\n' +
      'Начни с /dump — сохранится как быстрая мысль'
    )
    return { statusCode: 200, body: 'ok' }
  }

  // /tasks — показать список
  if (text === '/tasks') {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/tasks?status=neq.done&order=priority.asc,created_at.desc&limit=15`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
    )
    const tasks = await res.json()
    if (!tasks.length) {
      await sendTg(chatId, '🎉 Активных задач нет!')
    } else {
      const priEmoji = { high: '🔴', medium: '🟡', low: '🟢' }
      const lines = tasks.map(t =>
        `${priEmoji[t.priority] || '⚪'} ${t.title}${t.due_date ? ' — ' + new Date(t.due_date).toLocaleDateString('ru') : ''}`
      )
      await sendTg(chatId, `<b>Активные задачи (${tasks.length}):</b>\n\n` + lines.join('\n'))
    }
    return { statusCode: 200, body: 'ok' }
  }

  // /dump — brain dump
  if (text.startsWith('/dump')) {
    const dumpText = text.replace('/dump', '').trim()
    if (!dumpText) {
      await sendTg(chatId, '⚡ Напиши мысль после /dump\nПример: /dump Идея для проекта')
      return { statusCode: 200, body: 'ok' }
    }
    const ok = await supabaseInsert({ title: dumpText, is_brain_dump: true, priority: 'low' })
    await sendTg(chatId, ok ? `⚡ Brain dump сохранён:\n"${dumpText}"` : '❌ Ошибка сохранения')
    return { statusCode: 200, body: 'ok' }
  }

  // Обычный текст — добавить задачу
  // Парсим приоритет: !high / !medium / !low
  let priority = 'medium'
  let title = text
  if (text.includes('!high')) { priority = 'high'; title = title.replace('!high', '').trim() }
  else if (text.includes('!low')) { priority = 'low'; title = title.replace('!low', '').trim() }
  else if (text.includes('!medium')) { priority = 'medium'; title = title.replace('!medium', '').trim() }

  // Парсим дату: !2024-12-31
  let due_date = null
  const dateMatch = title.match(/!(\d{4}-\d{2}-\d{2})/)
  if (dateMatch) {
    due_date = dateMatch[1]
    title = title.replace(dateMatch[0], '').trim()
  }

  const priEmoji = { high: '🔴', medium: '🟡', low: '🟢' }
  const ok = await supabaseInsert({ title, priority, due_date })
  await sendTg(chatId,
    ok
      ? `✅ Задача сохранена!\n\n${priEmoji[priority]} <b>${title}</b>${due_date ? '\n📅 ' + due_date : ''}`
      : '❌ Ошибка сохранения'
  )

  return { statusCode: 200, body: 'ok' }
}
