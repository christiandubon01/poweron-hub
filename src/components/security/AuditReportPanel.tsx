/**
 * AuditReportPanel.tsx
 *
 * UI component for generating, viewing, downloading, and managing audit reports
 * Features:
 * - Date range selector for custom reports
 * - In-app report preview (scrollable)
 * - PDF download button
 * - Report history with past report links
 * - Month-vs-month comparison view
 * - CCPA/data retention/privacy compliance checklist
 */

import React, { useState, useRef } from 'react';
import { FileText, Download, Calendar, CheckCircle, AlertCircle, TrendingUp } from 'lucide-react';
import {
  AuditReportGenerator,
  AuditReport,
  MonthlyComparison,
  ComplianceItem,
} from '../../services/security/AuditReportGenerator';

export const AuditReportPanel: React.FC = () => {
  const generator = new AuditReportGenerator();
  const scrollRef = useRef<HTMLDivElement>(null);

  // State
  const [reportHistory, setReportHistory] = useState<AuditReport[]>([]);
  const [currentReport, setCurrentReport] = useState<AuditReport | null>(null);
  const [monthlyComparison, setMonthlyComparison] = useState<MonthlyComparison | null>(null);
  const [startDate, setStartDate] = useState<string>(
    new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0]
  );
  const [endDate, setEndDate] = useState<string>(
    new Date().toISOString().split('T')[0]
  );
  const [activeTab, setActiveTab] = useState<'generate' | 'preview' | 'history' | 'compare' | 'compliance'>('generate');
  const [complianceItems, setComplianceItems] = useState<ComplianceItem[]>([]);
  const [showComplianceChecklist, setShowComplianceChecklist] = useState(false);

  // Handlers
  const handleGenerateReport = () => {
    const report = generator.generateFullAuditReport(startDate, endDate);
    setCurrentReport(report);
    setReportHistory([report, ...reportHistory]);
    setActiveTab('preview');
  };

  const handleDownloadPDF = () => {
    if (!currentReport) return;

    const pdf = generator.exportPDF(currentReport);
    const url = URL.createObjectURL(pdf);
    const link = document.createElement('a');
    link.href = url;
    link.download = `audit-report-${currentReport.reportId}.pdf`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleLoadReport = (report: AuditReport) => {
    setCurrentReport(report);
    setActiveTab('preview');
  };

  const handleCompareMonths = () => {
    if (reportHistory.length < 2) {
      alert('Need at least 2 reports to compare');
      return;
    }

    const comparison = generator.compareMonths(reportHistory[0], reportHistory[1]);
    setMonthlyComparison(comparison);
    setActiveTab('compare');
  };

  const handleUpdateCompliance = (itemId: string, newStatus: ComplianceItem['status']) => {
    const updated = complianceItems.map((item) =>
      item.id === itemId
        ? { ...item, status: newStatus, lastVerified: new Date().toISOString().split('T')[0] }
        : item
    );
    setComplianceItems(updated);
  };

  // Render helpers
  const renderFindingsSummary = (report: AuditReport) => {
    const { criticalFindingsCount, highFindingsCount, totalFindingsCount } = report.executiveSummary;
    return (
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-red-50 dark:bg-red-900/20 p-4 rounded-lg border border-red-200 dark:border-red-800">
          <p className="text-sm font-medium text-red-700 dark:text-red-300">Critical</p>
          <p className="text-2xl font-bold text-red-900 dark:text-red-100">{criticalFindingsCount}</p>
        </div>
        <div className="bg-orange-50 dark:bg-orange-900/20 p-4 rounded-lg border border-orange-200 dark:border-orange-800">
          <p className="text-sm font-medium text-orange-700 dark:text-orange-300">High</p>
          <p className="text-2xl font-bold text-orange-900 dark:text-orange-100">{highFindingsCount}</p>
        </div>
        <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg border border-blue-200 dark:border-blue-800">
          <p className="text-sm font-medium text-blue-700 dark:text-blue-300">Total Findings</p>
          <p className="text-2xl font-bold text-blue-900 dark:text-blue-100">{totalFindingsCount}</p>
        </div>
        <div className="bg-green-50 dark:bg-green-900/20 p-4 rounded-lg border border-green-200 dark:border-green-800">
          <p className="text-sm font-medium text-green-700 dark:text-green-300">Compliance</p>
          <p className="text-2xl font-bold text-green-900 dark:text-green-100">
            {report.executiveSummary.compliancePercentage}%
          </p>
        </div>
      </div>
    );
  };

  const renderReportPreview = (report: AuditReport) => {
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-start">
          <div>
            <h2 className="text-2xl font-bold mb-2">
              Audit Report {report.reportId.slice(-8)}
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Generated: {new Date(report.generatedAt).toLocaleString()}
            </p>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Period: {report.dateRange.startDate} to {report.dateRange.endDate}
            </p>
          </div>
          <button
            onClick={handleDownloadPDF}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            <Download size={18} />
            Download PDF
          </button>
        </div>

        {renderFindingsSummary(report)}

        <div className="grid grid-cols-3 gap-4">
          <div className="bg-gradient-to-br from-green-50 to-green-100 dark:from-green-900/30 dark:to-green-800/30 p-4 rounded-lg border border-green-200 dark:border-green-700">
            <p className="text-sm text-green-700 dark:text-green-300">Security Posture</p>
            <p className="text-xl font-bold text-green-900 dark:text-green-100">
              {report.executiveSummary.overallPosture.toUpperCase()}
            </p>
          </div>
          <div className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-900/30 dark:to-blue-800/30 p-4 rounded-lg border border-blue-200 dark:border-blue-700">
            <p className="text-sm text-blue-700 dark:text-blue-300">Remediation</p>
            <p className="text-xl font-bold text-blue-900 dark:text-blue-100">
              {report.remediation.fixedCount}/{report.remediation.foundCount} fixed
            </p>
          </div>
          <div className="bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-900/30 dark:to-purple-800/30 p-4 rounded-lg border border-purple-200 dark:border-purple-700">
            <p className="text-sm text-purple-700 dark:text-purple-300">Authentication</p>
            <p className="text-xl font-bold text-purple-900 dark:text-purple-100">
              {report.executiveSummary.keyMetrics.authenticationScore}%
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <h3 className="text-lg font-semibold">Sections</h3>
          {report.sections.map((section) => (
            <details key={section.number} className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
              <summary className="cursor-pointer font-semibold flex justify-between items-center">
                <span>
                  Section {section.number}: {section.title}
                </span>
                <span
                  className={`px-2 py-1 text-xs rounded ${
                    section.testStatus === 'passed'
                      ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300'
                      : section.testStatus === 'partial'
                        ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300'
                        : 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300'
                  }`}
                >
                  {section.testStatus.toUpperCase()}
                </span>
              </summary>
              <div className="mt-3 space-y-3">
                <p className="text-sm text-gray-700 dark:text-gray-300">{section.summary}</p>
                {section.findings.length > 0 && (
                  <div className="space-y-2">
                    <p className="font-medium text-sm">Findings:</p>
                    {section.findings.map((finding) => (
                      <div
                        key={finding.id}
                        className="bg-gray-50 dark:bg-gray-900/30 p-3 rounded text-sm border-l-4"
                        style={{
                          borderColor:
                            finding.category === 'critical'
                              ? '#dc2626'
                              : finding.category === 'high'
                                ? '#f97316'
                                : finding.category === 'medium'
                                  ? '#eab308'
                                  : '#22c55e',
                        }}
                      >
                        <p className="font-semibold">{finding.title}</p>
                        <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                          {finding.timestamp} • {finding.testTool} v{finding.testToolVersion}
                        </p>
                        <p className="text-gray-700 dark:text-gray-300 mt-2">{finding.description}</p>
                        <p className="text-xs mt-1">
                          <span className="font-medium">Status:</span> {finding.fixStatus}
                          {finding.fixDate && ` (${finding.fixDate})`}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
                {section.recommendations.length > 0 && (
                  <div className="space-y-1">
                    <p className="font-medium text-sm">Recommendations:</p>
                    <ul className="text-sm list-disc list-inside text-gray-700 dark:text-gray-300">
                      {section.recommendations.map((rec, idx) => (
                        <li key={idx}>{rec}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </details>
          ))}
        </div>

        <div className="bg-gray-50 dark:bg-gray-900/40 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
          <h3 className="font-semibold mb-3">Chain of Custody</h3>
          <div className="text-sm space-y-2">
            <p>
              <span className="font-medium">Tested By:</span> {report.chainOfCustody.testedBy}
            </p>
            <p>
              <span className="font-medium">Date:</span> {report.chainOfCustody.testDate}
            </p>
            <p>
              <span className="font-medium">Tools:</span>{' '}
              {report.chainOfCustody.testTools.join(', ')}
            </p>
            <p className="text-gray-600 dark:text-gray-400 mt-3">
              {report.chainOfCustody.testMethodology}
            </p>
          </div>
        </div>
      </div>
    );
  };

  const renderComplianceChecklist = () => {
    const items = complianceItems.length > 0
      ? complianceItems
      : currentReport?.complianceItems || [];

    return (
      <div className="space-y-4">
        <h2 className="text-xl font-bold">Compliance Checklist</h2>
        {items.map((item) => (
          <div key={item.id} className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded">
                    {item.standard}
                  </span>
                  <p className="font-medium">{item.requirement}</p>
                </div>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">{item.notes}</p>
                <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                  Last verified: {item.lastVerified}
                </p>
              </div>
              <select
                value={item.status}
                onChange={(e) => handleUpdateCompliance(item.id, e.target.value as any)}
                className={`px-3 py-1 rounded text-sm font-medium border ${
                  item.status === 'compliant'
                    ? 'border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-900/30 dark:text-green-300'
                    : item.status === 'non-compliant'
                      ? 'border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300'
                      : item.status === 'partial'
                        ? 'border-yellow-200 bg-yellow-50 text-yellow-800 dark:border-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300'
                        : 'border-gray-200 bg-gray-50 text-gray-800 dark:border-gray-700 dark:bg-gray-900/30 dark:text-gray-300'
                }`}
              >
                <option value="compliant">Compliant</option>
                <option value="non-compliant">Non-Compliant</option>
                <option value="partial">Partial</option>
                <option value="not-applicable">N/A</option>
              </select>
            </div>
          </div>
        ))}
      </div>
    );
  };

  const renderMonthComparison = () => {
    if (!monthlyComparison) return null;

    return (
      <div className="space-y-6">
        <h2 className="text-xl font-bold">Month-vs-Month Comparison</h2>

        {/* Trend Analysis */}
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/30 dark:to-indigo-900/30 p-6 rounded-lg border border-blue-200 dark:border-blue-800">
          <div className="flex items-start gap-3">
            <TrendingUp className="text-blue-600 dark:text-blue-400 flex-shrink-0 mt-1" />
            <div>
              <h3 className="font-semibold mb-2">Trend Analysis</h3>
              <p className="text-gray-700 dark:text-gray-300">
                {monthlyComparison.trendAnalysis}
              </p>
            </div>
          </div>
        </div>

        {/* Improvements */}
        {monthlyComparison.improvements.length > 0 && (
          <div className="bg-green-50 dark:bg-green-900/30 p-4 rounded-lg border border-green-200 dark:border-green-800">
            <h3 className="font-semibold text-green-900 dark:text-green-300 mb-2 flex items-center gap-2">
              <CheckCircle size={18} />
              Improvements ({monthlyComparison.improvements.length})
            </h3>
            <ul className="text-sm text-green-800 dark:text-green-300 space-y-1">
              {monthlyComparison.improvements.map((item, idx) => (
                <li key={idx} className="flex items-center gap-2">
                  <span className="text-green-600 dark:text-green-400">✓</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Regressions */}
        {monthlyComparison.regressions.length > 0 && (
          <div className="bg-red-50 dark:bg-red-900/30 p-4 rounded-lg border border-red-200 dark:border-red-800">
            <h3 className="font-semibold text-red-900 dark:text-red-300 mb-2 flex items-center gap-2">
              <AlertCircle size={18} />
              Regressions ({monthlyComparison.regressions.length})
            </h3>
            <ul className="text-sm text-red-800 dark:text-red-300 space-y-1">
              {monthlyComparison.regressions.map((item, idx) => (
                <li key={idx} className="flex items-center gap-2">
                  <span className="text-red-600 dark:text-red-400">!</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* New Threats */}
        {monthlyComparison.newThreats.length > 0 && (
          <div className="bg-orange-50 dark:bg-orange-900/30 p-4 rounded-lg border border-orange-200 dark:border-orange-800">
            <h3 className="font-semibold text-orange-900 dark:text-orange-300 mb-2">
              New Threats ({monthlyComparison.newThreats.length})
            </h3>
            <ul className="text-sm text-orange-800 dark:text-orange-300 space-y-1">
              {monthlyComparison.newThreats.map((item, idx) => (
                <li key={idx} className="flex items-center gap-2">
                  <span className="text-orange-600 dark:text-orange-400">!</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Resolved Threats */}
        {monthlyComparison.resolvedThreats.length > 0 && (
          <div className="bg-blue-50 dark:bg-blue-900/30 p-4 rounded-lg border border-blue-200 dark:border-blue-800">
            <h3 className="font-semibold text-blue-900 dark:text-blue-300 mb-2">
              Resolved Threats ({monthlyComparison.resolvedThreats.length})
            </h3>
            <ul className="text-sm text-blue-800 dark:text-blue-300 space-y-1">
              {monthlyComparison.resolvedThreats.map((item, idx) => (
                <li key={idx} className="flex items-center gap-2">
                  <span className="text-blue-600 dark:text-blue-400">✓</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="w-full h-full flex flex-col bg-white dark:bg-gray-950">
      {/* Header */}
      <div className="border-b border-gray-200 dark:border-gray-800 p-6">
        <div className="flex items-center gap-3 mb-4">
          <FileText className="text-blue-600 dark:text-blue-400" size={28} />
          <h1 className="text-2xl font-bold">Security Audit Reports</h1>
        </div>
        <p className="text-gray-600 dark:text-gray-400">
          Generate, review, and manage court-ready security audit reports
        </p>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 dark:border-gray-800 flex gap-1 px-6 pt-4">
        {(['generate', 'preview', 'history', 'compare', 'compliance'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 font-medium border-b-2 transition-colors ${
              activeTab === tab
                ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
            }`}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {/* Generate Tab */}
        {activeTab === 'generate' && (
          <div className="max-w-2xl">
            <h2 className="text-xl font-bold mb-6">Generate New Report</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Start Date
                </label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  End Date
                </label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
                />
              </div>
              <button
                onClick={handleGenerateReport}
                className="w-full px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium flex items-center justify-center gap-2"
              >
                <Calendar size={18} />
                Generate Report
              </button>
            </div>
          </div>
        )}

        {/* Preview Tab */}
        {activeTab === 'preview' && currentReport && (
          <div ref={scrollRef} className="max-w-4xl">
            {renderReportPreview(currentReport)}
          </div>
        )}

        {/* History Tab */}
        {activeTab === 'history' && (
          <div className="max-w-3xl">
            <h2 className="text-xl font-bold mb-6">Report History</h2>
            {reportHistory.length === 0 ? (
              <p className="text-gray-600 dark:text-gray-400">No reports generated yet</p>
            ) : (
              <div className="space-y-3">
                {reportHistory.map((report) => (
                  <div
                    key={report.reportId}
                    className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 hover:bg-gray-50 dark:hover:bg-gray-900/30 cursor-pointer transition-colors"
                    onClick={() => handleLoadReport(report)}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-semibold">Report {report.reportId.slice(-8)}</p>
                        <p className="text-sm text-gray-600 dark:text-gray-400">
                          {new Date(report.generatedAt).toLocaleString()}
                        </p>
                        <p className="text-sm text-gray-600 dark:text-gray-400">
                          Period: {report.dateRange.startDate} to {report.dateRange.endDate}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                          {report.executiveSummary.totalFindingsCount} findings
                        </p>
                        <p
                          className={`text-sm font-medium ${
                            report.executiveSummary.overallPosture === 'secure'
                              ? 'text-green-600 dark:text-green-400'
                              : report.executiveSummary.overallPosture === 'at-risk'
                                ? 'text-yellow-600 dark:text-yellow-400'
                                : 'text-red-600 dark:text-red-400'
                          }`}
                        >
                          {report.executiveSummary.overallPosture.toUpperCase()}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Compare Tab */}
        {activeTab === 'compare' && (
          <div className="max-w-4xl">
            {!monthlyComparison && reportHistory.length >= 2 ? (
              <div className="text-center py-8">
                <button
                  onClick={handleCompareMonths}
                  className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
                >
                  Compare Last 2 Reports
                </button>
              </div>
            ) : reportHistory.length < 2 ? (
              <p className="text-gray-600 dark:text-gray-400">
                Need at least 2 reports to compare. Generate more reports first.
              </p>
            ) : (
              renderMonthComparison()
            )}
          </div>
        )}

        {/* Compliance Tab */}
        {activeTab === 'compliance' && (
          <div className="max-w-4xl">
            {renderComplianceChecklist()}
          </div>
        )}
      </div>
    </div>
  );
};

export default AuditReportPanel;
