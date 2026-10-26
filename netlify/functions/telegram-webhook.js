// Telegram Webhook — принимает сообщения от бота и сохраняет задачи в Supabase

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_KEY
const TG_TOKEN = process.env.TG_TOKEN
const TG_CHAT_ID = process.env.TG_CHAT_ID
const TZ_OFFSET = '+03:00' // Минск

// Хэштеги → блок / категория / направление
const TAGS = {
  'личное':    { area: 'personal' },
  'л':         { area: 'personal' },
  'спорт':     { area: 'personal', category: 'sport' },
  'здоровье':  { area: 'personal', category: 'health' },
  'финансы':   { area: 'personal', category: 'finance' },
  'быт':       { area: 'personal', category: 'home' },
  'underdogs': { area: 'personal', category: 'underdogs' },
  'андердогс': { area: 'personal', category: 'underdogs' },

  'работа':    { area: 'work', category: 'other' },
  'прочее':    { area: 'work', category: 'other' },
  'ttp':       { area: 'work', category: 'ttp' },
  'ттп':       { area: 'work', category: 'ttp' },
  'as':        { area: 'work', category: 'ttp', subcategory: 'as' },
  'heritage':  { area: 'work', category: 'ttp', subcategory: 'heritage' },
  'jru':       { area: 'work', category: 'jru' },
  'events':    { area: 'work', category: 'jru', subcategory: 'events' },
  'ивенты':    { area: 'work', category: 'jru', subcategory: 'events' },
  'rent':      { area: 'work', category: 'jru', subcategory: 'rent' },
  'аренда':    { area: 'work', category: 'jru', subcategory: 'rent' },
  'staff':     { area: 'work', category: 'jru', subcategory: 'staff' },
  'персонал':  { area: 'work', category: 'jru', subcategory: 'staff' },
}
const LABELS = {
  personal: 'Личное', work: 'Работа',
  sport: 'Спорт', health: 'Здоровье', finance: 'Финансы', home: 'Быт', underdogs: 'Underdogs',
  ttp: 'TTP', jru: 'JRU', other: 'Прочее',
  as: 'AS', heritage: 'Heritage', events: 'Events', rent: 'Rent', staff: 'Staff',
}

async function supabase(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {})
    }
  })
}

async function sendTg(chatId, text) {
  await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true })
  })
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const pad = n => String(n).padStart(2, '0')

// «Сегодня» по Минску
function minskToday() {
  const d = new Date(Date.now() + 3 * 3600e3)
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() }
}
function isoAt(y, m, d, hh = 23, mm = 59) {
  return `${y}-${pad(m)}-${pad(d)}T${pad(hh)}:${pad(mm)}:00${TZ_OFFSET}`
}
function shiftDays(base, n) {
  const x = new Date(Date.UTC(base.y, base.m - 1, base.d + n))
  return { y: x.getUTCFullYear(), m: x.getUTCMonth() + 1, d: x.getUTCDate() }
}

// Разбор сообщения: первая строка — задача, остальные строки — пометки
function parseTask(raw) {
  const lines = raw.split('\n')
  let title = lines[0]
  const notes = lines.slice(1).join('\n').trim() || null

  let priority = 'medium'
  title = title.replace(/!(high|medium|low|срочно)(?=\s|$)/gi, (_, p) => {
    p = p.toLowerCase(); priority = p === 'срочно' ? 'high' : p; return ''
  })

  let due_date = null
  const time = '(?:\\s+(\\d{1,2}):(\\d{2}))?'
  const today = minskToday()
  let m
  if ((m = title.match(new RegExp('!(сегодня|завтра|послезавтра)' + time, 'i')))) {
    const shift = { 'сегодня': 0, 'завтра': 1, 'послезавтра': 2 }[m[1].toLowerCase()]
    const day = shiftDays(today, shift)
    due_date = isoAt(day.y, day.m, day.d, m[2] ? +m[2] : 23, m[3] ? +m[3] : 59)
    title = title.replace(m[0], '')
  } else if ((m = title.match(new RegExp('!(\\d{4})-(\\d{2})-(\\d{2})' + time)))) {
    due_date = isoAt(+m[1], +m[2], +m[3], m[4] ? +m[4] : 23, m[5] ? +m[5] : 59)
    title = title.replace(m[0], '')
  } else if ((m = title.match(new RegExp('!(\\d{1,2})\\.(\\d{1,2})(?:\\.(\\d{2,4}))?' + time)))) {
    let y = m[3] ? +m[3] : today.y
    if (y < 100) y += 2000
    if (!m[3] && (+m[2] < today.m || (+m[2] === today.m && +m[1] < today.d))) y += 1 // дата уже прошла → следующий год
    due_date = isoAt(y, +m[2], +m[1], m[4] ? +m[4] : 23, m[5] ? +m[5] : 59)
    title = title.replace(m[0], '')
  }

  const cls = {}
  title = title.replace(/#([\p{L}\d_]+)/gu, (full, tag) => {
    const t = TAGS[tag.toLowerCase()]
    if (!t) return full
    // более точный тег (с направлением) важнее общего
    if (!cls.area || Object.keys(t).length >= Object.keys(cls).length) Object.assign(cls, t)
    return ''
  })

  title = title.replace(/\s{2,}/g, ' ').trim()
  return { title, notes, priority, due_date, ...cls }
}

