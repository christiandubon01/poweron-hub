import React, { useState, useEffect } from 'react';
import {
  emailCampaignsService,
  callTrackingService,
  socialMediaService,
  analyticsService,
  EmailCampaign,
  InboundCall,
  SocialPost,
  ChannelPerformance,
  LeadSource,
} from '../../services/marketing/MarketingIntegration';
import './MarketingPanel.css';

export const MarketingPanel: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'campaigns' | 'calls' | 'social' | 'analytics'>('campaigns');
  const [campaigns, setCampaigns] = useState<EmailCampaign[]>([]);
  const [recentCalls, setRecentCalls] = useState<InboundCall[]>([]);
  const [socialPosts, setSocialPosts] = useState<SocialPost[]>([]);
  const [channelPerformance, setChannelPerformance] = useState<ChannelPerformance[]>([]);
  const [leadSources, setLeadSources] = useState<LeadSource[]>([]);
  const [showCampaignWizard, setShowCampaignWizard] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadData();
  }, [activeTab]);

  const loadData = async () => {
    setLoading(true);
    try {
      switch (activeTab) {
        case 'campaigns':
          const campaigns = await emailCampaignsService.getCampaigns();
          setCampaigns(campaigns);
          break;
        case 'calls':
          // Simulate fetching recent calls
          setRecentCalls([
            {
              id: '1',
              phone: '(555) 123-4567',
              source: 'Google',
              duration: 420,
              outcome: 'estimate_scheduled',
              timestamp: new Date().toISOString(),
            },
            {
              id: '2',
              phone: '(555) 987-6543',
              source: 'Portal',
              duration: 180,
              outcome: 'job_booked',
              timestamp: new Date(Date.now() - 3600000).toISOString(),
            },
          ]);
          break;
        case 'social':
          const posts = await socialMediaService.getRecentPosts(5);
          setSocialPosts(posts);
          break;
        case 'analytics':
          const [performance, sources] = await Promise.all([
            analyticsService.getChannelPerformance(),
            analyticsService.getLeadSourceAttribution(),
          ]);
          setChannelPerformance(performance);
          setLeadSources(sources);
          break;
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSendCampaign = async (campaignId: string) => {
    const success = await emailCampaignsService.sendCampaign(campaignId);
    if (success) {
      alert('Campaign sent successfully!');
      loadData();
    }
  };

  const handleCreateCampaign = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const name = formData.get('campaignName') as string;
    const type = formData.get('campaignType') as any;
    const recipients = (formData.get('recipients') as string).split('\n').filter((r) => r.trim());
    const template = formData.get('template') as string;

    await emailCampaignsService.createCampaign(name, type, template, recipients);
    setShowCampaignWizard(false);
    loadData();
  };

  return (
    <div className="marketing-panel">
      <div className="marketing-header">
        <h1>Marketing Hub</h1>
        <p>Manage campaigns, calls, social media, and analytics</p>
      </div>

      <div className="marketing-tabs">
        <button
          className={`tab ${activeTab === 'campaigns' ? 'active' : ''}`}
          onClick={() => setActiveTab('campaigns')}
        >
          📧 Campaigns
        </button>
        <button
          className={`tab ${activeTab === 'calls' ? 'active' : ''}`}
          onClick={() => setActiveTab('calls')}
        >
          📞 Call Log
        </button>
        <button
          className={`tab ${activeTab === 'social' ? 'active' : ''}`}
          onClick={() => setActiveTab('social')}
        >
          📱 Social Queue
        </button>
        <button
          className={`tab ${activeTab === 'analytics' ? 'active' : ''}`}
          onClick={() => setActiveTab('analytics')}
        >
          📊 Analytics
        </button>
      </div>

      <div className="marketing-content">
        {/* Email Campaigns Tab */}
        {activeTab === 'campaigns' && (
          <div className="tab-content">
            <div className="section-header">
              <h2>Email Campaigns</h2>
              <button className="btn-primary" onClick={() => setShowCampaignWizard(true)}>
                + Create Campaign
              </button>
            </div>

            {showCampaignWizard && (
              <div className="wizard-overlay">
                <div className="wizard-modal">
                  <h3>Create New Campaign</h3>
                  <form onSubmit={handleCreateCampaign}>
                    <div className="form-group">
                      <label>Campaign Name</label>
                      <input type="text" name="campaignName" required />
                    </div>

                    <div className="form-group">
                      <label>Campaign Type</label>
                      <select name="campaignType" required>
                        <option value="new_service_announcement">New Service Announcement</option>
                        <option value="seasonal_promotion">Seasonal Promotion</option>
                        <option value="follow_up_sequence">Follow-up Sequence</option>
                        <option value="newsletter">Newsletter</option>
                      </select>
                    </div>

                    <div className="form-group">
                      <label>Recipients (one per line)</label>
                      <textarea name="recipients" rows={6} required />
                    </div>

                    <div className="form-group">
                      <label>Template/Custom Content</label>
                      <textarea name="template" rows={4} />
                    </div>

                    <div className="form-actions">
                      <button type="submit" className="btn-primary">
                        Create Campaign
                      </button>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => setShowCampaignWizard(false)}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}

            <div className="campaigns-grid">
              {campaigns.length === 0 ? (
                <p className="empty-state">No campaigns yet. Create one to get started!</p>
              ) : (
                campaigns.map((campaign) => (
                  <div key={campaign.id} className="campaign-card">
                    <div className="campaign-header">
                      <h4>{campaign.name}</h4>
                      <span className={`badge badge-${campaign.status}`}>{campaign.status}</span>
                    </div>
                    <p className="campaign-type">{campaign.type.replace(/_/g, ' ')}</p>
                    <div className="campaign-stats">
                      <div className="stat">
                        <span className="label">Recipients</span>
                        <span className="value">{campaign.recipients.length}</span>
                      </div>
                      {campaign.openRate !== undefined && (
                        <div className="stat">
                          <span className="label">Open Rate</span>
                          <span className="value">{(campaign.openRate * 100).toFixed(1)}%</span>
                        </div>
                      )}
                      {campaign.clickRate !== undefined && (
                        <div className="stat">
                          <span className="label">Click Rate</span>
                          <span className="value">{(campaign.clickRate * 100).toFixed(1)}%</span>
                        </div>
                      )}
                    </div>
                    {campaign.status === 'draft' && (
                      <button
                        className="btn-action"
                        onClick={() => handleSendCampaign(campaign.id)}
                      >
                        Send Campaign
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Call Log Tab */}
        {activeTab === 'calls' && (
          <div className="tab-content">
            <h2>Recent Inbound Calls</h2>
            <div className="calls-table">
              <table>
                <thead>
                  <tr>
                    <th>Phone</th>
                    <th>Source</th>
                    <th>Duration</th>
                    <th>Outcome</th>
                    <th>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {recentCalls.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="empty-cell">
                        No calls recorded yet
                      </td>
                    </tr>
                  ) : (
                    recentCalls.map((call) => (
                      <tr key={call.id}>
                        <td className="phone">{call.phone}</td>
                        <td>
                          <span className="badge badge-info">{call.source}</span>
                        </td>
                        <td>{Math.round(call.duration / 60)} min</td>
                        <td>
                          <span className={`badge badge-${getOutcomeBadgeClass(call.outcome)}`}>
                            {call.outcome.replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td>{new Date(call.timestamp).toLocaleTimeString()}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Social Media Queue Tab */}
        {activeTab === 'social' && (
          <div className="tab-content">
            <h2>Social Media Queue</h2>
            <div className="social-grid">
              {socialPosts.length === 0 ? (
                <p className="empty-state">No scheduled posts. Create one to get started!</p>
              ) : (
                socialPosts.map((post) => (
                  <div key={post.id} className="social-card">
                    <div className="social-platform">{post.platform}</div>
                    <p className="social-content">{post.content}</p>
                    <div className="social-stats">
                      <span>❤️ {post.engagement.likes}</span>
                      <span>💬 {post.engagement.comments}</span>
                      <span>↗️ {post.engagement.shares}</span>
                    </div>
                    <div className="social-status">
                      <span className={`badge badge-${post.status}`}>{post.status}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Analytics Tab */}
        {activeTab === 'analytics' && (
          <div className="tab-content">
            <h2>Channel Performance & Analytics</h2>

            {/* Channel Performance Chart */}
            <div className="analytics-section">
              <h3>Channel ROI</h3>
              <div className="chart-container">
                {channelPerformance.length === 0 ? (
                  <p>Loading performance data...</p>
                ) : (
                  <div className="bar-chart">
                    {channelPerformance.map((channel, idx) => (
                      <div key={idx} className="bar-item">
                        <div className="bar-label">{channel.channel}</div>
                        <div className="bar-wrapper">
                          <div
                            className="bar"
                            style={{
                              width: `${Math.max(10, (channel.roi / Math.max(...channelPerformance.map((c) => c.roi || 1))) * 90)}%`,
                            }}
                          />
                        </div>
                        <div className="bar-value">ROI: {(channel.roi * 100).toFixed(0)}%</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Lead Source Pie Chart */}
            <div className="analytics-section">
              <h3>Lead Source Distribution</h3>
              <div className="pie-chart">
                {leadSources.length === 0 ? (
                  <p>Loading lead source data...</p>
                ) : (
                  <svg viewBox="0 0 100 100" style={{ maxWidth: '300px', margin: '0 auto' }}>
                    {leadSources.map((source, idx) => {
                      const angle = (source.percentage / 100) * 360 * (Math.PI / 180);
                      const hue = (idx * 360) / leadSources.length;
                      return (
                        <circle
                          key={idx}
                          cx="50"
                          cy="50"
                          r={30 + idx * 5}
                          fill="none"
                          stroke={`hsl(${hue}, 70%, 50%)`}
                          strokeWidth="8"
                          opacity="0.8"
                        />
                      );
                    })}
                  </svg>
                )}
              </div>

              <div className="lead-sources-list">
                {leadSources.map((source, idx) => (
                  <div key={idx} className="source-item">
                    <span className="source-name">{source.source}</span>
                    <span className="source-count">{source.count} leads</span>
                    <span className="source-percent">{source.percentage.toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

function getOutcomeBadgeClass(outcome: string): string {
  switch (outcome) {
    case 'estimate_scheduled':
    case 'job_booked':
      return 'success';
    case 'no_answer':
      return 'warning';
    case 'voicemail':
      return 'info';
    default:
      return 'default';
  }
}

export default MarketingPanel;
