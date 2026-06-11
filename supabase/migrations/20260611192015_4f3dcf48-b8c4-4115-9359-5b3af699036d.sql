CREATE TABLE public.workflow_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  inputs jsonb NOT NULL,
  lists jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.workflow_history TO authenticated;
GRANT ALL ON public.workflow_history TO service_role;

ALTER TABLE public.workflow_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own workflow history"
  ON public.workflow_history FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all workflow history"
  ON public.workflow_history FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Users can insert own workflow history"
  ON public.workflow_history FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own workflow history"
  ON public.workflow_history FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own workflow history"
  ON public.workflow_history FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX workflow_history_user_id_created_at_idx
  ON public.workflow_history (user_id, created_at DESC);

CREATE TRIGGER update_workflow_history_updated_at
  BEFORE UPDATE ON public.workflow_history
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();