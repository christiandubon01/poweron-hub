import React, { useState } from 'react';
import { FileText, Zap, Home, Building2, Sun, ArrowRight } from 'lucide-react';
import { SolarCalculator } from './SolarCalculator';
import { PortalEducation } from './PortalEducation';
import { PortalConfirmation } from './PortalConfirmation';

type ServiceType = 'service-call' | 'maintenance' | 'residential' | 'commercial' | 'solar' | null;
type FormStep = 'service-selection' | 'form' | 'education' | 'confirmation';

interface FormData {
  serviceType: ServiceType;
  issueDescription?: string;
  address?: string;
  urgency?: string;
  photoUrl?: string;
  propertyType?: string;
  squareFootage?: number;
  panelAge?: number;
  unitCount?: number;
  projectType?: string;
  scope?: string;
  timeline?: string;
  buildingType?: string;
  drawings?: boolean;
  roofType?: string;
  utilityProvider?: string;
  monthlyBill?: number;
  batteryInterest?: boolean;
  email?: string;
  phone?: string;
  name?: string;
  confirmationNumber?: string;
}

export function CustomerPortal() {
  const [currentStep, setCurrentStep] = useState<FormStep>('service-selection');
  const [selectedService, setSelectedService] = useState<ServiceType>(null);
  const [formData, setFormData] = useState<FormData>({
    serviceType: null,
  });

  const handleServiceSelect = (serviceType: ServiceType) => {
    setSelectedService(serviceType);
    setFormData({ ...formData, serviceType });
    setCurrentStep('form');
  };

  const handleFormSubmit = (data: Partial<FormData>) => {
    setFormData({ ...formData, ...data });
    setCurrentStep('education');
  };

  const handleEducationComplete = () => {
    // Generate confirmation number
    const confirmationNum = `POS-${Date.now().toString().slice(-8).toUpperCase()}`;
    setFormData({ ...formData, confirmationNumber: confirmationNum });
    setCurrentStep('confirmation');
  };

  const handleNewSubmission = () => {
    setCurrentStep('service-selection');
    setSelectedService(null);
    setFormData({ serviceType: null });
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-4xl mx-auto px-4 py-6 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-amber-500 rounded-lg flex items-center justify-center">
                <Zap className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-slate-900">Power On Solutions LLC</h1>
                <p className="text-sm text-slate-600">C-10 License #1151468</p>
              </div>
            </div>
            <a
              href="https://www.cslb.ca.gov/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-medium text-amber-600 hover:text-amber-700 underline"
            >
              Verify License
            </a>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-4 py-12 sm:px-6 lg:px-8">
        {currentStep === 'service-selection' && (
          <ServiceSelection onSelectService={handleServiceSelect} />
        )}

        {currentStep === 'form' && selectedService && (
          <ServiceForm
            serviceType={selectedService}
            onSubmit={handleFormSubmit}
            onBack={() => setCurrentStep('service-selection')}
          />
        )}

        {currentStep === 'education' && (
          <PortalEducation
            onComplete={handleEducationComplete}
            onBack={() => setCurrentStep('form')}
          />
        )}

        {currentStep === 'confirmation' && formData.confirmationNumber && (
          <PortalConfirmation
            confirmationNumber={formData.confirmationNumber}
            serviceType={selectedService}
            onNewSubmission={handleNewSubmission}
          />
        )}
      </main>

      {/* Footer */}
      <footer className="bg-slate-900 text-slate-300 py-8 mt-12">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center text-sm">
          <p>© 2026 Power On Solutions LLC. Licensed Electrical Contractor. All rights reserved.</p>
          <p className="mt-2">
            <a href="tel:+1234567890" className="hover:text-white">
              Call: (123) 456-7890
            </a>
            {' | '}
            <a href="mailto:intake@poweronsolutions.com" className="hover:text-white">
              Email: intake@poweronsolutions.com
            </a>
          </p>
        </div>
      </footer>
    </div>
  );
}

interface ServiceSelectionProps {
  onSelectService: (serviceType: ServiceType) => void;
}

