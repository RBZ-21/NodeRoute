-- Idempotency keys for driver offline queue replay (audit H7).

CREATE TABLE IF NOT EXISTS public.driver_client_actions (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       TEXT        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  client_action_id TEXT     NOT NULL,
  action_type   TEXT        NOT NULL,
  resource_id   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, client_action_id)
);

CREATE INDEX IF NOT EXISTS idx_driver_client_actions_user
  ON public.driver_client_actions(user_id, created_at DESC);

ALTER TABLE public.driver_client_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "driver_client_actions: service role only"
  ON public.driver_client_actions
  FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);
