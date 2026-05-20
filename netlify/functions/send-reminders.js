// Отправляет напоминания в Telegram — запускается по расписанию каждый час

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_KEY
const TG_TOKEN = process.env.TG_TOKEN
const TG_CHAT_ID = process.env.TG_CHAT_ID

async function sendTg(text) {
  await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TG_CHAT_ID, text, parse_mode: 'HTML' })
  })
}

async function supabaseGet(query) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${query}`, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
  })
  return res.json()
}

async function supabaseUpdate(id, data) {
  await fetch(`${SUPABASE_URL}/rest/v1/tasks?id=eq.${id}`, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(data)
  })
}

exports.handler = async () => {
  const now = new Date()
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000)

  // 1. Задачи просроченные (дедлайн прошёл, ещё не завершены)
  const overdue = await supabaseGet(
    `tasks?status=neq.done&due_date=lt.${now.toISOString()}&notified_overdue=eq.false&is_brain_dump=eq.false`
  )

  for (const task of overdue) {
    const priEmoji = { high: '🔴', medium: '🟡', low: '🟢' }
    await sendTg(
      `⚠️ <b>Просрочена!</b>\n\n${priEmoji[task.priority]} ${task.title}\n📅 Дедлайн: ${new Date(task.due_date).toLocaleDateString('ru')}`
    )
    await supabaseUpdate(task.id, { notified_overdue: true })
  }

  // 2. Задачи с дедлайном через 24 часа
  const dueSoon = await supabaseGet(
    `tasks?status=neq.done&due_date=gt.${now.toISOString()}&due_date=lt.${tomorrow.toISOString()}&notified_1day=eq.false&is_brain_dump=eq.false`
  )

  for (const task of dueSoon) {
    const priEmoji = { high: '🔴', medium: '🟡', low: '🟢' }
    await sendTg(
      `⏰ <b>Дедлайн завтра!</b>\n\n${priEmoji[task.priority]} ${task.title}\n📅 ${new Date(task.due_date).toLocaleString('ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`
    )
    await supabaseUpdate(task.id, { notified_1day: true })
  }

  // 3. Утренняя сводка — только в 9:00 (час = 9 по UTC+3 = 6 UTC)
  if (now.getUTCHours() === 6) {
    const todayEnd = new Date(now)
    todayEnd.setUTCHours(23, 59, 59)

    const todayTasks = await supabaseGet(
      `tasks?status=neq.done&is_brain_dump=eq.false&order=priority.asc&limit=10`
    )

    if (todayTasks.length > 0) {
      const priEmoji = { high: '🔴', medium: '🟡', low: '🟢' }
      const lines = todayTasks.slice(0, 10).map(t =>
        `${priEmoji[t.priority] || '⚪'} ${t.title}`
      )
      await sendTg(
        `☀️ <b>Доброе утро! Твои задачи:</b>\n\n` + lines.join('\n') +
        (todayTasks.length > 10 ? `\n\n...и ещё ${todayTasks.length - 10}` : '')
      )
    }
  }

  return { statusCode: 200, body: JSON.stringify({ overdue: overdue.length, dueSoon: dueSoon.length }) }
}
