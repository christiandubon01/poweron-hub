/**
 * RoleGateWrapper.tsx
 * 
 * React component that gates content based on user role.
 * Displays children if user has sufficient role, otherwise shows access restricted message.
 */

import React from 'react';
import { UserRole, ROLE_HIERARCHY } from './RoleHierarchy';

interface RoleGateWrapperProps {
  /** The minimum role required to view the content */
  requiredRole: UserRole;
  /** The current user's role */
  userRole: UserRole;
  /** Content to display if user has sufficient role */
  children: React.ReactNode;
  /** Optional custom message when access is denied */
  deniedMessage?: string;
  /** Optional fallback UI when access is denied */
  fallback?: React.ReactNode;
  /** Optional className for the wrapper */
  className?: string;
}

/**
 * RoleGateWrapper Component
 * 
 * A simple wrapper component that checks if the user's role is >= the required role.
 * If yes, renders children. If no, renders a restricted message.
 * 
 * Role hierarchy: owner (4) > foreman (3) > employee (2) > guest (1)
 * 
 * @example
 * ```tsx
 * <RoleGateWrapper requiredRole="foreman" userRole={userRole}>
 *   <FinancialDashboard />
 * </RoleGateWrapper>
 * ```
 */
export const RoleGateWrapper: React.FC<RoleGateWrapperProps> = ({
  requiredRole,
  userRole,
  children,
  deniedMessage,
  fallback,
  className = '',
}) => {
  // Check if user role meets or exceeds required role
  const hasAccess = ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[requiredRole];

  if (hasAccess) {
    return <div className={className}>{children}</div>;
  }

  // Return custom fallback if provided
  if (fallback) {
    return <>{fallback}</>;
  }

  // Return default denied message
  const message =
    deniedMessage ||
    `Access restricted. This section requires ${requiredRole} role or higher.`;

  return (
    <div
      className={`flex items-center justify-center p-6 rounded-lg border-2 border-dashed border-red-300 bg-red-50 ${className}`}
      role="alert"
    >
      <div className="text-center">
        <svg
          className="mx-auto h-12 w-12 text-red-600 mb-3"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 9v2m0 4v2m0 6v2M7.5 9.75a3 3 0 116 0 3 3 0 01-6 0zm0 0a3 3 0 116 0m-3-3v-2a3 3 0 00-3 3v2m6-6v2a3 3 0 00-3 3v2"
          />
        </svg>
        <p className="text-sm font-medium text-red-800">{message}</p>
        <p className="text-xs text-red-600 mt-2">
          Your current role: <strong>{userRole}</strong> | Required: <strong>{requiredRole}</strong>
        </p>
      </div>
    </div>
  );
};

/**
 * Hook to check if current user has access to a resource
 * 
 * @param userRole - The current user's role
 * @param requiredRole - The required role for access
 * @returns true if user has access
 */
export function useRoleAccess(userRole: UserRole, requiredRole: UserRole): boolean {
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[requiredRole];
}

/**
 * Conditional render helper for role-based content
 * 
 * @param userRole - The current user's role
 * @param requiredRole - The required role for access
 * @param children - Content to render if access granted
 * @param fallback - Content to render if access denied
 * @returns Either children or fallback
 */
export function RoleGate({
  userRole,
  requiredRole,
  children,
  fallback = null,
}: {
  userRole: UserRole;
  requiredRole: UserRole;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}): React.ReactNode {
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[requiredRole] ? children : fallback;
}

/**
 * Conditional rendering for multiple panel roles
 * 
 * @param userRole - The current user's role
 * @param panelRoles - Record of panel IDs to their required roles
 * @param panelId - The panel ID to check
 * @returns true if user can access the panel
 */
export function canViewPanel(
  userRole: UserRole,
  panelRoles: Record<string, UserRole>,
  panelId: string
): boolean {
  const requiredRole = panelRoles[panelId];
  if (!requiredRole) return true; // Default to allowing access if no restriction defined
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[requiredRole];
}

export default RoleGateWrapper;
