-- ===========================================================
-- حروف 🎯 — مخطط قاعدة بيانات Supabase
-- -----------------------------------------------------------
-- شغّل هذا السكربت في Supabase SQL Editor لإنشاء الجداول
-- وسياسات Row Level Security والـ Realtime.
-- ===========================================================

-- 1) جدول الغرف
create table if not exists public.rooms (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique,
  host_id          text not null,
  host_name        text not null,
  status           text not null default 'lobby',  -- lobby | playing | scoring | finished
  current_round    int  not null default 0,
  total_rounds     int  not null default 5,         -- 0 = مفتوح
  round_duration   int  not null default 60,        -- بالثواني
  categories       jsonb not null default '[]'::jsonb,
  scoring_mode     text  not null default 'standard',
  current_letter   text,
  round_started_at timestamptz,
  completed_by     text,
  completed_at     timestamptz,
  round_finalized  boolean not null default false,
  created_at       timestamptz not null default now()
);

-- 2) جدول اللاعبين
create table if not exists public.players (
  id           text primary key,
  room_id      uuid not null references public.rooms(id) on delete cascade,
  name         text not null,
  is_host      boolean not null default false,
  ready        boolean not null default false,
  total_score  int     not null default 0,
  joined_at    timestamptz not null default now()
);

create index if not exists idx_players_room on public.players(room_id);

-- 3) جدول إجابات كل جولة
create table if not exists public.round_answers (
  id            uuid primary key default gen_random_uuid(),
  room_id       uuid not null references public.rooms(id) on delete cascade,
  round_number  int  not null,
  player_id     text not null,
  player_name   text,
  answers       jsonb not null default '{}'::jsonb,
  completed_at  timestamptz,
  round_score   int not null default 0,
  scores        jsonb default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  unique (room_id, round_number, player_id)
);

create index if not exists idx_answers_room_round on public.round_answers(room_id, round_number);

-- ===========================================================
-- Row Level Security
-- -----------------------------------------------------------
-- بما أن اللعبة بدون مصادقة (no auth)، نسمح بالقراءة والكتابة
-- للجميع اعتمادًا على معرفة الكود السري (الـ room code).
-- في بيئة الإنتاج، يُفضّل إضافة auth أو استخدام anon key مع RLS.
-- ===========================================================

alter table public.rooms          enable row level security;
alter table public.players        enable row level security;
alter table public.round_answers  enable row level security;

-- سياسات: السماح بالكل (لأن anon key عام، والأمان يعتمد على الكود)
drop policy if exists "public read rooms"   on public.rooms;
drop policy if exists "public write rooms"   on public.rooms;
drop policy if exists "public read players"  on public.players;
drop policy if exists "public write players"  on public.players;
drop policy if exists "public read answers"   on public.round_answers;
drop policy if exists "public write answers"  on public.round_answers;

create policy "public read rooms"   on public.rooms          for select using (true);
create policy "public write rooms"   on public.rooms          for all    using (true) with check (true);
create policy "public read players"  on public.players        for select using (true);
create policy "public write players" on public.players        for all    using (true) with check (true);
create policy "public read answers"  on public.round_answers  for select using (true);
create policy "public write answers" on public.round_answers  for all    using (true) with check (true);

-- ===========================================================
-- تفعيل Realtime على الجداول
-- -----------------------------------------------------------
-- تحتاج لتشغيل هذه الأوامر لتفعيل البث اللحظي
-- ===========================================================

alter publication supabase_realtime add table public.rooms;
alter publication supabase_realtime add table public.players;
alter publication supabase_realtime add table public.round_answers;

-- ===========================================================
-- ملاحظات إضافية:
-- 1. بعد تنفيذ هذا السكربت، خذ Project URL و anon key
--    من Supabase Dashboard > Project Settings > API
-- 2. أنشئ ملف config.js بجانب index.html يحتوي على:
--    window.SUPABASE_CONFIG = {
--      url: 'https://YOUR_PROJECT.supabase.co',
--      anonKey: 'YOUR_ANON_KEY'
--    };
-- 3. أضف <script src="config.js"></script> قبل <script src="supabase.js">
--    في index.html
-- ===========================================================
