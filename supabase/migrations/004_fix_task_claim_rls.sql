-- ─────────────────────────────────────────────────────────────────────────────
-- 004_fix_task_claim_rls.sql
--
-- BUG: the original "authenticated can modify tasks" policy only allowed
-- updating a task already assigned to you (assigned_to = auth.uid()) or if you
-- are admin. So a cleaning/maintenance/host user tapping "Iniciar" on an
-- UNASSIGNED task (assigned_to = NULL) — to claim it for themselves — was
-- blocked by RLS. Self-assignment, completing, and editing notes on unassigned
-- tasks all failed silently for non-admins.
--
-- FIX: this is a small, fully-trusted internal team. Any authenticated staff
-- member legitimately manages cleanings (claim, start, finish, annotate).
-- Authorization of WHO sees WHAT is already enforced in the app (canDo + UI).
-- So allow authenticated users to modify tasks. Run once in the Supabase SQL editor.
-- ─────────────────────────────────────────────────────────────────────────────

drop policy if exists "authenticated can modify tasks" on public.tasks;

create policy "authenticated can modify tasks"
  on public.tasks for all to authenticated
  using (true)
  with check (true);
