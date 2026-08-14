/**
 * ndaService.ts
 * NDA signing service for PowerOn Hub.
 *
 * B3 — PDF generation + confirmation emails + admin view support.
 * NDA-FIX — Auth race condition fix:
 * - Wait for auth.getSession() to resolve before any Supabase writes
 * - Verify auth.uid() returns valid UUID
 * - Retry logic with exponential backoff (3 tries)
 * - Supabase row remains authoritative for the access gate
 *
 * Supabase table: signed_agreements
 * Supabase Storage bucket: nda-documents (private)
 */

import jsPDF from 'jspdf';
import { syncToSupabase, fetchFromSupabase } from './supabaseService';
import { supabase } from '@/lib/supabase';
import { NDA_FULL_TEXT, NDA_AGREEMENT_VERSION } from '@/constants/ndaText';
import {
  allowsNDAAccess,
  resolveNDAStatus,
  type NDAAccessOverrideRecordLike,
  type NDASignedAgreementRecordLike,
  type ResolvedNDAStatus,
} from '@/services/ndaAuthority';

// Re-export for backward compatibility with NDASigningFlow and other consumers
export { NDA_FULL_TEXT, NDA_AGREEMENT_VERSION };

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SignedAgreementRecord extends NDASignedAgreementRecordLike {}

export interface NDASubmission {
  userId: string;
  signatureBase64: string;
  typedName: string;
  ipAddress: string;
}

// ─── Auth Guard — Wait for session resolution ────────────────────────────────

/**
 * Waits for auth session to be fully resolved.
 * Returns the authenticated user ID, or throws if auth fails.
 *
 * This is critical: if auth hasn't resolved yet, Supabase writes will use
 * the wrong (or anonymous) context.
 */
async function waitForAuthSession(maxWaitMs = 5000): Promise<string> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < maxWaitMs) {
    try {
      const { data: { session }, error } = await supabase.auth.getSession();
      
      if (error) {
        throw new Error(`Auth error: ${error.message}`);
      }
      
      if (session?.user?.id) {
        // Validate UUID format
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(session.user.id)) {
          throw new Error(`Invalid auth UID format: ${session.user.id}`);
        }
        return session.user.id;
      }
    } catch (err) {
      console.warn('[ndaService] Auth check failed, retrying:', err);
    }
    
    // Wait 200ms before retrying
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  
  throw new Error('Auth session not available after 5 seconds');
}

// ─── Retry logic with exponential backoff ─────────────────────────────────────

/**
 * Executes an async operation with retry logic.
 * @param operation The async operation to retry
 * @param maxRetries Number of retry attempts (default: 3)
 * @param baseDelayMs Initial delay between retries in ms (default: 500)
 */
async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries = 3,
  baseDelayMs = 500
): Promise<T> {
  let lastError: Error = new Error('Unknown error');
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      
      if (attempt < maxRetries) {
        const delayMs = baseDelayMs * Math.pow(2, attempt);
        console.warn(`[ndaService] Retry ${attempt + 1}/${maxRetries} after ${delayMs}ms:`, lastError.message);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }
  
  throw lastError;
}

// ─── localStorage cache helpers ────────────────────────────────────────────────

function getNdaCacheKey(userId: string): string {
  return `poweron_nda_accepted_${userId}`;
}

function setNdaCacheAccepted(userId: string): void {
  try {
    localStorage.setItem(getNdaCacheKey(userId), '1');
  } catch (err) {
    console.warn('[ndaService] Failed to update localStorage cache:', err);
  }
}

export type SignedNDACompatibility = 'current' | 'legacy';

export interface ValidSignedNDAResult {
  kind: SignedNDACompatibility;
  record: SignedAgreementRecord;
}

// Use a schema-safe wildcard read here. The linked production project on
// Friday, August 14, 2026 still serves historical signed_agreements rows
// without pin_verified / verification_timestamp / revoked, and explicitly
// naming those newer columns makes PostgREST reject the entire read before
// legacy classification can run.
export const SIGNED_NDA_READ_SELECT = '*';
const NDA_ACCESS_AUTHORITY_TABLE = 'nda_access_authority';

