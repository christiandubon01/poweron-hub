-- 051_role_hierarchy.sql
--
-- Migration to add role-based access control (RBAC) infrastructure
-- Supports owner, foreman, employee, and guest roles with organization-based access

BEGIN;

-- Create organization table if it doesn't exist
CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Add role column to user profiles if it doesn't exist
ALTER TABLE user_profiles 
ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'owner' 
  CHECK (role IN ('owner', 'foreman', 'employee', 'guest'));

-- Add organization_id to user profiles for team-based access control
ALTER TABLE user_profiles 
ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);

-- Create role_permissions table to track granular permissions
CREATE TABLE IF NOT EXISTS role_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role TEXT NOT NULL CHECK (role IN ('owner', 'foreman', 'employee', 'guest')),
  resource TEXT NOT NULL,
  can_view BOOLEAN DEFAULT FALSE,
  can_edit BOOLEAN DEFAULT FALSE,
  can_delete BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(role, resource)
);

-- Create audit log for role changes
CREATE TABLE IF NOT EXISTS role_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES user_profiles(id),
  old_role TEXT,
  new_role TEXT NOT NULL,
  changed_by UUID REFERENCES user_profiles(id),
  changed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  reason TEXT
);

-- Set up Row Level Security (RLS) for organization-based access

-- Enable RLS on organizations
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

-- RLS policy: Users can see their own organization
CREATE POLICY "Users can view their organization"
  ON organizations FOR SELECT
  USING (
    id IN (
      SELECT organization_id 
      FROM user_profiles 
      WHERE id = auth.uid()
    )
  );

-- RLS policy: Only owners can update organization
CREATE POLICY "Only owners can update organization"
  ON organizations FOR UPDATE
  USING (
    id IN (
      SELECT organization_id 
      FROM user_profiles 
      WHERE id = auth.uid() AND role = 'owner'
    )
  );

-- Enable RLS on user_profiles
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- RLS policy: Users can view profiles in their organization
CREATE POLICY "Users can view organization members"
  ON user_profiles FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id 
      FROM user_profiles 
      WHERE id = auth.uid()
    )
  );

-- RLS policy: Only owners can update roles
CREATE POLICY "Only owners can update user roles"
  ON user_profiles FOR UPDATE
  USING (
    (
      role = 'owner' AND
      organization_id IN (
        SELECT organization_id 
        FROM user_profiles 
        WHERE id = auth.uid()
      )
    ) OR (id = auth.uid()) -- Users can update their own non-role fields
  );

-- Enable RLS on role_permissions
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;

-- RLS policy: All authenticated users can view role permissions
CREATE POLICY "All users can view role permissions"
  ON role_permissions FOR SELECT
  USING (auth.role() = 'authenticated');

-- Enable RLS on role_audit_log
ALTER TABLE role_audit_log ENABLE ROW LEVEL SECURITY;

-- RLS policy: Users can view audit logs for their organization
CREATE POLICY "Users can view org audit logs"
  ON role_audit_log FOR SELECT
  USING (
    user_id IN (
      SELECT id 
      FROM user_profiles up
      WHERE up.organization_id IN (
        SELECT organization_id 
        FROM user_profiles 
        WHERE id = auth.uid()
      )
    )
  );

-- Insert default role permissions
INSERT INTO role_permissions (role, resource, can_view, can_edit, can_delete) VALUES
  -- Owner: full access
  ('owner', 'projects', true, true, true),
  ('owner', 'financial', true, true, true),
  ('owner', 'crew', true, true, true),
  ('owner', 'settings', true, true, true),
  ('owner', 'billing', true, true, true),
  ('owner', 'pricing', true, true, true),
  ('owner', 'field_logs', true, true, true),
  ('owner', 'tasks', true, true, true),
  ('owner', 'hours', true, true, true),
  ('owner', 'project_details', true, true, true),
  
  -- Foreman: crew, tasks, hours, field logs, project details
  ('foreman', 'projects', true, false, false),
  ('foreman', 'field_logs', true, true, true),
  ('foreman', 'tasks', true, true, true),
  ('foreman', 'hours', true, true, false),
  ('foreman', 'project_details', true, true, false),
  
  -- Employee: tasks and hours only
  ('employee', 'tasks', true, true, false),
  ('employee', 'hours', true, true, false),
  
  -- Guest: view-only for public data
  ('guest', 'projects', true, false, false);

-- Create function to log role changes
CREATE OR REPLACE FUNCTION log_role_change()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    INSERT INTO role_audit_log (user_id, old_role, new_role, changed_by, changed_at)
    VALUES (NEW.id, OLD.role, NEW.role, auth.uid(), CURRENT_TIMESTAMP);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger to log role changes
DROP TRIGGER IF EXISTS log_user_role_change ON user_profiles;
CREATE TRIGGER log_user_role_change
  AFTER UPDATE ON user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION log_role_change();

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_profiles_organization_id 
  ON user_profiles(organization_id);

CREATE INDEX IF NOT EXISTS idx_user_profiles_role 
  ON user_profiles(role);

CREATE INDEX IF NOT EXISTS idx_role_audit_log_user_id 
  ON role_audit_log(user_id);

CREATE INDEX IF NOT EXISTS idx_role_audit_log_changed_at 
  ON role_audit_log(changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_role_permissions_role 
  ON role_permissions(role);

COMMIT;
