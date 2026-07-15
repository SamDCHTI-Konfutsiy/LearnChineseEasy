-- ============================================================
-- FOYDALANUVCHI PROFILLARI VA ADMIN BLOKLASH TIZIMI
-- Bu skriptni Supabase loyihangizda: SQL Editor -> New query
-- ga qo'yib, "Run" tugmasini bosing.
-- ============================================================

-- 1) Har bir userga tegishli qo'shimcha ma'lumotlar jadvali
--    (auth.users - Supabase o'zi boshqaradigan, tega olmaydigan
--    tizim jadvali; shuning uchun unga bog'langan alohida
--    "profiles" jadval yaratamiz)
create table public.profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  email text,
  full_name text,
  role text not null default 'user' check (role in ('user','admin')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- 2) Yangi user ro'yxatdan o'tganda profiles jadvaliga
--    avtomatik qator qo'shadigan trigger
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 3) Row Level Security'ni yoqamiz — shundan keyin HAR BIR
--    so'rov quyidagi siyosatlar orqali tekshiriladi
alter table public.profiles enable row level security;

-- 4) Har bir user faqat OʻZ profilini koʻra oladi
create policy "users_select_own_profile"
  on public.profiles for select
  using (auth.uid() = id);

-- 5) Admin barcha profillarni koʻra oladi
create policy "admins_select_all_profiles"
  on public.profiles for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

-- 6) Faqat admin boshqa userlarning is_active / role
--    maydonlarini oʻzgartira oladi (oddiy user oʻzini admin
--    qilib olmasin yoki oʻzini qayta faollashtira olmasin)
create policy "admins_update_any_profile"
  on public.profiles for update
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

-- ============================================================
-- FOYDALANUVCHI TO'PLAMLARI (DECKS) VA KARTALARI (CARDS)
-- ============================================================
create extension if not exists pgcrypto;

create table public.decks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);
alter table public.decks enable row level security;
create policy "decks_owner_all" on public.decks for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create table public.cards (
  id uuid primary key default gen_random_uuid(),
  deck_id uuid not null references public.decks(id) on delete cascade,
  front text not null,
  back text not null,
  hanzi text,
  pinyin text,
  created_at timestamptz not null default now()
);
alter table public.cards enable row level security;
create policy "cards_owner_all" on public.cards for all
  using (exists (select 1 from public.decks d where d.id = deck_id and d.owner_id = auth.uid()))
  with check (exists (select 1 from public.decks d where d.id = deck_id and d.owner_id = auth.uid()));

-- ============================================================
-- TAKRORLASH JADVALI (SPACED REPETITION)
-- card_key: o'z kartalar uchun cards.id, built-in HSK so'zlari
-- uchun 'hsk:L{daraja}:{hanzi}|{pinyin}' ko'rinishida bo'ladi —
-- shu tufayli HSK so'zlari cards jadvaliga nusxalanmaydi, baza
-- kichik va tez bo'lib qoladi.
-- ============================================================
create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  card_key text not null,
  ease numeric not null default 2.5,
  interval_days numeric not null default 0,
  reps int not null default 0,
  due_date date not null default current_date,
  last_reviewed timestamptz,
  unique (user_id, card_key)
);
alter table public.reviews enable row level security;
create policy "reviews_owner_all" on public.reviews for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ============================================================
-- OʻZINGIZNI ADMIN QILIB BELGILASH
-- Avval saytda oddiy foydalanuvchi sifatida ro'yxatdan o'ting,
-- keyin shu SQL'ni email manzilingizni almashtirib ishga tushiring:
-- ============================================================
-- update public.profiles set role = 'admin' where email = 'sizning@emailingiz.com';