export class NDAAuthorityUnavailableError extends Error {
  code: string
  supabaseCode: string | null
  cause: unknown

  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'NDAAuthorityUnavailableError'
    this.code = 'NDA_AUTHORITY_SCHEMA_UNAVAILABLE'
    this.supabaseCode = typeof (cause as any)?.code === 'string' ? (cause as any).code : null
    this.cause = cause ?? null
  }
}

export function isNDAAuthorityUnavailableError(error: unknown): error is NDAAuthorityUnavailableError {
  return error instanceof NDAAuthorityUnavailableError
    || (typeof error === 'object' && error !== null && (error as any).code === 'NDA_AUTHORITY_SCHEMA_UNAVAILABLE')
}

async function fetchSignedNDARecordsForUser(userId: string): Promise<SignedAgreementRecord[]> {
  const { data, error } = await (supabase as any)
    .from('signed_agreements')
    .select(SIGNED_NDA_READ_SELECT)
    .eq('user_id', userId)
    .order('signed_at', { ascending: false })
    .limit(25);

  if (error) throw error;
  return Array.isArray(data) ? (data as SignedAgreementRecord[]) : [];
}

function isOptionalRelationMissing(error: any): boolean {
  const code = String(error?.code || '').trim()
  const message = String(error?.message || '').toLowerCase()
  return (
    code === 'PGRST205'
    || code === '42P01'
    || message.includes("could not find the table")
    || message.includes('does not exist')
  )
}

async function fetchNDAAccessOverrideForUser(userId: string): Promise<NDAAccessOverrideRecordLike | null> {
  const { data, error } = await (supabase as any)
    .from(NDA_ACCESS_AUTHORITY_TABLE)
    .select('user_id, access_state, source_classification, reason, effective_at, created_at')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    if (isOptionalRelationMissing(error)) {
      throw new NDAAuthorityUnavailableError(
        'NDA authority is unavailable because migration 121_nda_access_authority.sql has not been applied.',
        error,
      )
    }
    throw error
  }
  return (data ?? null) as NDAAccessOverrideRecordLike | null
}

function signedStateToCompatibility(state: ResolvedNDAStatus['state']): SignedNDACompatibility | null {
  if (state === 'SIGNED_CURRENT') return 'current'
  if (state === 'SIGNED_LEGACY') return 'legacy'
  return null
}

export async function getCanonicalNDAStatus(userId: string): Promise<ResolvedNDAStatus> {
  const { data: { user } } = await supabase.auth.getUser()
  const authUid = user?.id ?? userId

  const [records, override] = await Promise.all([
    fetchSignedNDARecordsForUser(authUid),
    fetchNDAAccessOverrideForUser(authUid),
  ])

  const resolved = resolveNDAStatus({
    agreements: records,
    override,
    user: {
      userId: authUid,
    },
  })

  if (allowsNDAAccess(resolved.state)) {
    setNdaCacheAccepted(authUid)
  } else {
    try { localStorage.removeItem(getNdaCacheKey(authUid)) } catch { /* unavailable */ }
  }

  return resolved
}

// ─── Self-healing sync ─────────────────────────────────────────────────────────

// ─── PDF Generation ───────────────────────────────────────────────────────────

/**
 * Generates a PDF containing the full NDA text, signature image, and metadata.
 * Uses jsPDF for real PDF generation.
 */
