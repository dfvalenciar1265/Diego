-- Cobros adicionales y solicitudes especiales por reserva, con historial de cambios.
--
-- NO aplicar en producción sin la aprobación de Diego. Probar antes con
-- `bash scripts/test-migrations.sh` (Postgres local, nunca Supabase).
--
-- Reglas que garantiza la base (no solo la app):
--   · Un cobro adicional NO es el precio de la reserva: vive aparte y nunca toca reservations.amount.
--     Pendiente ≠ cobrado: "collected" exige fecha real y confirmación o comprobante.
--   · Una solicitud distingue registrada → avisada → lista; "lista" exige quién y la confirmación.
--   · Nada se borra: sin DELETE (trigger + sin política). Cobrado/anulado y lista/cancelada son finales.
--   · Cada alta y cambio queda en followup_history con el antes, el después, quién y por dónde.
--   · version sube en cada cambio: los escritores actualizan "WHERE version = la que leí" para no pisar
--     un cambio ajeno (concurrencia optimista).
--   · Si la reserva cambia de fechas, de apartamento o se cancela, sus cobros y solicitudes abiertos
--     quedan con review_reason (para revisar), sin borrarlos ni darlos por resueltos.
--   · No se duplican: un mismo concepto y fecha de cobro por reserva; una misma solicitud por reserva.
--
-- Recuperación (si hubiera que revertir; los datos se pierden, exportarlos antes):
--   DROP TRIGGER IF EXISTS reservation_followups_review ON public.reservations;
--   DROP TABLE IF EXISTS public.followup_history, public.special_requests, public.reservation_charges;
--   DROP FUNCTION IF EXISTS public.followup_before_write(), public.followup_log(),
--     public.followup_no_delete(), public.reservation_followups_review(), public.airadmin_is_admin();

CREATE OR REPLACE FUNCTION public.airadmin_is_admin() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.team_members WHERE id = auth.uid() AND role = 'admin' AND active)
$$;

-- ── Cobros adicionales ───────────────────────────────────────────────────────
CREATE TABLE public.reservation_charges (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id  UUID NOT NULL REFERENCES public.reservations(id) ON DELETE RESTRICT,
  property_id     UUID NOT NULL REFERENCES public.properties(id) ON DELETE RESTRICT,
  concept         TEXT NOT NULL CHECK (length(btrim(concept)) BETWEEN 2 AND 160),
  amount          NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  currency        TEXT NOT NULL DEFAULT 'COP' CHECK (currency = 'COP'),
  due_date        DATE NOT NULL,                       -- fecha prevista de cobro
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'collected', 'void')),
  collected_on    DATE,                                -- fecha real del cobro
  confirmation    TEXT,                                -- referencia, comprobante o cómo se confirmó
  void_reason     TEXT,
  notes           TEXT NOT NULL DEFAULT '',
  review_reason   TEXT,                                -- NULL = nada que revisar
  created_by      UUID NOT NULL REFERENCES public.team_members(id),
  updated_by      UUID REFERENCES public.team_members(id),
  updated_via     TEXT NOT NULL DEFAULT 'app' CHECK (updated_via IN ('app', 'mcp', 'system')),
  version         INT NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT charge_collected_needs_proof CHECK (
    status <> 'collected' OR (collected_on IS NOT NULL AND length(btrim(coalesce(confirmation, ''))) > 0)),
  CONSTRAINT charge_void_needs_reason CHECK (
    status <> 'void' OR length(btrim(coalesce(void_reason, ''))) > 0),
  CONSTRAINT charge_actor CHECK (updated_via = 'system' OR updated_by IS NOT NULL)
);
CREATE UNIQUE INDEX reservation_charges_no_dup
  ON public.reservation_charges (reservation_id, lower(btrim(concept)), due_date) WHERE status <> 'void';
CREATE INDEX reservation_charges_due ON public.reservation_charges (due_date) WHERE status = 'pending';