function ServiceSelection({ onSelectService }: ServiceSelectionProps) {
  const services = [
    {
      id: 'service-call',
      title: 'Service Call',
      description: 'Report an electrical issue or emergency',
      icon: Zap,
      color: 'bg-red-50 hover:bg-red-100 border-red-200',
      iconColor: 'text-red-600',
    },
    {
      id: 'maintenance',
      title: 'Maintenance Contract',
      description: 'Schedule preventive electrical maintenance',
      icon: FileText,
      color: 'bg-blue-50 hover:bg-blue-100 border-blue-200',
      iconColor: 'text-blue-600',
    },
    {
      id: 'residential',
      title: 'Residential Project',
      description: 'Plan a home electrical upgrade or renovation',
      icon: Home,
      color: 'bg-green-50 hover:bg-green-100 border-green-200',
      iconColor: 'text-green-600',
    },
    {
      id: 'commercial',
      title: 'Commercial Project',
      description: 'Commercial electrical installation or upgrade',
      icon: Building2,
      color: 'bg-purple-50 hover:bg-purple-100 border-purple-200',
      iconColor: 'text-purple-600',
    },
    {
      id: 'solar',
      title: 'Solar Installation',
      description: 'Get a free solar feasibility assessment',
      icon: Sun,
      color: 'bg-amber-50 hover:bg-amber-100 border-amber-200',
      iconColor: 'text-amber-600',
    },
  ];

  return (
    <div className="text-center mb-12">
      <h2 className="text-3xl font-bold text-slate-900 mb-4">How can we help?</h2>
      <p className="text-lg text-slate-600 mb-12">
        Select the type of electrical service you need, and we'll guide you through a quick intake form.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        {services.map((service) => {
          const Icon = service.icon;
          return (
            <button
              key={service.id}
              onClick={() => onSelectService(service.id as ServiceType)}
              className={`p-6 rounded-lg border-2 transition-all cursor-pointer ${service.color}`}
            >
              <Icon className={`w-8 h-8 mx-auto mb-4 ${service.iconColor}`} />
              <h3 className="font-bold text-slate-900 mb-2 text-sm">{service.title}</h3>
              <p className="text-xs text-slate-600">{service.description}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface ServiceFormProps {
  serviceType: ServiceType;
  onSubmit: (data: Partial<FormData>) => void;
  onBack: () => void;
}

function ServiceForm({ serviceType, onSubmit, onBack }: ServiceFormProps) {
  const [formState, setFormState] = useState<Partial<FormData>>({});

  const handleChange = (field: string, value: string | number | boolean) => {
    setFormState({ ...formState, [field]: value });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formState);
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow-md p-8 max-w-2xl mx-auto">
      <button
        type="button"
        onClick={onBack}
        className="mb-6 text-sm font-medium text-slate-600 hover:text-slate-900 flex items-center gap-1"
      >
        ← Back
      </button>

      <h2 className="text-2xl font-bold text-slate-900 mb-6">
        {serviceType === 'service-call' && 'Report Service Issue'}
        {serviceType === 'maintenance' && 'Maintenance Contract Inquiry'}
        {serviceType === 'residential' && 'Residential Project Details'}
        {serviceType === 'commercial' && 'Commercial Project Details'}
        {serviceType === 'solar' && 'Solar Installation Intake'}
      </h2>

      <div className="space-y-6">
        {/* Common Contact Fields */}
        <div>
          <label className="block text-sm font-medium text-slate-900 mb-2">Name *</label>
          <input
            type="text"
            required
            value={formState.name || ''}
            onChange={(e) => handleChange('name', e.target.value)}
            className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
            placeholder="Your name"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-900 mb-2">Email *</label>
            <input
              type="email"
              required
              value={formState.email || ''}
              onChange={(e) => handleChange('email', e.target.value)}
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
              placeholder="your@email.com"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-900 mb-2">Phone *</label>
            <input
              type="tel"
              required
              value={formState.phone || ''}
              onChange={(e) => handleChange('phone', e.target.value)}
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
              placeholder="(123) 456-7890"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-900 mb-2">Service Address *</label>
          <input
            type="text"
            required
            value={formState.address || ''}
            onChange={(e) => handleChange('address', e.target.value)}
            className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
            placeholder="Street address"
          />
        </div>

        {/* Service-Specific Fields */}
        {serviceType === 'service-call' && (
          <>
            <div>
              <label className="block text-sm font-medium text-slate-900 mb-2">
                Issue Description *
              </label>
              <textarea
                required
                value={formState.issueDescription || ''}
                onChange={(e) => handleChange('issueDescription', e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent h-32"
                placeholder="Describe the electrical problem you're experiencing"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-900 mb-2">Urgency Level</label>
              <select
                value={formState.urgency || ''}
                onChange={(e) => handleChange('urgency', e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
              >
                <option value="">Select urgency...</option>
                <option value="emergency">Emergency (Today)</option>
                <option value="urgent">Urgent (This week)</option>
                <option value="soon">Soon (Next week)</option>
                <option value="flexible">Flexible</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-900 mb-2">
                Photo of Issue (Optional)
              </label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  if (e.target.files?.[0]) {
                    const reader = new FileReader();
                    reader.onload = (event) => {
                      handleChange('photoUrl', event.target?.result as string);
                    };
                    reader.readAsDataURL(e.target.files[0]);
                  }
                }}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
              />
            </div>
          </>
        )}

        {serviceType === 'maintenance' && (
          <>
            <div>
              <label className="block text-sm font-medium text-slate-900 mb-2">Property Type</label>
              <select
                value={formState.propertyType || ''}
                onChange={(e) => handleChange('propertyType', e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
              >
                <option value="">Select property type...</option>
                <option value="single-family">Single Family Home</option>
                <option value="multi-family">Multi-Family</option>
                <option value="commercial">Commercial</option>
                <option value="industrial">Industrial</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-900 mb-2">
                  Square Footage
                </label>
                <input
                  type="number"
                  value={formState.squareFootage || ''}
                  onChange={(e) => handleChange('squareFootage', e.target.value)}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                  placeholder="e.g., 3500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-900 mb-2">
                  Panel Age (years)
                </label>
                <input
                  type="number"
                  value={formState.panelAge || ''}
                  onChange={(e) => handleChange('panelAge', e.target.value)}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                  placeholder="e.g., 15"
                />
              </div>
            </div>
          </>
        )}

        {serviceType === 'residential' && (
          <>
            <div>
              <label className="block text-sm font-medium text-slate-900 mb-2">Project Type</label>
              <select
                value={formState.projectType || ''}
                onChange={(e) => handleChange('projectType', e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
              >
                <option value="">Select project type...</option>
                <option value="panel-upgrade">Panel Upgrade</option>
                <option value="rewiring">Rewiring</option>
                <option value="addition">Room Addition</option>
                <option value="renovation">Kitchen/Bath Renovation</option>
                <option value="ev-charger">EV Charger Installation</option>
                <option value="other">Other</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-900 mb-2">
                Scope of Work *
              </label>
              <textarea
                required
                value={formState.scope || ''}
                onChange={(e) => handleChange('scope', e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent h-32"
                placeholder="Describe what you'd like done"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-900 mb-2">
                Timeline / Schedule Preference
              </label>
              <input
                type="text"
                value={formState.timeline || ''}
                onChange={(e) => handleChange('timeline', e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                placeholder="e.g., Start in June, need completion by August"
              />
            </div>
          </>
        )}

        {serviceType === 'commercial' && (
          <>
            <div>
              <label className="block text-sm font-medium text-slate-900 mb-2">Building Type</label>
              <select
                value={formState.buildingType || ''}
                onChange={(e) => handleChange('buildingType', e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
              >
                <option value="">Select building type...</option>
                <option value="office">Office</option>
                <option value="retail">Retail</option>
                <option value="warehouse">Warehouse</option>
                <option value="restaurant">Restaurant</option>
                <option value="medical">Medical</option>
                <option value="other">Other</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-900 mb-2">
                Square Footage
              </label>
              <input
                type="number"
                value={formState.squareFootage || ''}
                onChange={(e) => handleChange('squareFootage', e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                placeholder="e.g., 15000"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-900 mb-2">
                Scope of Work *
              </label>
              <textarea
                required
                value={formState.scope || ''}
                onChange={(e) => handleChange('scope', e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent h-32"
                placeholder="Describe the project"
              />
            </div>

            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="drawings"
                checked={formState.drawings || false}
                onChange={(e) => handleChange('drawings', e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 text-amber-600 focus:ring-amber-500"
              />
              <label htmlFor="drawings" className="text-sm font-medium text-slate-900">
                I have drawings/blueprints to share
              </label>
            </div>
          </>
        )}

        {serviceType === 'solar' && (
          <SolarCalculator onDataChange={(data) => setFormState({ ...formState, ...data })} />
        )}

        <div className="flex gap-4 pt-6">
          <button
            type="button"
            onClick={onBack}
            className="flex-1 px-6 py-3 border border-slate-300 text-slate-900 font-medium rounded-lg hover:bg-slate-50 transition"
          >
            Back
          </button>
          <button
            type="submit"
            className="flex-1 px-6 py-3 bg-amber-600 text-white font-medium rounded-lg hover:bg-amber-700 transition flex items-center justify-center gap-2"
          >
            Continue <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </form>
  );
}
