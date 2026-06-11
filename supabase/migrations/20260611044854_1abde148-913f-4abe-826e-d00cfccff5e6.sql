-- Lock down SECURITY DEFINER functions
revoke execute on function public.has_role(uuid, public.app_role) from public, anon;
revoke execute on function public.is_dj_approved(uuid) from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.update_updated_at_column() from public, anon, authenticated;
-- has_role stays callable by authenticated (used inside RLS policies).
