-- credential_id + public_key were bytea, but @supabase/supabase-js sends
-- Node Buffers to PostgREST as their JSON serialization
-- ({"type":"Buffer","data":[...]}), which then gets stored as literal
-- bytes of that JSON string. So inserts "worked" but the .eq() lookup
-- at /api/auth/passkey/signin/verify never matched anything — usernameless
-- sign-in was always broken.
--
-- Switching both columns to base64url-encoded TEXT round-trips cleanly
-- through PostgREST (strings are strings). Existing rows are unrecoverable,
-- so we truncate.

truncate table passkeys;

alter table passkeys drop column credential_id cascade;
alter table passkeys drop column public_key cascade;

alter table passkeys add column credential_id text not null unique;
alter table passkeys add column public_key text not null;
