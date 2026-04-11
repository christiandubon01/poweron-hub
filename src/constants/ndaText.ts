/**
 * ndaText.ts
 * Full NDA agreement text for PowerOn Hub Beta Testing Program.
 * Imported by ndaService.ts for PDF generation and display.
 *
 * NDA_VERSION — semantic version string. Bump this when the NDA text changes.
 * Users who accepted a previous version will be prompted to re-accept.
 * NDA_AGREEMENT_VERSION — the Supabase agreement_type key (includes version).
 * When bumping NDA_VERSION, update NDA_AGREEMENT_VERSION to match.
 */

// NDA-FIX: Added NDA_VERSION constant. Start at "1.0".
// To require re-acceptance: bump to "1.1", "2.0", etc. and update NDA_AGREEMENT_VERSION.
export const NDA_VERSION = '1.0';

// Supabase agreement_type stored in signed_agreements.agreement_type
// Format: nda_beta_v{NDA_VERSION} — preserves existing records from before this fix.
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
Beta Testing Program`;
