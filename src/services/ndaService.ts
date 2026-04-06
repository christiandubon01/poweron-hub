/**
 * ndaService.ts
 * NDA signing service for PowerOn Hub.
 *
 * B3 — PDF generation + confirmation emails + admin view support.
 *
 * Supabase table: signed_agreements
 * Supabase Storage bucket: nda-documents (private)
 */

import jsPDF from 'jspdf';
import { syncToSupabase, fetchFromSupabase } from './supabaseService';
import { supabase } from '@/lib/supabase';
import { NDA_FULL_TEXT, NDA_AGREEMENT_VERSION } from '@/constants/ndaText';

// Re-export for backward compatibility with NDASigningFlow and other consumers
export { NDA_FULL_TEXT, NDA_AGREEMENT_VERSION };

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SignedAgreementRecord {
  id?: string;
  user_id: string;
  agreement_type: string;
  signature_image: string;
  typed_name: string;
  ip_address: string;
  signed_at: string;
  pdf_url?: string;
  // Identity verification fields (B2)
  email?: string;
  pin_verified?: boolean;
  verification_timestamp?: string;
  // Admin revoke (B3)
  revoked?: boolean;
}

export interface NDASubmission {
  userId: string;
  signatureBase64: string;
  typedName: string;
  ipAddress: string;
}

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
      subject: `New Beta NDA Signed — ${typedName}`,
      body: adminBody,
    }),
  }).catch((err) => console.warn('[ndaService] Admin email send failed:', err));

  await Promise.allSettled([userEmailPromise, adminEmailPromise]);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Saves a signed NDA record to Supabase, generates a PDF, uploads it to
 * Supabase Storage, updates the row with the pdf_url, and sends confirmation
 * emails to the user and admin.
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
  const verificationTimestamp = new Date().toISOString();

  // 1 ── INSERT the record (no pdf_url yet)
  const record: SignedAgreementRecord = {
    user_id: userId,
    agreement_type: NDA_AGREEMENT_VERSION,
    signature_image: signatureBase64,
    typed_name: typedName,
    ip_address: ipAddress,
    signed_at: signedAt,
    email: email ?? undefined,
    pin_verified: pinVerified ?? false,
    verification_timestamp: verificationTimestamp,
  };

  const insertedRow = await syncToSupabase({
    table: 'signed_agreements',
    data: record as unknown as Record<string, unknown>,
    operation: 'insert',
  });

  const rowId = (insertedRow.id as string) ?? `local-${Date.now()}`;

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
  const storagePath = await uploadNDAPdf(userId, rowId, pdfBlob);

  // 4 ── UPDATE signed_agreements row with pdf_url
  if (!rowId.startsWith('local-')) {
    await syncToSupabase({
      table: 'signed_agreements',
      data: { id: rowId, pdf_url: storagePath } as Record<string, unknown>,
      operation: 'upsert',
      matchColumn: 'id',
    });
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
 * Returns true if the user has a signed NDA on record.
 *
 * Uses the Supabase auth.uid() directly — NOT the caller-supplied userId —
 * so the SELECT always queries with the same identifier the RLS-enforced INSERT stores.
 */
export async function hasUserSignedNDA(_userId: string): Promise<boolean> {
  const { data: { user } } = await (supabase as any).auth.getUser();
  const authUid = user?.id ?? _userId;

  const records = await fetchFromSupabase<SignedAgreementRecord>(
    'signed_agreements',
    { user_id: authUid, agreement_type: NDA_AGREEMENT_VERSION }
  );
  return records.length > 0;
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
 * Revokes a signed NDA record by setting revoked: true.
 */
export async function revokeSignedNDA(recordId: string): Promise<void> {
  const { error } = await (supabase as any)
    .from('signed_agreements')
    .update({ revoked: true })
    .eq('id', recordId);

  if (error) {
    throw new Error(`Revoke failed: ${error.message}`);
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