-- ── Solicitudes especiales (cuna, camas, …) ─────────────────────────────────
CREATE TABLE public.special_requests (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id     UUID NOT NULL REFERENCES public.reservations(id) ON DELETE RESTRICT,
  property_id        UUID NOT NULL REFERENCES public.properties(id) ON DELETE RESTRICT,
  kind               TEXT NOT NULL CHECK (kind IN ('crib', 'beds', 'other')),
  description        TEXT NOT NULL CHECK (length(btrim(description)) BETWEEN 2 AND 500),
  due_at             TIMESTAMPTZ NOT NULL,             -- fecha y hora límite para tenerla lista
  responsible_id     UUID REFERENCES public.team_members(id),
  status             TEXT NOT NULL DEFAULT 'registered'
                       CHECK (status IN ('registered', 'notified', 'ready', 'cancelled')),
  notified_at        TIMESTAMPTZ,                      -- se avisó (a limpieza, al edificio…)
  notified_note      TEXT,                             -- a quién y por dónde
  ready_at           TIMESTAMPTZ,                      -- preparación terminada y confirmada
  ready_by           UUID REFERENCES public.team_members(id),
  ready_confirmation TEXT,
  cancel_reason      TEXT,
  review_reason      TEXT,
  created_by         UUID NOT NULL REFERENCES public.team_members(id),
  updated_by         UUID REFERENCES public.team_members(id),
  updated_via        TEXT NOT NULL DEFAULT 'app' CHECK (updated_via IN ('app', 'mcp', 'system')),
  version            INT NOT NULL DEFAULT 1,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT request_notified_needs_when CHECK (status <> 'notified' OR notified_at IS NOT NULL),
  CONSTRAINT request_ready_needs_proof CHECK (
    status <> 'ready' OR (ready_at IS NOT NULL AND ready_by IS NOT NULL
                          AND length(btrim(coalesce(ready_confirmation, ''))) > 0)),
  CONSTRAINT request_cancel_needs_reason CHECK (
    status <> 'cancelled' OR length(btrim(coalesce(cancel_reason, ''))) > 0),
  CONSTRAINT request_actor CHECK (updated_via = 'system' OR updated_by IS NOT NULL)
);
CREATE UNIQUE INDEX special_requests_no_dup_kind
  ON public.special_requests (reservation_id, kind) WHERE status <> 'cancelled' AND kind <> 'other';
CREATE UNIQUE INDEX special_requests_no_dup_other
  ON public.special_requests (reservation_id, lower(btrim(description))) WHERE status <> 'cancelled' AND kind = 'other';
CREATE INDEX special_requests_open_due ON public.special_requests (due_at) WHERE status IN ('registered', 'notified');

-- ── Historial ───────────────────────────────────────────────────────────────
CREATE TABLE public.followup_history (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity         TEXT NOT NULL CHECK (entity IN ('charge', 'request')),
  entity_id      UUID NOT NULL,
  reservation_id UUID NOT NULL,
  action         TEXT NOT NULL CHECK (action IN ('insert', 'update')),
  before         JSONB,
  after          JSONB NOT NULL,
  actor_id       UUID,
  via            TEXT NOT NULL,
  at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX followup_history_entity ON public.followup_history (entity_id, at);

-- Antes de escribir: apartamento tomado de la reserva, campos fijos, estados finales, versión.
CREATE OR REPLACE FUNCTION public.followup_before_write() RETURNS trigger
  LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  terminal text[] := CASE TG_TABLE_NAME WHEN 'reservation_charges' THEN ARRAY['collected', 'void']
                                        ELSE ARRAY['ready', 'cancelled'] END;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT property_id INTO NEW.property_id FROM public.reservations WHERE id = NEW.reservation_id;
    NEW.version := 1;
    NEW.updated_by := coalesce(NEW.updated_by, NEW.created_by);
    NEW.created_at := now();
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  -- 'system' solo lo pone el trigger de reservas; un escritor que no dice quién es no pasa.
  IF NEW.updated_via = 'system' AND pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'AIRADMIN_ACTOR: indica updated_by y updated_via (app o mcp)' USING ERRCODE = 'check_violation';
  END IF;
  -- Quien no es admin (limpieza, mantenimiento) solo avisa o confirma una solicitud.
  IF auth.uid() IS NOT NULL AND NOT public.airadmin_is_admin() AND (
       TG_TABLE_NAME <> 'special_requests' OR NEW.status NOT IN ('notified', 'ready')
       OR (to_jsonb(NEW) - ARRAY['status', 'notified_at', 'notified_note', 'ready_at', 'ready_by',
                                 'ready_confirmation', 'updated_by', 'updated_via', 'version', 'updated_at'])
          IS DISTINCT FROM
          (to_jsonb(OLD) - ARRAY['status', 'notified_at', 'notified_note', 'ready_at', 'ready_by',
                                 'ready_confirmation', 'updated_by', 'updated_via', 'version', 'updated_at'])) THEN
    RAISE EXCEPTION 'AIRADMIN_FORBIDDEN: solo un administrador cambia eso' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.reservation_id <> OLD.reservation_id OR NEW.created_by <> OLD.created_by
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'AIRADMIN_IMMUTABLE: no se cambia la reserva ni el autor de un registro' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.property_id <> OLD.property_id AND NEW.updated_via <> 'system' THEN
    RAISE EXCEPTION 'AIRADMIN_IMMUTABLE: el apartamento sale de la reserva' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = ANY (terminal) AND (
       NEW.status <> OLD.status
       OR (TG_TABLE_NAME = 'reservation_charges'
           AND (to_jsonb(NEW) ->> 'amount', to_jsonb(NEW) ->> 'concept', to_jsonb(NEW) ->> 'due_date')
               IS DISTINCT FROM (to_jsonb(OLD) ->> 'amount', to_jsonb(OLD) ->> 'concept', to_jsonb(OLD) ->> 'due_date'))) THEN
    RAISE EXCEPTION 'AIRADMIN_FINAL: % ya está en estado final (%)', TG_TABLE_NAME, OLD.status USING ERRCODE = 'check_violation';
  END IF;
  IF TG_TABLE_NAME = 'special_requests' AND OLD.status = 'notified' AND NEW.status = 'registered' THEN
    RAISE EXCEPTION 'AIRADMIN_FINAL: una solicitud avisada no vuelve a registrada' USING ERRCODE = 'check_violation';
  END IF;
  NEW.version := OLD.version + 1;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.followup_log() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.followup_history (entity, entity_id, reservation_id, action, before, after, actor_id, via)
  VALUES (CASE TG_TABLE_NAME WHEN 'reservation_charges' THEN 'charge' ELSE 'request' END,
          NEW.id, NEW.reservation_id, lower(TG_OP),
          CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) END, to_jsonb(NEW),
          NEW.updated_by, NEW.updated_via);
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.followup_no_delete() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'AIRADMIN_NO_DELETE: % no se borra; anúlalo o cancélalo', TG_TABLE_NAME USING ERRCODE = 'check_violation';
END $$;

