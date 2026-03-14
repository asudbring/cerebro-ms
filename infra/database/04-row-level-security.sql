-- Row Level Security policies.
--
-- In the Supabase version, RLS restricts access to the service_role.
-- On Azure Database for PostgreSQL, the model is different:
--   - Your Azure Function connects with a dedicated database user/role
--   - Network security (firewall rules, private endpoints) is the primary access control
--   - RLS is an additional defense-in-depth layer
--
-- This script creates an application role and restricts the thoughts table to it.
-- Adjust the role name and password to match your Azure Function connection string.

-- Create the application role (run as the admin user)
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'cerebro_app') THEN
        CREATE ROLE cerebro_app WITH LOGIN PASSWORD 'CHANGE_ME';
    END IF;
END
$$;

-- Grant access to the thoughts table
GRANT USAGE ON SCHEMA public TO cerebro_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON thoughts TO cerebro_app;

-- Enable RLS
ALTER TABLE thoughts ENABLE ROW LEVEL SECURITY;

-- Allow the app role full access
CREATE POLICY "App role full access"
    ON thoughts
    FOR ALL
    TO cerebro_app
    USING (true)
    WITH CHECK (true);

-- Deny all other roles by default (RLS is on, no policy = no access)