function describe(t) {
  const path = [t.area, t.category, t.subcategory].filter(Boolean).map(k => LABELS[k]).join(' · ')
  const due = t.due_date
    ? new Date(t.due_date).toLocaleString('ru', { timeZone: 'Europe/Minsk', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).replace(', 23:59', '')
    : null
  const missing = []
  if (!t.area) missing.push('блок (#личное, #ttp, #jru…)')
  if (!t.due_date) missing.push('дедлайн (!завтра, !31.12 15:00)')
  if (!t.notes) missing.push('пометки (со второй строки)')
  return { path, due, missing }
}

const HELP =
  '<b>Как добавить задачу</b>\n' +
  'Первая строка — задача, со второй строки — пометки.\n\n' +
  '<b>Блок</b>: #личное #спорт #здоровье #финансы #быт #underdogs\n' +
  '#ttp #as #heritage · #jru #events #rent #staff · #работа\n\n' +
  '<b>Дедлайн</b>: !сегодня, !завтра 15:00, !31.12, !2026-12-31 18:00\n' +
  '<b>Приоритет</b>: !срочно (или !high / !low)\n\n' +
  '<b>Пример</b>\n' +
  '<code>Сверить бюджет ивента #events !31.10 12:00\nЗапросить смету у подрядчика</code>\n\n' +
  'Если чего-то не хватает, задача попадёт во «Входящие», там её можно дозаполнить.\n\n' +
  '/tasks — ближайшие задачи\n/dump текст — быстрая мысль во входящие'

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 200, body: 'ok' }

  let body
  try { body = JSON.parse(event.body) } catch { return { statusCode: 200, body: 'ok' } }

  const message = body.message
  if (!message) return { statusCode: 200, body: 'ok' }

  const chatId = String(message.chat.id)
  const text = (message.text || '').trim()

  if (chatId !== String(TG_CHAT_ID)) {
    await sendTg(chatId, '⛔ Нет доступа')
    return { statusCode: 200, body: 'ok' }
  }

  if (text === '/start' || text === '/help') {
    await sendTg(chatId, HELP)
    return { statusCode: 200, body: 'ok' }
  }

  if (text === '/tasks') {
    const res = await supabase('tasks?status=neq.done&order=due_date.asc.nullslast&limit=15')
    const tasks = await res.json()
    if (!Array.isArray(tasks) || !tasks.length) {
      await sendTg(chatId, '🎉 Активных задач нет')
    } else {
      const now = Date.now()
      const lines = tasks.map(t => {
        const d = describe(t)
        const over = t.due_date && new Date(t.due_date) < now ? '⚠️ ' : ''
        return `${t.priority === 'high' ? '🔴 ' : '• '}${over}${esc(t.title)}${d.due ? ' — ' + d.due : ''}${d.path ? ` <i>(${d.path})</i>` : ''}`
      })
      await sendTg(chatId, `<b>Ближайшие задачи</b>\n\n` + lines.join('\n'))
    }
    return { statusCode: 200, body: 'ok' }
  }

  if (text.startsWith('/dump')) {
    const dumpText = text.replace('/dump', '').trim()
    if (!dumpText) {
      await sendTg(chatId, 'Напиши мысль после /dump\nПример: /dump Идея для проекта')
      return { statusCode: 200, body: 'ok' }
    }
    const res = await supabase('tasks', { method: 'POST', headers: { 'Prefer': 'return=minimal' }, body: JSON.stringify({ title: dumpText, is_brain_dump: true, priority: 'medium' }) })
    await sendTg(chatId, res.ok ? '⚡ Сохранено во входящие' : '❌ Ошибка сохранения')
    return { statusCode: 200, body: 'ok' }
  }

  if (!text || text.startsWith('/')) {
    await sendTg(chatId, 'Не понял команду. /help — подсказка')
    return { statusCode: 200, body: 'ok' }
  }

  const task = parseTask(text)
  if (!task.title) {
    await sendTg(chatId, 'Не вижу текста задачи. /help — подсказка')
    return { statusCode: 200, body: 'ok' }
  }

  const res = await supabase('tasks', { method: 'POST', headers: { 'Prefer': 'return=minimal' }, body: JSON.stringify(task) })
  if (!res.ok) {
    await sendTg(chatId, '❌ Ошибка сохранения: ' + esc(await res.text()))
    return { statusCode: 200, body: 'ok' }
  }

  const d = describe(task)
  let reply = `✅ <b>${esc(task.title)}</b>`
  if (d.path) reply += `\n📂 ${d.path}`
  if (d.due) reply += `\n📅 ${d.due}`
  if (task.priority === 'high') reply += `\n🔴 Высокий приоритет`
  if (d.missing.length) reply += `\n\n${task.area ? '✏️' : '📥 Во входящих.'} Не хватает: ${d.missing.join(', ')}`
  await sendTg(chatId, reply)

  return { statusCode: 200, body: 'ok' }
}

exports.parseTask = parseTask
