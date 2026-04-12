/**
 * CompliancePanel.tsx
 * CCPA Compliance Dashboard for PowerOn Hub
 * 
 * Features:
 * - Compliance request queue (pending export/delete requests)
 * - Data retention status (what data is approaching limits)
 * - Privacy audit log (access tracking)
 * - Export/Delete actions with confirmation
 * - Compliance checklist (CCPA, Privacy Policy, ToS)
 */

import React, { useState, useEffect } from 'react';
import { complianceManager } from '../../services/security/ComplianceManager';
import type { ComplianceRequest, AuditLog } from '../../services/security/ComplianceManager';

interface CompliancePanelProps {
  userId?: string;
  accountStatus?: 'active' | 'cancelled' | 'archived';
  onExportRequested?: () => void;
  onDeleteRequested?: () => void;
}

export const CompliancePanel: React.FC<CompliancePanelProps> = ({
  userId = 'demo-user-001',
  accountStatus = 'active',
  onExportRequested,
  onDeleteRequested
}) => {
  const [activeTab, setActiveTab] = useState<'requests' | 'retention' | 'audit' | 'checklist'>('requests');
  const [complianceQueue, setComplianceQueue] = useState<ComplianceRequest[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [showExportConfirm, setShowExportConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmToken, setDeleteConfirmToken] = useState('');
  const [exportInProgress, setExportInProgress] = useState(false);
  const [deleteInProgress, setDeleteInProgress] = useState(false);
  const [retentionStatus, setRetentionStatus] = useState<any>(null);

  useEffect(() => {
    // Load initial data
    refreshComplianceData();
  }, [userId, accountStatus]);

  const refreshComplianceData = () => {
    setComplianceQueue(complianceManager.getComplianceQueue());
    setAuditLogs(complianceManager.getAuditTrail(userId, 50));
    setRetentionStatus(complianceManager.getRetentionStatus(accountStatus || 'active'));
  };

  const handleExportData = async () => {
    setExportInProgress(true);
    onExportRequested?.();
    
    try {
      const request = await complianceManager.rightToKnow(userId);
      setComplianceQueue(prev => [...prev, request]);
      
      // Simulate download link
      setTimeout(() => {
        const dataBlob = new Blob(
          [JSON.stringify(complianceManager.generatePrivacyReport(userId), null, 2)],
          { type: 'application/json' }
        );
        const url = URL.createObjectURL(dataBlob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `compliance-export-${userId}-${new Date().toISOString().split('T')[0]}.json`;
        link.click();
        URL.revokeObjectURL(url);
      }, 2000);
    } finally {
      setExportInProgress(false);
      setShowExportConfirm(false);
      refreshComplianceData();
    }
  };

  const handleDeleteAccount = async () => {
    if (!deleteConfirmToken) {
      alert('Please enter the confirmation code');
      return;
    }

    setDeleteInProgress(true);
    onDeleteRequested?.();

    try {
      const request = await complianceManager.rightToDelete(userId, deleteConfirmToken);
      setComplianceQueue(prev => [...prev, request]);
      alert('Account deletion initiated. This process may take up to 30 days to complete.');
    } catch (error) {
      alert('Error initiating account deletion. Please try again.');
    } finally {
      setDeleteInProgress(false);
      setShowDeleteConfirm(false);
      setDeleteConfirmToken('');
      refreshComplianceData();
    }
  };

  const handleOptOut = async () => {
    try {
      await complianceManager.rightToOptOut(userId);
      alert('You have successfully opted out of data sharing and analytics.');
      refreshComplianceData();
    } catch (error) {
      alert('Error processing opt-out request.');
    }
  };

  const complianceChecklist = [
    {
      id: 'ccpa-transparency',
      title: 'CCPA Transparency Requirements',
      items: [
        { label: 'Right to Know', status: 'enabled' as const },
        { label: 'Right to Delete', status: 'enabled' as const },
        { label: 'Right to Opt-Out', status: 'enabled' as const },
        { label: 'Data Inventory Published', status: 'enabled' as const }
      ]
    },
    {
      id: 'privacy-policy',
      title: 'Privacy Policy Enforcement',
      items: [
        { label: 'Data Usage Verification', status: 'enabled' as const },
        { label: 'Access Tracking', status: 'enabled' as const },
        { label: 'Consent Management', status: 'enabled' as const },
        { label: 'Privacy Reports Available', status: 'enabled' as const }
      ]
    },
    {
      id: 'retention-policy',
      title: 'Data Retention Compliance',
      items: [
        { label: 'Voice Recordings (30 days)', status: 'enabled' as const },
        { label: 'Portal Leads (1 year)', status: 'enabled' as const },
        { label: 'Security Logs (2 years)', status: 'enabled' as const },
        { label: 'Backup Data Auto-Purge', status: 'enabled' as const }
      ]
    }
  ];

  return (
    <div className="compliance-panel p-6 space-y-6">
      {/* Header */}
      <div className="border-b border-gray-700">
        <h1 className="text-2xl font-bold text-white mb-2">Compliance & Privacy</h1>
        <p className="text-gray-400 text-sm">Manage CCPA rights, data retention, and privacy policies</p>
      </div>

      {/* Action Buttons */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <button
          onClick={() => setShowExportConfirm(true)}
          disabled={exportInProgress}
          className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 text-white font-semibold py-3 px-4 rounded transition"
        >
          <span className="block text-sm">📥 Export My Data</span>
          <span className="text-xs text-blue-200">CCPA Right to Know</span>
        </button>

        <button
          onClick={() => setShowDeleteConfirm(true)}
          className="bg-red-600 hover:bg-red-700 text-white font-semibold py-3 px-4 rounded transition"
        >
          <span className="block text-sm">🗑️ Delete Account</span>
          <span className="text-xs text-red-200">CCPA Right to Delete</span>
        </button>

        <button
          onClick={handleOptOut}
          className="bg-purple-600 hover:bg-purple-700 text-white font-semibold py-3 px-4 rounded transition"
        >
          <span className="block text-sm">🚫 Opt Out Data Sharing</span>
          <span className="text-xs text-purple-200">Disable Analytics</span>
        </button>
      </div>

      {/* Export Confirmation Modal */}
      {showExportConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4">
            <h2 className="text-xl font-bold text-white mb-4">Export Your Data</h2>
            <p className="text-gray-300 mb-6">
              You are requesting a complete export of all your personal data in accordance with CCPA
              regulations. This includes all projects, service logs, leads, and activity records.
            </p>
            <div className="space-y-4">
              <button
                onClick={handleExportData}
                disabled={exportInProgress}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 text-white font-semibold py-2 rounded transition"
              >
                {exportInProgress ? 'Processing...' : 'Confirm Export'}
              </button>
              <button
                onClick={() => setShowExportConfirm(false)}
                className="w-full bg-gray-700 hover:bg-gray-600 text-white font-semibold py-2 rounded transition"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4">
            <h2 className="text-xl font-bold text-red-400 mb-4">Delete Account & All Data</h2>
            <div className="bg-red-900 bg-opacity-20 border border-red-700 rounded p-4 mb-6">
              <p className="text-red-300 text-sm font-semibold mb-2">⚠️ This action cannot be undone</p>
              <p className="text-gray-300 text-sm">
                All your data will be permanently deleted including projects, service logs, leads, and
                personal information. This process may take up to 30 days to complete.
              </p>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-gray-300 text-sm font-semibold mb-2">
                  Enter confirmation code: <code className="text-red-400">DELETE-{userId.substring(0, 8).toUpperCase()}</code>
                </label>
                <input
                  type="text"
                  value={deleteConfirmToken}
                  onChange={(e) => setDeleteConfirmToken(e.target.value)}
                  placeholder="Enter code above"
                  className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-red-500"
                />
              </div>
              <button
                onClick={handleDeleteAccount}
                disabled={deleteInProgress || deleteConfirmToken !== `DELETE-${userId.substring(0, 8).toUpperCase()}`}
                className="w-full bg-red-600 hover:bg-red-700 disabled:bg-gray-700 text-white font-semibold py-2 rounded transition"
              >
                {deleteInProgress ? 'Processing...' : 'Permanently Delete Account'}
              </button>
              <button
                onClick={() => {
                  setShowDeleteConfirm(false);
                  setDeleteConfirmToken('');
                }}
                className="w-full bg-gray-700 hover:bg-gray-600 text-white font-semibold py-2 rounded transition"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tab Navigation */}
      <div className="flex gap-2 border-b border-gray-700">
        {(
          ['requests', 'retention', 'audit', 'checklist'] as const
        ).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 font-semibold transition border-b-2 ${
              activeTab === tab
                ? 'text-blue-400 border-blue-400'
                : 'text-gray-400 border-transparent hover:text-gray-300'
            }`}
          >
            {tab === 'requests' && 'Request Queue'}
            {tab === 'retention' && 'Data Retention'}
            {tab === 'audit' && 'Audit Log'}
            {tab === 'checklist' && 'Checklist'}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="space-y-4">
        {/* Request Queue Tab */}
        {activeTab === 'requests' && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-white">CCPA Request Queue</h2>
            {complianceQueue.length === 0 ? (
              <p className="text-gray-400 text-sm">No active requests</p>
            ) : (
              <div className="space-y-3">
                {complianceQueue.map(request => (
                  <div key={request.id} className="bg-gray-800 rounded p-4 border border-gray-700">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <p className="text-white font-semibold capitalize">
                          {request.type === 'export' && '📥'} {request.type === 'delete' && '🗑️'}{' '}
                          {request.type === 'optout' && '🚫'} {request.type}
                        </p>
                        <p className="text-gray-400 text-xs">
                          {new Date(request.requestedAt).toLocaleString()}
                        </p>
                      </div>
                      <span
                        className={`px-3 py-1 rounded text-xs font-semibold ${
                          request.status === 'completed'
                            ? 'bg-green-900 text-green-300'
                            : request.status === 'processing'
                              ? 'bg-blue-900 text-blue-300'
                              : request.status === 'failed'
                                ? 'bg-red-900 text-red-300'
                                : 'bg-yellow-900 text-yellow-300'
                        }`}
                      >
                        {request.status}
                      </span>
                    </div>
                    {request.recordCount && (
                      <p className="text-gray-400 text-sm">
                        Records: {request.recordCount.toLocaleString()} | Size: {((request.dataSize || 0) / 1000000).toFixed(2)} MB
                      </p>
                    )}
                    {request.notes && <p className="text-gray-400 text-sm mt-2">{request.notes}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Data Retention Tab */}
        {activeTab === 'retention' && retentionStatus && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-white">Data Retention Status</h2>
            <div className="bg-gray-800 rounded p-4 border border-gray-700">
              <p className="text-gray-300 text-sm mb-4">
                Account Status: <span className="font-semibold text-white capitalize">{accountStatus}</span>
              </p>

              <div className="space-y-3">
                <h3 className="text-white font-semibold text-sm">Retention Policies</h3>
                {Object.entries(retentionStatus.policies).map(([key, days]: [string, any]) => (
                  <div key={key} className="flex justify-between items-center text-sm">
                    <span className="text-gray-400 capitalize">{key.replace(/_/g, ' ')}</span>
                    <span className="text-gray-300 font-semibold">
                      {days === -1 ? 'Indefinite' : `${days} days`}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {retentionStatus.dataApproachingDeletion?.length > 0 && (
              <div className="bg-yellow-900 bg-opacity-20 border border-yellow-700 rounded p-4">
                <h3 className="text-yellow-300 font-semibold text-sm mb-3">⚠️ Data Approaching Deletion</h3>
                <div className="space-y-2">
                  {retentionStatus.dataApproachingDeletion.map((item: any, idx: number) => (
                    <div key={idx} className="text-sm text-gray-300">
                      <p className="font-semibold">{item.table}</p>
                      <p className="text-xs text-gray-400">
                        Will be deleted on {new Date(item.estimatedDeletionDate).toLocaleDateString()}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Audit Log Tab */}
        {activeTab === 'audit' && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-white">Privacy Audit Log</h2>
            {auditLogs.length === 0 ? (
              <p className="text-gray-400 text-sm">No audit entries</p>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {auditLogs.map(log => (
                  <div
                    key={log.id}
                    className="bg-gray-800 rounded p-3 border border-gray-700 text-sm"
                  >
                    <div className="flex justify-between items-start mb-1">
                      <p className="text-gray-300 font-semibold">{log.action}</p>
                      <p className="text-gray-500 text-xs">
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </p>
                    </div>
                    <p className="text-gray-400 text-xs">
                      {log.tableName && `Table: ${log.tableName}`}
                      {log.ipAddress && ` | IP: ${log.ipAddress}`}
                    </p>
                    {log.reason && <p className="text-gray-400 text-xs mt-1">{log.reason}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Compliance Checklist Tab */}
        {activeTab === 'checklist' && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-white">Compliance Checklist</h2>
            {complianceChecklist.map(section => (
              <div key={section.id} className="bg-gray-800 rounded p-4 border border-gray-700">
                <h3 className="text-white font-semibold mb-3">{section.title}</h3>
                <div className="space-y-2">
                  {section.items.map(item => (
                    <div key={item.label} className="flex items-center gap-3">
                      <span className="text-green-400 text-xl">✓</span>
                      <span className="text-gray-300 text-sm">{item.label}</span>
                      <span className="ml-auto text-xs font-semibold text-green-400">
                        {item.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer Info */}
      <div className="border-t border-gray-700 pt-4 text-xs text-gray-500">
        <p>
          All compliance requests are logged and tracked for audit purposes. For questions about your
          data or privacy, contact compliance@poweronsolutionsllc.com
        </p>
      </div>
    </div>
  );
};

export default CompliancePanel;