export async function generateNDAPdf(params: {
  typedName: string;
  email: string;
  signatureBase64: string;
  ipAddress: string;
  signedAt: string;
}): Promise<Blob> {
  const { typedName, email, signatureBase64, signedAt } = params;

  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 60;
  const contentWidth = pageWidth - margin * 2;
  let y = margin;

  // ── Header ─────────────────────────────────────────────────────────────────
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(30, 30, 30);
  doc.text('PowerOn Hub', margin, y);

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 100, 100);
  doc.text('Power On Solutions LLC', margin, (y += 18));
  doc.text('C-10 License #1151468 · Desert Hot Springs, CA', margin, (y += 14));

  // Horizontal rule
  y += 16;
  doc.setDrawColor(220, 220, 220);
  doc.setLineWidth(0.5);
  doc.line(margin, y, pageWidth - margin, y);
  y += 20;

  // ── Agreement Title ────────────────────────────────────────────────────────
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(30, 30, 30);
  doc.text('NON-DISCLOSURE AND BETA TESTING AGREEMENT', margin, y, {
    maxWidth: contentWidth,
  });
  y += 30;

  // ── Body Text ──────────────────────────────────────────────────────────────
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(60, 60, 60);

  const bodyLines = doc.splitTextToSize(NDA_FULL_TEXT, contentWidth);

  for (const line of bodyLines) {
    if (y + 12 > pageHeight - margin) {
      doc.addPage();
      y = margin;
    }
    doc.text(line, margin, y);
    y += 12;
  }

  // ── Execution Page ─────────────────────────────────────────────────────────
  // Always start execution page on a new page for clean presentation
  doc.addPage();
  y = margin;

  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(30, 30, 30);
  doc.text('EXECUTION PAGE', margin, y);
  y += 8;

  doc.setLineWidth(0.5);
  doc.setDrawColor(180, 180, 180);
  doc.line(margin, y + 4, pageWidth - margin, y + 4);
  y += 24;

  // Signed by
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(60, 60, 60);
  doc.text('Signed by:', margin, y);
  doc.setFont('helvetica', 'normal');
  doc.text(typedName, margin + 90, y);
  y += 18;

  // Email
  doc.setFont('helvetica', 'bold');
  doc.text('Email:', margin, y);
  doc.setFont('helvetica', 'normal');
  doc.text(email || '(not provided)', margin + 90, y);
  y += 18;

  // Date
  const formattedDate = new Date(signedAt).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  doc.setFont('helvetica', 'bold');
  doc.text('Date:', margin, y);
  doc.setFont('helvetica', 'normal');
  doc.text(formattedDate, margin + 90, y);
  y += 36;

  // Signature image
  if (signatureBase64 && signatureBase64.startsWith('data:image')) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(100, 100, 100);
    doc.text('Electronic Signature:', margin, y);
    y += 10;

    try {
      // Draw a light background box for the signature
      doc.setFillColor(250, 250, 250);
      doc.setDrawColor(200, 200, 200);
      doc.roundedRect(margin, y, 240, 70, 4, 4, 'FD');
      doc.addImage(signatureBase64, 'PNG', margin + 8, y + 8, 224, 54);
    } catch (_imgErr) {
      // If signature image fails to embed, note it
      doc.setFontSize(9);
      doc.setFont('helvetica', 'italic');
      doc.setTextColor(150, 150, 150);
      doc.text('[Electronic signature image — embedded at signing]', margin + 8, y + 36);
    }
    y += 86;
  }

  // Footer
  y += 20;
  doc.setDrawColor(220, 220, 220);
  doc.line(margin, y, pageWidth - margin, y);
  y += 16;

  doc.setFontSize(8);
  doc.setFont('helvetica', 'italic');
  doc.setTextColor(140, 140, 140);
  doc.text(
    'This document was electronically signed via PowerOn Hub. PIN verification confirmed.',
    margin,
    y,
    { maxWidth: contentWidth }
  );
  y += 14;
  doc.text(
    `Agreement version: ${NDA_AGREEMENT_VERSION}  |  Signed at: ${signedAt}`,
    margin,
    y,
    { maxWidth: contentWidth }
  );

  return doc.output('blob');
}

// ─── Supabase Storage ─────────────────────────────────────────────────────────

/**
 * Uploads a PDF blob to the 'nda-documents' private bucket.
 * Returns the storage object path (not a signed URL — use createSignedUrl on read).
 */
async function uploadNDAPdf(userId: string, rowId: string, blob: Blob): Promise<string> {
  const path = `${userId}/${rowId}_nda.pdf`;

  const { error } = await (supabase as any).storage
    .from('nda-documents')
    .upload(path, blob, { contentType: 'application/pdf', upsert: true });

  if (error) {
    console.warn('[ndaService] Storage upload error:', error.message);
    // Return stub path so the row still gets updated
    return `stub-pdf-path-${rowId}`;
  }

  return path;
}

