import React, { useState } from 'react';
import { Phone, Mail, CheckCircle2, AlertCircle } from 'lucide-react';

export interface ServiceFormData {
  serviceType: 'service-call' | 'maintenance' | 'residential' | 'commercial' | 'solar' | null;
  issue?: string;
  address?: string;
  photos?: File[];
  urgency?: 'routine' | 'soon' | 'emergency';
  propertyType?: string;
  squareFeet?: number;
  panelAge?: number;
  unitCount?: number;
  projectType?: string;
  scope?: string;
  timeline?: string;
  buildingType?: string;
  hasDrawings?: boolean;
  roofType?: string;
  utilityProvider?: string;
  monthlyBill?: number;
  interestedInBattery?: boolean;
}

export function CustomerPortal() {
  const [selectedService, setSelectedService] = useState<string | null>(null);
  const [formData, setFormData] = useState<ServiceFormData>({
    serviceType: null,
  });
  const [submitted, setSubmitted] = useState(false);

  const serviceTypes = [
    {
      id: 'service-call',
      title: 'Service Call',
      description: 'Quick fixes and troubleshooting',
      icon: '🔧',
    },
    {
      id: 'maintenance',
      title: 'Maintenance Contract',
      description: 'Ongoing system maintenance',
      icon: '📋',
    },
    {
      id: 'residential',
      title: 'Residential Project',
      description: 'Rewiring, upgrades, and renovations',
      icon: '🏠',
    },
    {
      id: 'commercial',
      title: 'Commercial Project',
      description: 'Building systems and installations',
      icon: '🏢',
    },
    {
      id: 'solar',
      title: 'Solar Installation',
      description: 'Solar and battery systems',
      icon: '☀️',
    },
  ];

  const handleServiceSelect = (serviceId: string) => {
    setSelectedService(serviceId);
    setFormData({
      ...formData,
      serviceType: serviceId as ServiceFormData['serviceType'],
    });
  };

  const handleInputChange = (field: string, value: any) => {
    setFormData({
      ...formData,
      [field]: value,
    });
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    setFormData({
      ...formData,
      photos: [...(formData.photos || []), ...files],
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // In a real app, this would submit to a backend
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white">
        {/* Header */}
        <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
          <div className="max-w-4xl mx-auto px-4 py-4 sm:px-6 lg:px-8">
            <div className="flex items-center gap-3">
              <img
                src="https://via.placeholder.com/40"
                alt="Power On Solutions LLC"
                className="h-10 w-10"
              />
              <div>
                <h1 className="text-lg font-bold text-gray-900">Power On Solutions LLC</h1>
                <p className="text-xs text-gray-600">License C-10 #1151468</p>
              </div>
            </div>
          </div>
        </div>

        {/* Success Message */}
        <div className="max-w-4xl mx-auto px-4 py-16 sm:px-6 lg:px-8">
          <div className="text-center">
            <CheckCircle2 className="mx-auto h-16 w-16 text-green-600 mb-4" />
            <h2 className="text-3xl font-bold text-gray-900 mb-4">Thank You!</h2>
            <p className="text-lg text-gray-600 mb-8">
              Your service request has been submitted successfully.
            </p>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mb-8 text-left">
              <h3 className="font-semibold text-gray-900 mb-4">What to expect next:</h3>
              <ul className="space-y-3">
                <li className="flex gap-3">
                  <span className="text-blue-600 font-bold flex-shrink-0">1</span>
                  <span className="text-gray-700">
                    <strong>Confirmation:</strong> You'll receive a confirmation email with your request number
                  </span>
                </li>
                <li className="flex gap-3">
                  <span className="text-blue-600 font-bold flex-shrink-0">2</span>
                  <span className="text-gray-700">
                    <strong>Review:</strong> Our team will review your request within 24 hours
                  </span>
                </li>
                <li className="flex gap-3">
                  <span className="text-blue-600 font-bold flex-shrink-0">3</span>
                  <span className="text-gray-700">
                    <strong>Contact:</strong> We'll call or email to schedule and answer questions
                  </span>
                </li>
              </ul>
            </div>

            <div className="bg-white rounded-lg border border-gray-200 p-6 mb-8">
              <p className="text-gray-700 mb-4">
                <strong>Request Number:</strong> <span className="font-mono text-lg">RQ-20260410-{Math.floor(Math.random() * 10000)}</span>
              </p>
              <p className="text-sm text-gray-600 mb-2">
                <strong>Estimated Response:</strong> Within 24 business hours
              </p>
              <a
                href="https://recovery.poweron.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:text-blue-700 text-sm font-medium"
              >
                Verify our license →
              </a>
            </div>

            <div className="flex gap-4 justify-center flex-wrap">
              <a
                href="tel:+15559999999"
                className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700"
              >
                <Phone className="h-5 w-5" />
                Call Us
              </a>
              <a
                href="mailto:hello@poweronsolutions.com"
                className="inline-flex items-center gap-2 px-6 py-3 bg-white text-gray-900 border border-gray-300 rounded-lg font-semibold hover:bg-gray-50"
              >
                <Mail className="h-5 w-5" />
                Email Us
              </a>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <img
              src="https://via.placeholder.com/40"
              alt="Power On Solutions LLC"
              className="h-10 w-10"
            />
            <div>
              <h1 className="text-lg font-bold text-gray-900">Power On Solutions LLC</h1>
              <p className="text-xs text-gray-600">License C-10 #1151468</p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-4xl mx-auto px-4 py-12 sm:px-6 lg:px-8">
        <div className="mb-12">
          <h2 className="text-3xl font-bold text-gray-900 mb-2">How can we help?</h2>
          <p className="text-lg text-gray-600">
            Tell us about your electrical needs and we'll connect you with a licensed expert.
          </p>
        </div>

        {!selectedService ? (
          // Service Type Selection
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            {serviceTypes.map((service) => (
              <button
                key={service.id}
                onClick={() => handleServiceSelect(service.id)}
                className="p-6 bg-white border border-gray-200 rounded-lg hover:border-blue-500 hover:shadow-md transition-all text-left group"
              >
                <div className="text-4xl mb-2">{service.icon}</div>
                <h3 className="font-semibold text-gray-900 group-hover:text-blue-600 mb-1">
                  {service.title}
                </h3>
                <p className="text-sm text-gray-600">{service.description}</p>
              </button>
            ))}
          </div>
        ) : (
          // Form for selected service
          <form onSubmit={handleSubmit} className="bg-white rounded-lg border border-gray-200 p-8">
            <div className="mb-8">
              <button
                type="button"
                onClick={() => {
                  setSelectedService(null);
                  setFormData({ serviceType: null });
                }}
                className="text-blue-600 hover:text-blue-700 text-sm font-medium mb-4"
              >
                ← Back to service types
              </button>

              <h3 className="text-2xl font-bold text-gray-900">
                {serviceTypes.find((s) => s.id === selectedService)?.title}
              </h3>
            </div>

            {/* Service Call Form */}
            {selectedService === 'service-call' && (
              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-2">
                    What's the issue? *
                  </label>
                  <textarea
                    value={formData.issue || ''}
                    onChange={(e) => handleInputChange('issue', e.target.value)}
                    placeholder="Describe the problem..."
                    required
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    rows={4}
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-2">
                    Address *
                  </label>
                  <input
                    type="text"
                    value={formData.address || ''}
                    onChange={(e) => handleInputChange('address', e.target.value)}
                    placeholder="123 Main St, City, CA"
                    required
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-2">
                    Upload photos (optional)
                  </label>
                  <input
                    type="file"
                    multiple
                    accept="image/*"
                    onChange={handlePhotoUpload}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  {formData.photos && formData.photos.length > 0 && (
                    <p className="text-sm text-gray-600 mt-2">
                      {formData.photos.length} photo(s) selected
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-2">
                    How urgently do you need this? *
                  </label>
                  <select
                    value={formData.urgency || ''}
                    onChange={(e) => handleInputChange('urgency', e.target.value)}
                    required
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="">Select urgency...</option>
                    <option value="routine">Routine (can wait)</option>
                    <option value="soon">Soon (within a week)</option>
                    <option value="emergency">Emergency (today)</option>
                  </select>
                </div>
              </div>
            )}

            {/* Maintenance Contract Form */}
            {selectedService === 'maintenance' && (
              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-2">
                    Property Type *
                  </label>
                  <select
                    value={formData.propertyType || ''}
                    onChange={(e) => handleInputChange('propertyType', e.target.value)}
                    required
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="">Select property type...</option>
                    <option value="residential">Residential</option>
                    <option value="commercial">Commercial</option>
                    <option value="industrial">Industrial</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-2">
                    Square Footage
                  </label>
                  <input
                    type="number"
                    value={formData.squareFeet || ''}
                    onChange={(e) => handleInputChange('squareFeet', parseInt(e.target.value))}
                    placeholder="Approx. square feet"
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-2">
                    Electrical Panel Age (years)
                  </label>
                  <input
                    type="number"
                    value={formData.panelAge || ''}
                    onChange={(e) => handleInputChange('panelAge', parseInt(e.target.value))}
                    placeholder="Approx. age"
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-2">
                    Number of Units (if multi-family)
                  </label>
                  <input
                    type="number"
                    value={formData.unitCount || ''}
                    onChange={(e) => handleInputChange('unitCount', parseInt(e.target.value))}
                    placeholder="Number of units"
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              </div>
            )}

            {/* Residential Project Form */}
            {selectedService === 'residential' && (
              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-2">
                    Project Type *
                  </label>
                  <select
                    value={formData.projectType || ''}
                    onChange={(e) => handleInputChange('projectType', e.target.value)}
                    required
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="">Select project type...</option>
                    <option value="new-construction">New Construction</option>
                    <option value="panel-upgrade">Panel Upgrade</option>
                    <option value="rewiring">Rewiring</option>
                    <option value="kitchen-bath">Kitchen/Bath Remodel</option>
                    <option value="addition">Addition</option>
                    <option value="other">Other</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-2">
                    Scope of Work *
                  </label>
                  <textarea
                    value={formData.scope || ''}
                    onChange={(e) => handleInputChange('scope', e.target.value)}
                    placeholder="Describe what needs to be done..."
                    required
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    rows={4}
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-2">
                    Timeline *
                  </label>
                  <select
                    value={formData.timeline || ''}
                    onChange={(e) => handleInputChange('timeline', e.target.value)}
                    required
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="">Select timeline...</option>
                    <option value="asap">ASAP</option>
                    <option value="this-month">This month</option>
                    <option value="this-quarter">This quarter</option>
                    <option value="flexible">Flexible</option>
                  </select>
                </div>
              </div>
            )}

            {/* Commercial Project Form */}
            {selectedService === 'commercial' && (
              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-2">
                    Building Type *
                  </label>
                  <select
                    value={formData.buildingType || ''}
                    onChange={(e) => handleInputChange('buildingType', e.target.value)}
                    required
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="">Select building type...</option>
                    <option value="office">Office</option>
                    <option value="retail">Retail</option>
                    <option value="industrial">Industrial</option>
                    <option value="healthcare">Healthcare</option>
                    <option value="educational">Educational</option>
                    <option value="other">Other</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-2">
                    Square Footage
                  </label>
                  <input
                    type="number"
                    value={formData.squareFeet || ''}
                    onChange={(e) => handleInputChange('squareFeet', parseInt(e.target.value))}
                    placeholder="Square feet"
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-2">
                    Scope of Work *
                  </label>
                  <textarea
                    value={formData.scope || ''}
                    onChange={(e) => handleInputChange('scope', e.target.value)}
                    placeholder="Describe the project scope..."
                    required
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    rows={4}
                  />
                </div>

                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id="hasDrawings"
                    checked={formData.hasDrawings || false}
                    onChange={(e) => handleInputChange('hasDrawings', e.target.checked)}
                    className="h-5 w-5 text-blue-600 rounded"
                  />
                  <label htmlFor="hasDrawings" className="text-sm text-gray-700">
                    I have drawings/plans to share
                  </label>
                </div>
              </div>
            )}

            {/* Solar Installation Form - will use SolarCalculator internally */}
            {selectedService === 'solar' && (
              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-2">
                    Roof Type
                  </label>
                  <select
                    value={formData.roofType || ''}
                    onChange={(e) => handleInputChange('roofType', e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="">Select roof type...</option>
                    <option value="asphalt">Asphalt shingles</option>
                    <option value="metal">Metal</option>
                    <option value="tile">Tile</option>
                    <option value="concrete">Concrete</option>
                    <option value="flat">Flat roof</option>
                    <option value="other">Other</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-2">
                    Utility Provider
                  </label>
                  <input
                    type="text"
                    value={formData.utilityProvider || ''}
                    onChange={(e) => handleInputChange('utilityProvider', e.target.value)}
                    placeholder="e.g., PG&E, SDGE, etc."
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-2">
                    Average Monthly Electric Bill ($) *
                  </label>
                  <input
                    type="number"
                    value={formData.monthlyBill || ''}
                    onChange={(e) => handleInputChange('monthlyBill', parseFloat(e.target.value))}
                    placeholder="e.g., 150"
                    required
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>

                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id="battery"
                    checked={formData.interestedInBattery || false}
                    onChange={(e) => handleInputChange('interestedInBattery', e.target.checked)}
                    className="h-5 w-5 text-blue-600 rounded"
                  />
                  <label htmlFor="battery" className="text-sm text-gray-700">
                    Interested in battery backup?
                  </label>
                </div>
              </div>
            )}

            {/* Submit Button */}
            <div className="mt-8 flex gap-4">
              <button
                type="submit"
                className="flex-1 px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition-colors"
              >
                Submit Request
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelectedService(null);
                  setFormData({ serviceType: null });
                }}
                className="px-6 py-3 bg-gray-100 text-gray-900 font-semibold rounded-lg hover:bg-gray-200 transition-colors"
              >
                Back
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Footer */}
      <div className="bg-gray-50 border-t border-gray-200 py-8 mt-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 gap-8 mb-8">
            <div>
              <h3 className="font-semibold text-gray-900 mb-2">License Verification</h3>
              <p className="text-sm text-gray-600 mb-2">C-10 #1151468</p>
              <a
                href="https://recovery.poweron.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:text-blue-700 text-sm font-medium"
              >
                Verify license on CSLB website →
              </a>
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 mb-2">Contact Us</h3>
              <a href="tel:+15559999999" className="text-sm text-blue-600 hover:text-blue-700 block mb-2">
                (555) 999-9999
              </a>
              <a
                href="mailto:hello@poweronsolutions.com"
                className="text-sm text-blue-600 hover:text-blue-700"
              >
                hello@poweronsolutions.com
              </a>
            </div>
          </div>
          <p className="text-xs text-gray-500">
            Power On Solutions LLC is a fully licensed, bonded electrical contractor serving California.
          </p>
        </div>
      </div>
    </div>
  );
}

export default CustomerPortal;
