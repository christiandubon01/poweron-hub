/**
 * ndaService.ts
 * NDA signing service for PowerOn Hub.
 *
 * STUB — In the external prototype all Supabase calls are no-ops.
 * Replace the stub bodies with real @supabase/supabase-js calls during V2 integration.
 *
 * Supabase table required:
 *   signed_agreements (
 *     id              uuid primary key default uuid_generate_v4(),
 *     user_id         uuid not null references auth.users(id),
 *     agreement_type  text not null default 'nda_beta_v1',
 *     signature_image text,          -- base64 PNG data URL
 *     typed_name      text not null,
 *     ip_address      text,
 *     signed_at       timestamptz not null default now(),
 *     pdf_url         text           -- Supabase Storage public URL
 *   );
 *
 * Supabase Storage bucket required: nda-documents (private)
 */

import { syncToSupabase, fetchFromSupabase } from './supabaseService';
import { supabase } from '@/lib/supabase';

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
}

export interface NDASubmission {
  userId: string;
  signatureBase64: string;
  typedName: string;
  ipAddress: string;
}

// ─── NDA Text ─────────────────────────────────────────────────────────────────

export const NDA_AGREEMENT_VERSION = 'nda_beta_v1';

export const NDA_FULL_TEXT = `NON-DISCLOSURE AND BETA TESTING AGREEMENT

Effective Date: Upon electronic execution by the User

This Non-Disclosure and Beta Testing Agreement ("Agreement") is entered into between PowerOn Hub, LLC ("Company") and the individual signing below ("User" or "Beta Tester").

1. PURPOSE AND SCOPE
The Company is developing a proprietary software platform known as PowerOn Hub (the "Software"). The User has been invited to participate in a closed beta testing program (the "Beta Program") to evaluate the Software and provide feedback. This Agreement governs the User's access to and use of the Software during the Beta Program.

2. CONFIDENTIAL INFORMATION
For purposes of this Agreement, "Confidential Information" means all non-public information disclosed by the Company to the User, whether in written, oral, electronic, or any other form, including without limitation: (a) the Software, including its source code, object code, architecture, design, features, and functionality; (b) all documentation, specifications, user interfaces, technical information, trade secrets, and business information related to the Software; (c) any bugs, errors, or defects identified during testing; (d) any business plans, product roadmaps, financial data, or proprietary processes disclosed in connection with the Beta Program; and (e) any information designated as confidential or that reasonably should be understood to be confidential given the nature of the disclosure.

3. OBLIGATIONS OF THE BETA TESTER
The User agrees to: (a) hold all Confidential Information in strict confidence using no less than the same degree of care used to protect the User's own confidential information, but in no event less than reasonable care; (b) not disclose, share, publish, broadcast, or otherwise make available any Confidential Information to any third party without the prior written consent of the Company; (c) use the Confidential Information solely for the purpose of participating in the Beta Program and providing feedback to the Company; (d) not reproduce, copy, reverse engineer, disassemble, decompile, or attempt to derive the source code of the Software except as expressly authorized; (e) not use the Software for commercial purposes, in a production environment, or for any purpose other than beta testing; (f) promptly notify the Company of any unauthorized disclosure or use of Confidential Information; and (g) comply with all applicable laws and regulations in connection with the User's use of the Software.

4. FEEDBACK AND INTELLECTUAL PROPERTY
The User agrees that any feedback, suggestions, ideas, reports, evaluations, or other information provided to the Company concerning the Software ("Feedback") shall be the exclusive property of the Company. The User hereby assigns to the Company all rights, title, and interest in and to any Feedback, including all intellectual property rights therein. The User waives any moral rights in the Feedback to the maximum extent permitted by applicable law.

5. NO WARRANTIES; ACCEPTANCE OF RISK
THE SOFTWARE IS PROVIDED "AS IS" IN BETA FORM AND MAY CONTAIN BUGS, ERRORS, AND OTHER ISSUES. THE COMPANY MAKES NO WARRANTIES, EXPRESS OR IMPLIED, INCLUDING WITHOUT LIMITATION WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, OR NON-INFRINGEMENT. THE USER ACKNOWLEDGES THAT BETA SOFTWARE MAY BE UNSTABLE AND AGREES TO USE IT AT THE USER'S OWN RISK. THE USER IS RESPONSIBLE FOR MAINTAINING BACKUP COPIES OF ALL DATA AND FOR TAKING ALL REASONABLE PRECAUTIONS.

6. LIMITATION OF LIABILITY
TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, IN NO EVENT SHALL THE COMPANY BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING WITHOUT LIMITATION LOSS OF PROFITS, DATA, USE, OR GOODWILL, ARISING OUT OF OR RELATED TO THIS AGREEMENT OR THE USER'S USE OF THE SOFTWARE, EVEN IF THE COMPANY HAS BEEN ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.

7. TERM AND TERMINATION
This Agreement shall commence on the date of execution and continue until the earlier of: (a) the Company's public release of the Software; (b) the Company's written notice of termination to the User; or (c) the User's written notice of withdrawal from the Beta Program. Sections 2, 3, 4, 5, 6, 8, and 9 shall survive termination of this Agreement. Upon termination, the User shall immediately cease using the Software and destroy or return all copies of Confidential Information in the User's possession.

8. INJUNCTIVE RELIEF
The User acknowledges that any breach of this Agreement may cause irreparable harm to the Company for which monetary damages would be an inadequate remedy. Accordingly, the Company shall be entitled to seek injunctive or other equitable relief without the requirement of posting a bond or other security.

9. GENERAL PROVISIONS
(a) Governing Law. This Agreement shall be governed by and construed in accordance with the laws of the State of Texas, without regard to its conflict of law provisions. (b) Entire Agreement. This Agreement constitutes the entire agreement between the parties with respect to its subject matter and supersedes all prior agreements, understandings, and negotiations. (c) Amendment. This Agreement may not be amended except by a written instrument signed by both parties. (d) Waiver. Failure to enforce any provision of this Agreement shall not constitute a waiver of future enforcement of that or any other provision. (e) Severability. If any provision of this Agreement is found to be unenforceable, the remaining provisions shall continue in full force and effect. (f) No Assignment. The User may not assign this Agreement or any rights hereunder without the prior written consent of the Company. (g) Counterparts. This Agreement may be executed electronically, and electronic execution shall have the same legal effect as an original ink signature.

BY SIGNING BELOW, THE USER ACKNOWLEDGES THAT THE USER HAS READ, UNDERSTANDS, AND AGREES TO BE BOUND BY THE TERMS OF THIS AGREEMENT, AND THAT THE USER IS AUTHORIZED TO ENTER INTO THIS AGREEMENT.

PowerOn Hub, LLC
Beta Testing Program
`;