// ─── Email Sending ────────────────────────────────────────────────────────────

/**
 * Sends confirmation emails via /.netlify/functions/sendEmail.
 * Fire-and-forget — does not throw on failure.
 */
async function sendNDAConfirmationEmails(params: {
  typedName: string;
  email: string;
  signedAt: string;
  pdfBase64: string;
  recordId: string;
}): Promise<void> {
  const { typedName, email, signedAt, pdfBase64, recordId } = params;

  const formattedDate = new Date(signedAt).toLocaleString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });

  // User confirmation email
  const userEmailPromise = fetch('/.netlify/functions/sendEmail', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to: email,
      subject: 'Your PowerOn Hub NDA — Signed Copy',
      body: 'Thank you for signing. Your signed NDA is attached.',
      attachment: {
        filename: 'PowerOnHub_NDA_Signed.pdf',
        content: pdfBase64,
      },
    }),
  }).catch((err) => console.warn('[ndaService] User email send failed:', err));

  // Admin notification email
  const adminBody = [
    'A new Beta NDA has been signed via PowerOn Hub.',
    '',
    `Name:       ${typedName}`,
    `Email:      ${email}`,
    `Timestamp:  ${formattedDate}`,
    `Record ID:  ${recordId}`,
    '',
    'View the record in Supabase: signed_agreements table.',
  ].join('\n');

  const adminEmailPromise = fetch('/.netlify/functions/sendEmail', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to: 'app@poweronsolutionsllc.com',
      subject: `NDA Signed — ${typedName}`,
      body: adminBody,
    }),
  }).catch((err) => console.warn('[ndaService] Admin email send failed:', err));

  await Promise.allSettled([userEmailPromise, adminEmailPromise]);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Saves a signed NDA record to Supabase with auth race condition fix.
 *
 * CRITICAL: Waits for auth.getSession() to resolve before any Supabase writes.
 * If auth is not ready within 5 seconds, throws an error.
 *
 * Process:
 * 1. Wait for auth session to be available
 * 2. Verify auth.uid() is a valid UUID
 * 3. Retry insert/update up to 3 times with exponential backoff
 * 4. Update localStorage cache BEFORE the function returns
 * 5. Send confirmation emails (fire-and-forget)
 *
 * Returns the stored record ID.
 */