CREATE TRIGGER reservation_charges_before BEFORE INSERT OR UPDATE ON public.reservation_charges
  FOR EACH ROW EXECUTE FUNCTION public.followup_before_write();
CREATE TRIGGER reservation_charges_log AFTER INSERT OR UPDATE ON public.reservation_charges
  FOR EACH ROW EXECUTE FUNCTION public.followup_log();
CREATE TRIGGER reservation_charges_no_delete BEFORE DELETE ON public.reservation_charges
  FOR EACH ROW EXECUTE FUNCTION public.followup_no_delete();
CREATE TRIGGER special_requests_before BEFORE INSERT OR UPDATE ON public.special_requests
  FOR EACH ROW EXECUTE FUNCTION public.followup_before_write();
CREATE TRIGGER special_requests_log AFTER INSERT OR UPDATE ON public.special_requests
  FOR EACH ROW EXECUTE FUNCTION public.followup_log();
CREATE TRIGGER special_requests_no_delete BEFORE DELETE ON public.special_requests
  FOR EACH ROW EXECUTE FUNCTION public.followup_no_delete();

-- Si la reserva cambia de fechas, de apartamento o se cancela: lo abierto queda para revisar.
CREATE OR REPLACE FUNCTION public.reservation_followups_review() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  reason text;
BEGIN
  IF NEW.status = 'cancelled' AND OLD.status <> 'cancelled' THEN
    reason := format('La reserva se canceló el %s', to_char(now() AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD'));
  ELSIF NEW.check_in <> OLD.check_in OR NEW.check_out <> OLD.check_out OR NEW.property_id <> OLD.property_id THEN
    reason := format('La reserva cambió de %s→%s a %s→%s', OLD.check_in, OLD.check_out, NEW.check_in, NEW.check_out)
      || CASE WHEN NEW.property_id <> OLD.property_id THEN ' y de apartamento' ELSE '' END;
  ELSE
    RETURN NULL;
  END IF;
  UPDATE public.reservation_charges
     SET review_reason = reason, updated_via = 'system', updated_by = NULL, property_id = NEW.property_id
   WHERE reservation_id = NEW.id AND status = 'pending';
  UPDATE public.special_requests
     SET review_reason = reason, updated_via = 'system', updated_by = NULL, property_id = NEW.property_id
   WHERE reservation_id = NEW.id AND status IN ('registered', 'notified');
  RETURN NULL;
END $$;

CREATE TRIGGER reservation_followups_review AFTER UPDATE OF check_in, check_out, status, property_id
  ON public.reservations FOR EACH ROW EXECUTE FUNCTION public.reservation_followups_review();

-- ── Permisos ────────────────────────────────────────────────────────────────
-- Cobros: solo administradores (son plata). Solicitudes: todo el equipo las ve y puede avisarlas o
-- confirmarlas (limpieza instala la cuna); crearlas o cancelarlas queda en la app para admin.
ALTER TABLE public.reservation_charges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.special_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.followup_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin manages charges" ON public.reservation_charges FOR ALL TO authenticated
  USING (public.airadmin_is_admin()) WITH CHECK (public.airadmin_is_admin());

CREATE POLICY "team reads requests" ON public.special_requests FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.team_members WHERE id = auth.uid() AND active));
CREATE POLICY "admin creates requests" ON public.special_requests FOR INSERT TO authenticated
  WITH CHECK (public.airadmin_is_admin() AND created_by = auth.uid());
CREATE POLICY "team updates requests" ON public.special_requests FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.team_members WHERE id = auth.uid() AND active))
  WITH CHECK (updated_by = auth.uid() AND updated_via = 'app');

CREATE POLICY "admin reads history" ON public.followup_history FOR SELECT TO authenticated
  USING (public.airadmin_is_admin());

REVOKE ALL ON public.reservation_charges, public.special_requests, public.followup_history FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON public.reservation_charges, public.special_requests TO authenticated, service_role;
GRANT SELECT ON public.followup_history TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.airadmin_is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.airadmin_is_admin() TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';
