import React from 'react';
import { CheckCircle, Calendar, Phone, Mail, ExternalLink } from 'lucide-react';

interface PortalConfirmationProps {
  confirmationNumber: string;
  serviceType: string | null;
  onNewSubmission: () => void;
}

export function PortalConfirmation({
  confirmationNumber,
  serviceType,
  onNewSubmission,
}: PortalConfirmationProps) {
  const getServiceTitle = (type: string | null) => {
    switch (type) {
      case 'service-call':
        return 'Service Call';
      case 'maintenance':
        return 'Maintenance Contract';
      case 'residential':
        return 'Residential Project';
      case 'commercial':
        return 'Commercial Project';
      case 'solar':
        return 'Solar Installation';
      default:
        return 'Service Request';
    }
  };

  const getResponseTime = (type: string | null) => {
    switch (type) {
      case 'service-call':
        return '4-24 hours';
      case 'maintenance':
        return '1-2 business days';
      case 'solar':
        return '1-2 business days';
      default:
        return '1-3 business days';
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      {/* Success Card */}
      <div className="bg-white rounded-lg shadow-md p-12 text-center mb-8">
        <div className="mb-6 flex justify-center">
          <CheckCircle className="w-16 h-16 text-green-600" />
        </div>

        <h1 className="text-3xl font-bold text-slate-900 mb-2">Request Submitted Successfully!</h1>
        <p className="text-lg text-slate-600 mb-8">
          Thank you for choosing Power On Solutions. We look forward to helping you.
        </p>

        {/* Confirmation Number */}
        <div className="bg-slate-100 rounded-lg p-6 mb-8">
          <p className="text-sm text-slate-600 mb-2">Confirmation Number</p>
          <p className="text-3xl font-bold text-amber-600 font-mono">{confirmationNumber}</p>
          <p className="text-xs text-slate-600 mt-3">Save this number for your records</p>
        </div>

        {/* Service Details */}
        <div className="grid grid-cols-2 gap-6 mb-8 text-left">
          <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
            <p className="text-sm text-slate-600 font-medium mb-1">Service Type</p>
            <p className="text-lg font-bold text-slate-900">{getServiceTitle(serviceType)}</p>
          </div>

          <div className="bg-green-50 rounded-lg p-4 border border-green-200">
            <p className="text-sm text-slate-600 font-medium mb-1">Expected Response</p>
            <p className="text-lg font-bold text-slate-900">{getResponseTime(serviceType)}</p>
          </div>
        </div>

        {/* What to Expect */}
        <div className="bg-gradient-to-r from-slate-50 to-slate-100 rounded-lg p-6 mb-8 text-left">
          <h2 className="font-bold text-slate-900 mb-4 text-lg">What Happens Next</h2>

          <div className="space-y-4">
            <div className="flex gap-4">
              <div className="flex-shrink-0">
                <div className="flex items-center justify-center h-8 w-8 rounded-full bg-amber-600 text-white text-sm font-bold">
                  1
                </div>
              </div>
              <div>
                <h3 className="font-semibold text-slate-900">We Review Your Request</h3>
                <p className="text-sm text-slate-600 mt-1">
                  Our team will review your intake form and assess your project scope.
                </p>
              </div>
            </div>

            <div className="flex gap-4">
              <div className="flex-shrink-0">
                <div className="flex items-center justify-center h-8 w-8 rounded-full bg-amber-600 text-white text-sm font-bold">
                  2
                </div>
              </div>
              <div>
                <h3 className="font-semibold text-slate-900">Initial Contact</h3>
                <p className="text-sm text-slate-600 mt-1">
                  We'll call or email with initial questions and to schedule a site visit or consultation.
                </p>
              </div>
            </div>

            <div className="flex gap-4">
              <div className="flex-shrink-0">
                <div className="flex items-center justify-center h-8 w-8 rounded-full bg-amber-600 text-white text-sm font-bold">
                  3
                </div>
              </div>
              <div>
                <h3 className="font-semibold text-slate-900">Estimate & Planning</h3>
                <p className="text-sm text-slate-600 mt-1">
                  For projects, we'll provide a detailed estimate and walk through the scope and timeline.
                </p>
              </div>
            </div>

            <div className="flex gap-4">
              <div className="flex-shrink-0">
                <div className="flex items-center justify-center h-8 w-8 rounded-full bg-amber-600 text-white text-sm font-bold">
                  4
                </div>
              </div>
              <div>
                <h3 className="font-semibold text-slate-900">Execution</h3>
                <p className="text-sm text-slate-600 mt-1">
                  Once approved, we schedule the work and keep you updated throughout the process.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Contact Info */}
        <div className="border-t border-slate-200 pt-6">
          <h3 className="font-bold text-slate-900 mb-4">Get in Touch</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <a
              href="tel:+1234567890"
              className="flex items-center justify-center gap-2 p-3 bg-blue-50 hover:bg-blue-100 rounded-lg transition border border-blue-200"
            >
              <Phone className="w-5 h-5 text-blue-600" />
              <span className="text-sm font-medium text-slate-900">(123) 456-7890</span>
            </a>

            <a
              href="mailto:intake@poweronsolutions.com"
              className="flex items-center justify-center gap-2 p-3 bg-green-50 hover:bg-green-100 rounded-lg transition border border-green-200"
            >
              <Mail className="w-5 h-5 text-green-600" />
              <span className="text-sm font-medium text-slate-900">Email Us</span>
            </a>

            <a
              href="https://www.cslb.ca.gov/"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 p-3 bg-purple-50 hover:bg-purple-100 rounded-lg transition border border-purple-200"
            >
              <ExternalLink className="w-5 h-5 text-purple-600" />
              <span className="text-sm font-medium text-slate-900">Verify License</span>
            </a>
          </div>
        </div>
      </div>

      {/* Additional Info */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        {/* Confirmation Details */}
        <div className="bg-white rounded-lg shadow-md p-6 border-l-4 border-l-amber-600">
          <h3 className="font-bold text-slate-900 mb-4 flex items-center gap-2">
            <Calendar className="w-5 h-5 text-amber-600" />
            Confirmation Details
          </h3>
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-slate-600 font-medium">Confirmation #</dt>
              <dd className="text-slate-900 font-mono">{confirmationNumber}</dd>
            </div>
            <div>
              <dt className="text-slate-600 font-medium">Submitted</dt>
              <dd className="text-slate-900">{new Date().toLocaleDateString()} at {new Date().toLocaleTimeString()}</dd>
            </div>
            <div>
              <dt className="text-slate-600 font-medium">Status</dt>
              <dd className="text-green-600 font-semibold">Received & Under Review</dd>
            </div>
          </dl>
        </div>

        {/* Next Steps */}
        <div className="bg-white rounded-lg shadow-md p-6 border-l-4 border-l-green-600">
          <h3 className="font-bold text-slate-900 mb-4">Quick Reference</h3>
          <ul className="text-sm text-slate-700 space-y-2">
            <li className="flex gap-2">
              <span className="text-green-600 font-bold">✓</span>
              <span>Check your email for confirmation details</span>
            </li>
            <li className="flex gap-2">
              <span className="text-green-600 font-bold">✓</span>
              <span>We'll call within the response window above</span>
            </li>
            <li className="flex gap-2">
              <span className="text-green-600 font-bold">✓</span>
              <span>Save your confirmation number</span>
            </li>
            <li className="flex gap-2">
              <span className="text-green-600 font-bold">✓</span>
              <span>Questions? Contact us anytime</span>
            </li>
          </ul>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-4">
        <button
          type="button"
          onClick={onNewSubmission}
          className="flex-1 px-6 py-3 border border-slate-300 text-slate-900 font-medium rounded-lg hover:bg-slate-50 transition"
        >
          Submit Another Request
        </button>
        <a
          href="/"
          className="flex-1 px-6 py-3 bg-amber-600 text-white font-medium rounded-lg hover:bg-amber-700 transition flex items-center justify-center"
        >
          Return to Home
        </a>
      </div>

      {/* Legal Footer */}
      <div className="mt-8 p-4 bg-slate-100 rounded-lg text-center text-xs text-slate-600">
        <p>
          Power On Solutions LLC | C-10 License #1151468 | Bonded & Insured
        </p>
        <p className="mt-2">
          By submitting this form, you agree to be contacted by Power On Solutions regarding your service request.
        </p>
      </div>
    </div>
  );
}