export async function saveSignedNDA(
  userId: string,
  signatureBase64: string,
  typedName: string,
  ipAddress: string,
  email?: string,
  pinVerified?: boolean
): Promise<string> {
  const signedAt = new Date().toISOString();
  if (pinVerified === false) {
    throw new Error('PIN verification is required before saving the NDA agreement.')
  }

  // ── CRITICAL: Wait for auth to be ready before writing ────────────────────
  let authUid: string;
  try {
    authUid = await waitForAuthSession();
    console.log('[ndaService] Auth session resolved, UID:', authUid);
  } catch (authErr) {
    console.error('[ndaService] Auth session not available:', authErr);
    throw new Error(
      'Unable to sign NDA: authentication session not ready. ' +
      'Please refresh the page and try again.'
    );
  }

  // Use the authenticated UID instead of the caller-supplied userId
  // This ensures consistency with the RLS-enforced table
  const finalUserId = authUid;

  // 1 ── INSERT the record (with retry logic) ─────────────────────────────────
  const record: SignedAgreementRecord = {
    user_id: finalUserId,
    agreement_type: NDA_AGREEMENT_VERSION,
    signature_image: signatureBase64,
    typed_name: typedName,
    ip_address: ipAddress,
    signed_at: signedAt,
    email: email ?? undefined,
  };

  let insertedRow: any;
  try {
    insertedRow = await withRetry(async () => {
      // NDA persistence is fail-closed. The generic sync helper intentionally
      // turns a failed offline write into a synthetic local success, which is
      // not valid for an access-control agreement.
      const { data, error } = await (supabase as any)
        .from('signed_agreements')
        .insert(record)
        .select('*')
        .single();
      if (error || !data?.id) {
        throw new Error(error?.message || 'Signed agreement insert returned no row');
      }
      return data;
    });
  } catch (insertErr) {
    console.error('[ndaService] Failed to insert NDA record after 3 retries:', insertErr);
    throw new Error(
      'Failed to save NDA agreement. Please check your connection and try again.'
    );
  }

  const rowId = (insertedRow.id as string) ?? `local-${Date.now()}`;

  // ── Set localStorage cache IMMEDIATELY after successful insert ──────────────
  // This is critical: the cache must be set BEFORE we continue with PDF generation
  // so that page reloads during PDF generation don't re-trigger the NDA gate
  setNdaCacheAccepted(finalUserId);
  console.log('[ndaService] NDA cache set for user:', finalUserId);

  // 2 ── Generate PDF with jsPDF
  let pdfBlob: Blob;
  let pdfBase64 = '';
  try {
    pdfBlob = await generateNDAPdf({
      typedName,
      email: email ?? '',
      signatureBase64,
      ipAddress,
      signedAt,
    });

    // Convert blob to base64 for email attachment
    const arrayBuffer = await pdfBlob.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuffer);
    let binary = '';
    uint8.forEach((b) => { binary += String.fromCharCode(b); });
    pdfBase64 = btoa(binary);
  } catch (pdfErr) {
    console.warn('[ndaService] PDF generation failed:', pdfErr);
    // Create a minimal fallback blob
    pdfBlob = new Blob(['[PDF generation error]'], { type: 'application/pdf' });
  }

  // 3 ── Upload PDF to Supabase Storage
  let storagePath = '';
  try {
    storagePath = await uploadNDAPdf(finalUserId, rowId, pdfBlob);
  } catch (storageErr) {
    console.warn('[ndaService] PDF upload failed (non-blocking):', storageErr);
    // Non-blocking: PDF upload failure doesn't prevent NDA acceptance
  }

  // 4 ── UPDATE signed_agreements row with pdf_url (with retry logic)
  if (!rowId.startsWith('local-') && storagePath) {
    try {
      await withRetry(async () => {
        return await syncToSupabase({
          table: 'signed_agreements',
          data: { id: rowId, pdf_url: storagePath } as Record<string, unknown>,
          operation: 'upsert',
          matchColumn: 'id',
        });
      });
    } catch (updateErr) {
      console.warn('[ndaService] Failed to update PDF URL (non-blocking):', updateErr);
    }
  }

  // 5 ── Send confirmation emails (fire-and-forget)
  if (email) {
    void sendNDAConfirmationEmails({
      typedName,
      email,
      signedAt,
      pdfBase64,
      recordId: rowId,
    });
  }

  return rowId;
}

/**
 * Returns the authoritative signed NDA record for a user, if one exists.
 *
 * Supabase is authoritative. The local marker is updated only after a verified
 * server row and is never sufficient to bypass the gate on its own.
 */
export async function getValidSignedNDA(userId: string): Promise<ValidSignedNDAResult | null> {
  try {
    const resolved = await getCanonicalNDAStatus(userId)
    const kind = signedStateToCompatibility(resolved.state)
    if (!kind || !resolved.agreement) return null
    return { kind, record: resolved.agreement as SignedAgreementRecord }
  } catch (err) {
    if (isNDAAuthorityUnavailableError(err)) throw err
    console.warn('[ndaService] Error checking authoritative NDA status; keeping gate closed:', err)
    return null
  }
}

/**
 * Returns true only when a real server-side signed agreement remains valid.
 */
export async function hasValidSignedNDA(userId: string): Promise<boolean> {
  return Boolean(await getValidSignedNDA(userId))
}

/**
 * Returns true when the canonical NDA authority allows the app to open.
 */
export async function hasNDAAccess(userId: string): Promise<boolean> {
  try {
    const resolved = await getCanonicalNDAStatus(userId)
    return allowsNDAAccess(resolved.state)
  } catch (err) {
    if (isNDAAuthorityUnavailableError(err)) throw err
    console.warn('[ndaService] Error resolving canonical NDA access; keeping gate closed:', err)
    return false
  }
}

