/**
 * employeeRoutes.ts — canonical Employee Portal landing route (EMP-AUTH-1A).
 *
 * There is no dedicated `/employee/portal` path: `AuthenticatedRoot` renders
 * `EmployeePortal` at "/" once the auth state machine resolves role === 'employee'.
 * This module names that landing in ONE place so activation, normal employee
 * login, and already-accepted invitation handling all route identically — instead
 * of ambiguous inline `navigate('/')` calls scattered across the codebase.
 */

import type { NavigateFunction } from 'react-router-dom'

/** The authenticated Employee Portal landing route. */
export const EMPLOYEE_PORTAL_ROUTE = '/'

/**
 * Navigate to the Employee Portal, replacing history so the browser back button
 * does not return to the invite/login page after landing.
 */
export function goToEmployeePortal(navigate: NavigateFunction): void {
  navigate(EMPLOYEE_PORTAL_ROUTE, { replace: true })
}
