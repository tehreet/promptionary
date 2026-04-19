-- Promote an anonymous user in place so they can hold a passkey as their
-- sole credential. Called from /api/auth/passkey/register/verify when an
-- anon user finishes their first WebAuthn registration. The synthetic
-- email is never delivered — it exists so the magic-link session-mint
-- path on signin/verify has something to hand to admin.generateLink.
--
-- Flipping is_anonymous false→true here fires the existing
-- handle_user_promoted trigger, which auto-creates the profiles row from
-- the display name we stuff into raw_user_meta_data.full_name.

create or replace function promote_anon_for_passkey(
  p_user_id uuid,
  p_email text,
  p_display_name text
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if char_length(p_display_name) < 1 or char_length(p_display_name) > 24 then
    raise exception 'display_name must be 1-24 chars';
  end if;

  update auth.users
  set is_anonymous = false,
      email = p_email,
      email_confirmed_at = coalesce(email_confirmed_at, now()),
      raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
                           || jsonb_build_object('full_name', p_display_name)
  where id = p_user_id
    and coalesce(is_anonymous, false) = true;

  if not found then
    raise exception 'user not found or already promoted';
  end if;
end;
$$;
revoke all on function promote_anon_for_passkey(uuid, text, text) from public;
-- No grant to anon / authenticated — service role only.