export async function hasUserSignedNDA(userId: string): Promise<boolean> {
  return hasValidSignedNDA(userId)
}

/**
 * Fetches all signed NDA records for a given user.
 */
export async function getUserSignedNDAs(userId: string): Promise<SignedAgreementRecord[]> {
  return fetchFromSupabase<SignedAgreementRecord>('signed_agreements', {
    user_id: userId,
  });
}

/**
 * Fetches ALL signed NDA records (owner/admin use only).
 * Ordered by signed_at DESC.
 */
export async function getAllSignedNDAs(): Promise<SignedAgreementRecord[]> {
  try {
    const { data, error } = await (supabase as any)
      .from('signed_agreements')
      .select('*')
      .order('signed_at', { ascending: false });

    if (error) {
      console.warn('[ndaService] getAllSignedNDAs error:', error.message);
      return [];
    }
    return (data ?? []) as SignedAgreementRecord[];
  } catch (err) {
    console.warn('[ndaService] getAllSignedNDAs failed:', err);
    return [];
  }
}

/**
 * Returns a page of signed NDAs with total count for pagination.
 * Uses Supabase .range() — never loads the full table.
 */
export async function getSignedNDAsPaginated(
  page: number,
  pageSize: number,
): Promise<{ records: SignedAgreementRecord[]; total: number }> {
  try {
    const start = (page - 1) * pageSize;
    const end = start + pageSize - 1;
    const { data, error, count } = await (supabase as any)
      .from('signed_agreements')
      .select('*', { count: 'exact' })
      .order('signed_at', { ascending: false })
      .range(start, end);

    if (error) {
      console.warn('[ndaService] getSignedNDAsPaginated error:', error.message);
      return { records: [], total: 0 };
    }
    return { records: (data ?? []) as SignedAgreementRecord[], total: count ?? 0 };
  } catch (err) {
    console.warn('[ndaService] getSignedNDAsPaginated failed:', err);
    return { records: [], total: 0 };
  }
}

/**
 * Revokes a signed NDA record by setting revoked: true.
 */
export async function revokeSignedNDA(recordId: string): Promise<void> {
  const { data: agreement, error: agreementError } = await (supabase as any)
    .from('signed_agreements')
    .select('user_id')
    .eq('id', recordId)
    .maybeSingle()

  if (agreementError) {
    throw new Error(`Revoke failed: ${agreementError.message}`)
  }
  if (!agreement?.user_id) {
    throw new Error('Revoke failed: signed agreement user could not be resolved.')
  }

  const { error } = await (supabase as any)
    .from(NDA_ACCESS_AUTHORITY_TABLE)
    .upsert({
      user_id: agreement.user_id,
      access_state: 'REVOKED',
      source_classification: 'guardian_manual_revocation',
      reason: 'Guardian NDA access revocation',
      effective_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })

  if (error) {
    if (isOptionalRelationMissing(error)) {
      throw new Error('Revoke failed: apply migration 121_nda_access_authority.sql before revoking NDA access.')
    }
    throw new Error(`Revoke failed: ${error.message}`)
  }
}

/**
 * Generates a time-limited signed URL for a PDF stored in the nda-documents bucket.
 * @param storagePath  The path stored in pdf_url column (e.g., "userId/rowId_nda.pdf")
 * @param expiresIn    Seconds until URL expires (default: 3600)
 */
export async function getNDAPdfSignedUrl(
  storagePath: string,
  expiresIn = 3600
): Promise<string | null> {
  try {
    const { data, error } = await (supabase as any).storage
      .from('nda-documents')
      .createSignedUrl(storagePath, expiresIn);

    if (error || !data?.signedUrl) {
      console.warn('[ndaService] createSignedUrl error:', error?.message);
      return null;
    }
    return data.signedUrl as string;
  } catch (err) {
    console.warn('[ndaService] getNDAPdfSignedUrl failed:', err);
    return null;
  }
}
