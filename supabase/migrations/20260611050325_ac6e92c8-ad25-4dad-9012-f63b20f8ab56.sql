
-- user_roles: explicit admin-only write policies (prevent privilege escalation)
CREATE POLICY "Admins can insert roles" ON public.user_roles
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins can update roles" ON public.user_roles
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins can delete roles" ON public.user_roles
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- spotify_connections: owner-scoped policies + admin read
CREATE POLICY "Users can view own spotify connection" ON public.spotify_connections
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all spotify connections" ON public.spotify_connections
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Users can insert own spotify connection" ON public.spotify_connections
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own spotify connection" ON public.spotify_connections
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own spotify connection" ON public.spotify_connections
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- Restrict SECURITY DEFINER helper functions: keep has_role callable (used in RLS),
-- revoke the rest from public/anon/authenticated so only service_role / triggers run them.
REVOKE ALL ON FUNCTION public.is_dj_approved(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;
