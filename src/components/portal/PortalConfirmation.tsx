import React from 'react';
import { CheckCircle2, Clock, Shield, Phone, Mail, Link as LinkIcon } from 'lucide-react';

export interface ConfirmationData {
  confirmationNumber?: string;
  serviceType?: string;
  estimatedResponseHours?: number;
  licenseNumber?: string;
}

export function PortalConfirmation({
  confirmationNumber = `RQ-${new Date().toISOString().split('T')[0].replace(/-/g, '')}-${Math.floor(Math.random() * 10000)}`,
  serviceType = 'Service Request',
  estimatedResponseHours = 24,
  licenseNumber = 'C-10 #1151468',
}: ConfirmationData) {
  const steps = [
    {
      number: 1,
      title: 'Confirmation Sent',
      description: "You'll receive a confirmation email with your request details and reference number",
      icon: '📧',
    },
    {
      number: 2,
      title: 'Expert Review',
      description: `Our team will review your request within ${estimatedResponseHours} business hours`,
      icon: '👀',
    },
    {
      number: 3,
      title: 'Contact You',
      description: "We'll call or email to discuss your needs, answer questions, and schedule if appropriate",
      icon: '📞',
    },
    {
      number: 4,
      title: 'Get Started',
      description: 'Once scheduled, we pull permits, coordinate inspections, and complete the work on time',
      icon: '🔧',
    },
  ];

  const credentials = [
    {
      icon: <Shield className="h-6 w-6" />,
      title: 'Licensed',
      description: 'California C-10 Electrical Contractor',
      detail: licenseNumber,
    },
    {
      icon: <Shield className="h-6 w-6" />,
      title: 'Bonded & Insured',
      description: 'General Liability & Workers Comp',
      detail: 'Coverage verified',
    },
    {
      icon: <Shield className="h-6 w-6" />,
      title: 'Permit Pulling',
      description: 'We handle all city/county permits',
      detail: '100% compliant',
    },
  ];

  return (
    <div className="w-full max-w-4xl mx-auto">
      {/* Success Header */}
      <div className="text-center mb-12">
        <div className="flex justify-center mb-4">
          <CheckCircle2 className="h-16 w-16 text-green-600" />
        </div>
        <h1 className="text-4xl font-bold text-gray-900 mb-2">Request Submitted!</h1>
        <p className="text-xl text-gray-600">
          Thank you for choosing Power On Solutions. We're excited to help with your electrical needs.
        </p>
      </div>

      {/* Confirmation Details */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
        {/* Confirmation Number */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
          <div className="text-xs font-semibold text-blue-900 uppercase tracking-widest mb-2">
            Confirmation Number
          </div>
          <p className="text-2xl font-mono font-bold text-gray-900 mb-2">{confirmationNumber}</p>
          <p className="text-xs text-gray-600">Save this number for your records</p>
        </div>

        {/* Service Type */}
        <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-6">
          <div className="text-xs font-semibold text-indigo-900 uppercase tracking-widest mb-2">
            Service Type
          </div>
          <p className="text-lg font-semibold text-gray-900 mb-2">{serviceType}</p>
          <p className="text-xs text-gray-600">From your intake form</p>
        </div>

        {/* Response Window */}
        <div className="bg-green-50 border border-green-200 rounded-lg p-6">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="h-4 w-4 text-green-600" />
            <div className="text-xs font-semibold text-green-900 uppercase tracking-widest">
              Response Window
            </div>
          </div>
          <p className="text-lg font-semibold text-gray-900 mb-2">Within {estimatedResponseHours} Hours</p>
          <p className="text-xs text-gray-600">Business hours only</p>
        </div>
      </div>

      {/* Timeline / What to Expect */}
      <div className="mb-12">
        <h2 className="text-2xl font-bold text-gray-900 mb-6">What to Expect Next</h2>
        <div className="space-y-4">
          {steps.map((step) => (
            <div key={step.number} className="flex gap-4">
              {/* Timeline dot */}
              <div className="flex flex-col items-center">
                <div className="h-12 w-12 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-lg flex-shrink-0">
                  {step.number}
                </div>
                {step.number < steps.length && (
                  <div className="w-0.5 h-12 bg-gray-300 my-2" />
                )}
              </div>

              {/* Content */}
              <div className="pb-4">
                <h3 className="text-lg font-semibold text-gray-900 mb-1">{step.title}</h3>
                <p className="text-gray-600">{step.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Credentials/Trust Section */}
      <div className="mb-12">
        <h2 className="text-2xl font-bold text-gray-900 mb-6">Our Credentials</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {credentials.map((cred, idx) => (
            <div key={idx} className="bg-white border border-gray-200 rounded-lg p-6">
              <div className="text-blue-600 mb-3">{cred.icon}</div>
              <h3 className="font-semibold text-gray-900 mb-1">{cred.title}</h3>
              <p className="text-sm text-gray-600 mb-2">{cred.description}</p>
              <p className="text-sm font-medium text-green-600">{cred.detail}</p>
            </div>
          ))}
        </div>

        {/* License Verification Link */}
        <div className="mt-6 bg-amber-50 border border-amber-200 rounded-lg p-4">
          <p className="text-sm text-gray-700 mb-3">
            Want to verify our license and credentials independently?
          </p>
          <a
            href="https://recovery.poweron.com"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-amber-300 rounded hover:bg-amber-50 transition-colors text-sm font-medium text-gray-900"
          >
            <LinkIcon className="h-4 w-4" />
            Visit License Verification Page
          </a>
        </div>
      </div>

      {/* Contact Section */}
      <div className="mb-12 bg-gray-50 border border-gray-200 rounded-lg p-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-6">Need to Reach Us?</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div>
            <div className="flex items-center gap-3 mb-3">
              <Phone className="h-5 w-5 text-blue-600" />
              <h3 className="font-semibold text-gray-900">Call</h3>
            </div>
            <a href="tel:+15559999999" className="text-lg font-bold text-blue-600 hover:text-blue-700 mb-1">
              (555) 999-9999
            </a>
            <p className="text-sm text-gray-600">Mon–Fri, 8am–5pm Pacific</p>
          </div>

          <div>
            <div className="flex items-center gap-3 mb-3">
              <Mail className="h-5 w-5 text-blue-600" />
              <h3 className="font-semibold text-gray-900">Email</h3>
            </div>
            <a
              href="mailto:hello@poweronsolutions.com"
              className="text-lg font-bold text-blue-600 hover:text-blue-700 mb-1"
            >
              hello@poweronsolutions.com
            </a>
            <p className="text-sm text-gray-600">We'll reply within 4 hours on business days</p>
          </div>
        </div>
      </div>

      {/* FAQ / Important Notes */}
      <div className="mb-12">
        <h2 className="text-2xl font-bold text-gray-900 mb-6">Important Information</h2>
        <div className="space-y-4">
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <h3 className="font-semibold text-gray-900 mb-2">Do you pull permits?</h3>
            <p className="text-sm text-gray-700">
              Yes, 100% of the time. Permits are not optional for electrical work in California. We pull all necessary
              permits, handle city/county fees, and coordinate inspections. Unpermitted work can fail home inspections
              and create safety hazards.
            </p>
          </div>

          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <h3 className="font-semibold text-gray-900 mb-2">What if my address is outside your service area?</h3>
            <p className="text-sm text-gray-700">
              We operate throughout most of California. If your address is outside our service area, we'll contact you
              to discuss options or refer you to a trusted partner contractor.
            </p>
          </div>

          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <h3 className="font-semibold text-gray-900 mb-2">How are you different?</h3>
            <p className="text-sm text-gray-700">
              We're 100% licensed and bonded. We pull permits on everything. We provide detailed warranties. We show
              up on time and communicate progress. We pride ourselves on doing the job right the first time, not just
              cheap.
            </p>
          </div>

          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <h3 className="font-semibold text-gray-900 mb-2">What happens if I don't hear from you?</h3>
            <p className="text-sm text-gray-700">
              Our goal is to contact you within {estimatedResponseHours} business hours. If you don't hear from us by
              then, please call (555) 999-9999 to confirm we received your request. Check your email spam folder, as
              some confirmation emails occasionally get filtered.
            </p>
          </div>
        </div>
      </div>

      {/* Call to Action */}
      <div className="text-center bg-blue-50 border border-blue-200 rounded-lg p-8">
        <p className="text-gray-700 mb-4">
          Questions about your request? We're here to help — no obligation.
        </p>
        <a
          href="tel:+15559999999"
          className="inline-flex items-center gap-2 px-8 py-3 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Phone className="h-5 w-5" />
          Call Now
        </a>
      </div>
    </div>
  );
}

export default PortalConfirmation;
