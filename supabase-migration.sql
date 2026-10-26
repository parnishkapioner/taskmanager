-- Запусти один раз: Supabase → SQL Editor → New query → вставить → Run
-- Безопасно запускать повторно.

alter table tasks
  add column if not exists area         text,          -- 'personal' | 'work' | null (= входящие)
  add column if not exists category     text,          -- sport/health/finance/home/underdogs | ttp/jru/other
  add column if not exists subcategory  text,          -- as/heritage/other | events/rent/staff/other
  add column if not exists completed_at timestamptz,   -- когда отмечено «готово»
  add column if not exists notified_overdue boolean default false,
  add column if not exists notified_1day    boolean default false;

-- Дедлайн должен хранить дату И время с часовым поясом
alter table tasks alter column due_date type timestamptz using due_date::timestamptz;

-- Уже выполненные задачи сразу попадут в «Сделано»
update tasks set completed_at = coalesce(completed_at, created_at) where status = 'done';
