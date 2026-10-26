// Google Календарь → события для сайта.
// Читает секретные iCal-ссылки из переменной окружения GCAL_ICS_URL
// (можно несколько через запятую: личный, рабочий...).
// GET /.netlify/functions/calendar?from=ISO&to=ISO

import ICAL from 'ical.js'

const CACHE_MS = 5 * 60 * 1000
const cache = new Map() // url -> { at, text }

const LINK_RE = /https?:\/\/(?:[\w-]+\.)?(?:zoom\.us\/(?:j|my|w)\/[^\s<>"')]+|meet\.google\.com\/[a-z0-9-]+|teams\.microsoft\.com\/l\/meetup-join\/[^\s<>"')]+|telemost\.yandex\.ru\/j\/[^\s<>"')]+)/i

function findLink(...texts) {
  for (const t of texts) {
    if (!t) continue
    const m = String(t).match(LINK_RE)
    if (m) return m[0].replace(/[.,;]+$/, '')
  }
  return null
}
function linkLabel(url) {
  if (!url) return null
  if (url.includes('zoom.us')) return 'Zoom'
  if (url.includes('meet.google')) return 'Google Meet'
  if (url.includes('teams.microsoft')) return 'Teams'
  if (url.includes('telemost')) return 'Телемост'
  return 'Подключиться'
}

async function fetchIcs(url) {
  const c = cache.get(url)
  if (c && Date.now() - c.at < CACHE_MS) return c.text
  const r = await fetch(url)
  if (!r.ok) throw new Error(`iCal ${r.status}`)
  const text = await r.text()
  cache.set(url, { at: Date.now(), text })
  return text
}

function toEvent(ev, start, end, calName, master) {
  const p = ev.component
  const mp = master ? master.component : null
  const link = findLink(
    p.getFirstPropertyValue('x-google-conference'), ev.location, p.getFirstPropertyValue('url'), ev.description,
    mp && mp.getFirstPropertyValue('x-google-conference'), master && master.location, master && master.description)
  end = end || start
  // События «на весь день» отдаём датой без времени, чтобы не съезжали из-за часового пояса
  const fmt = t => t.isDate ? t.toString().slice(0, 10) : t.toJSDate().toISOString()
  return {
    title: ev.summary || '(без названия)',
    start: fmt(start),
    end: fmt(end),
    allDay: start.isDate,
    location: ev.location || null,
    link, linkLabel: linkLabel(link),
    calendar: calName,
  }
}

function eventsBetween(text, from, to) {
  const root = new ICAL.Component(ICAL.parse(text))
  for (const tz of root.getAllSubcomponents('vtimezone')) {
    try { ICAL.TimezoneService.register(tz) } catch {}
  }
  const calName = root.getFirstPropertyValue('x-wr-calname') || ''
  const vevents = root.getAllSubcomponents('vevent')

  // Связываем исключения (перенесённые повторы) с основными событиями
  const masters = new Map()
  const exceptions = []
  for (const v of vevents) {
    const ev = new ICAL.Event(v)
    if (v.getFirstPropertyValue('status') === 'CANCELLED') { if (!ev.isRecurrenceException()) continue }
    if (ev.isRecurrenceException()) exceptions.push(ev)
    else masters.set(ev.uid, ev)
  }
  for (const ex of exceptions) {
    const m = masters.get(ex.uid)
    if (m) m.relateException(ex)
  }

  const fromT = ICAL.Time.fromJSDate(from, true)
  const toT = ICAL.Time.fromJSDate(to, true)
  const out = []

  for (const ev of masters.values()) {
    if (!ev.isRecurring()) {
      if (!ev.startDate) continue
      const end = ev.endDate || ev.startDate
      if (ev.startDate.toJSDate() < to && end.toJSDate() > from) out.push(toEvent(ev, ev.startDate, ev.endDate, calName))
      continue
    }
    const it = ev.iterator()
    let next, guard = 0
    while ((next = it.next()) && guard++ < 2000) {
      if (next.toJSDate() >= to) break
      const d = ev.getOccurrenceDetails(next)
      if (d.item.component.getFirstPropertyValue('status') === 'CANCELLED') continue
      if (d.endDate.toJSDate() <= from) continue
      out.push(toEvent(d.item, d.startDate, d.endDate, calName, ev))
    }
  }
  return out
}

export default async (req) => {
  const urls = (process.env.GCAL_ICS_URL || '').split(/[\s,]+/).filter(Boolean)
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'private, max-age=120' }
  if (!urls.length) return new Response(JSON.stringify({ configured: false, events: [] }), { headers })

  const q = new URL(req.url).searchParams
  const from = new Date(q.get('from') || Date.now())
  const to = new Date(q.get('to') || Date.now() + 7 * 864e5)
  if (isNaN(from) || isNaN(to) || to - from > 100 * 864e5) {
    return new Response(JSON.stringify({ error: 'bad range' }), { status: 400, headers })
  }

  const events = []
  const errors = []
  await Promise.all(urls.map(async url => {
    try { events.push(...eventsBetween(await fetchIcs(url), from, to)) }
    catch (e) { errors.push(String(e.message || e)) }
  }))
  events.sort((a, b) => a.start.localeCompare(b.start))
  return new Response(JSON.stringify({ configured: true, events, errors }), { headers })
}