// ─── PDF Generation (stub) ────────────────────────────────────────────────────

/**
 * Generates a minimal PDF-like Blob containing the NDA text, signature, name,
 * date, and timestamp.
 *
 * In the external prototype this produces a plain-text pseudo-PDF blob for
 * structural completeness. Replace with jspdf or pdfmake during V2 integration.
 */
export async function generateNDAPdf(params: {
  typedName: string;
  signatureBase64: string;
  ipAddress: string;
  signedAt: string;
}): Promise<Blob> {
  // STUB — replace with real PDF library in V2 integration
  // Suggested: npm install jspdf @types/jspdf
  const content = [
    NDA_FULL_TEXT,
    '\n\n─────────────────────────────────────────────────────────',
    'EXECUTION PAGE',
    '─────────────────────────────────────────────────────────',
    `Signed by:    ${params.typedName}`,
    `Date:         ${new Date(params.signedAt).toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric',
    })}`,
    `Timestamp:    ${params.signedAt}`,
    `IP Address:   ${params.ipAddress}`,
    `Agreement:    ${NDA_AGREEMENT_VERSION}`,
    `Signature:    [Electronic signature image embedded — base64 PNG]`,
  ].join('\n');

  return new Blob([content], { type: 'application/pdf' });
}

// ─── Supabase Storage stub ────────────────────────────────────────────────────

async function uploadNDAPdf(_userId: string, _blob: Blob): Promise<string> {
  // STUB — replace with real Supabase Storage upload:
  // const { data, error } = await supabase.storage
  //   .from('nda-documents')
  //   .upload(`${_userId}/${Date.now()}_nda.pdf`, _blob, { contentType: 'application/pdf' });
  // if (error) throw error;
  // return supabase.storage.from('nda-documents').getPublicUrl(data.path).data.publicUrl;
  return `stub-pdf-url-${Date.now()}`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Saves a signed NDA record to Supabase and uploads the generated PDF.
 * Returns the stored record ID.
 */
export async function saveSignedNDA(
  userId: string,
  signatureBase64: string,
  typedName: string,
  ipAddress: string
): Promise<string> {
  const signedAt = new Date().toISOString();

  // Generate PDF blob
  const pdfBlob = await generateNDAPdf({
    typedName,
    signatureBase64,
    ipAddress,
    signedAt,
  });

  // Upload PDF to storage
  const pdfUrl = await uploadNDAPdf(userId, pdfBlob);

  const record: SignedAgreementRecord = {
    user_id: userId,
    agreement_type: NDA_AGREEMENT_VERSION,
    signature_image: signatureBase64,
    typed_name: typedName,
    ip_address: ipAddress,
    signed_at: signedAt,
    pdf_url: pdfUrl,
  };

  const result = await syncToSupabase({
    table: 'signed_agreements',
    data: record as unknown as Record<string, unknown>,
    operation: 'insert',
  });

  return (result.id as string) ?? `local-${Date.now()}`;
}

/**
 * Returns true if the user has a signed NDA on record.
 *
 * IMPORTANT: uses the Supabase auth.uid() directly — NOT the caller-supplied
 * userId — so the SELECT always queries with the same identifier that the
 * RLS-enforced INSERT stores in user_id.  Passing orgId (or any other app-level
 * identifier) would never match the row that saveSignedNDA() created.
 */
export async function hasUserSignedNDA(_userId: string): Promise<boolean> {
  // Resolve the Supabase auth UID — this is what saveSignedNDA() stores in user_id.
  const { data: { user } } = await (supabase as any).auth.getUser();
  const authUid = user?.id ?? _userId; // fall back to caller value if no active session

  const records = await fetchFromSupabase<SignedAgreementRecord>(
    'signed_agreements',
    { user_id: authUid, agreement_type: NDA_AGREEMENT_VERSION }
  );
  return records.length > 0;
}

/**
 * Fetches all signed NDA records for a given user (used in GUARDIAN viewer).
 */
export async function getUserSignedNDAs(userId: string): Promise<SignedAgreementRecord[]> {
  return fetchFromSupabase<SignedAgreementRecord>('signed_agreements', {
    user_id: userId,
  });
}
