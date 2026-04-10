// @ts-nocheck
/**
 * src/components/hunter/HunterPortfolioPanel.tsx
 * Portfolio Showcase Management UI
 *
 * Provides interface for managing portfolio entries, including:
 * - Grid view of portfolio entries with thumbnails
 * - Add entry from completed project dropdown
 * - Request testimonial button per entry
 * - Share functionality (copy link, post to social, embed code)
 * - Certification section with visual badges
 * - Preview mode showing website/portal appearance
 */

import React, { useState, useEffect } from 'react';
import {
  createPortfolioEntry,
  getPortfolioEntries,
  updatePortfolioEntry,
  deletePortfolioEntry,
  requestClientTestimonial,
  generateShowcaseHTML,
  exportForSocialMedia,
  getCertifications,
  validatePortfolioEntry,
  PortfolioEntry,
  Certification,
  SocialPlatform,
  ProjectType,
} from '@/services/hunter/HunterPortfolioService';

interface HunterPortfolioPanelProps {
  projects?: any[];
  completedProjects?: any[];
  onSelectEntry?: (entry: PortfolioEntry) => void;
}

export const HunterPortfolioPanel: React.FC<HunterPortfolioPanelProps> = ({
  projects = [],
  completedProjects = [],
  onSelectEntry,
}) => {
  const [entries, setEntries] = useState<PortfolioEntry[]>([]);
  const [certifications, setCertifications] = useState<Certification[]>([]);
  const [selectedEntry, setSelectedEntry] = useState<PortfolioEntry | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [shareModalEntry, setShareModalEntry] = useState<PortfolioEntry | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'entries' | 'certifications' | 'preview'>('entries');
  const [filter, setFilter] = useState<ProjectType | 'all'>('all');

  // Load portfolio entries and certifications on mount
  useEffect(() => {
    loadPortfolioData();
  }, []);

  async function loadPortfolioData() {
    setLoading(true);
    try {
      const portfolioEntries = await getPortfolioEntries({
        limit: 50,
      });
      setEntries(portfolioEntries);

      const certs = await getCertifications();
      setCertifications(certs);
    } catch (error) {
      console.error('Failed to load portfolio data:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleAddPortfolioEntry(projectId: string) {
    setLoading(true);
    try {
      const project = completedProjects.find((p) => p.id === projectId);
      if (!project) {
        alert('Project not found');
        return;
      }

      const newEntry = await createPortfolioEntry(projectId, project);
      setEntries([newEntry, ...entries]);
      setShowAddModal(false);
      alert('Portfolio entry created successfully!');
    } catch (error) {
      console.error('Failed to create portfolio entry:', error);
      alert('Failed to create portfolio entry');
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteEntry(entryId: string) {
    if (!confirm('Are you sure you want to delete this portfolio entry?')) return;

    try {
      await deletePortfolioEntry(entryId);
      setEntries(entries.filter((e) => e.id !== entryId));
      setSelectedEntry(null);
    } catch (error) {
      console.error('Failed to delete entry:', error);
      alert('Failed to delete entry');
    }
  }

  async function handleRequestTestimonial(entry: PortfolioEntry) {
    try {
      const result = await requestClientTestimonial(entry.id);
      // Show templates to user for copying
      alert(
        'Testimonial request templates generated. You can copy them to send via email or text.'
      );
    } catch (error) {
      console.error('Failed to request testimonial:', error);
      alert('Failed to generate testimonial template');
    }
  }

  async function handleShareEntry(entry: PortfolioEntry, platform: SocialPlatform) {
    try {
      const export_ = await exportForSocialMedia(entry.id, platform);
      const text = export_.content + '\n\n' + export_.hashtags.join(' ');
      navigator.clipboard.writeText(text);
      alert(
        `${platform.charAt(0).toUpperCase() + platform.slice(1)} post copied to clipboard!`
      );
    } catch (error) {
      console.error('Failed to export for social media:', error);
      alert('Failed to generate social media post');
    }
  }

  async function handleToggleFeatured(entry: PortfolioEntry) {
    try {
      const updated = await updatePortfolioEntry(entry.id, {
        featured: !entry.featured,
      });
      setEntries(entries.map((e) => (e.id === entry.id ? updated : e)));
      if (selectedEntry?.id === entry.id) {
        setSelectedEntry(updated);
      }
    } catch (error) {
      console.error('Failed to update entry:', error);
    }
  }

  const filteredEntries =
    filter === 'all' ? entries : entries.filter((e) => e.project_type === filter);

  const showCaseHTML = generateShowcaseHTML(entries);

  return (
    <div className="hunter-portfolio-panel">
      {/* Header */}
      <div className="portfolio-header">
        <h2>📸 Portfolio Showcase</h2>
        <div className="header-controls">
          <button
            className="btn btn-primary"
            onClick={() => setShowAddModal(true)}
            disabled={completedProjects.length === 0}
          >
            + Add Entry
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="portfolio-tabs">
        <button
          className={`tab-btn ${activeTab === 'entries' ? 'active' : ''}`}
          onClick={() => setActiveTab('entries')}
        >
          Portfolio ({filteredEntries.length})
        </button>
        <button
          className={`tab-btn ${activeTab === 'certifications' ? 'active' : ''}`}
          onClick={() => setActiveTab('certifications')}
        >
          Certifications ({certifications.length})
        </button>
        <button
          className={`tab-btn ${activeTab === 'preview' ? 'active' : ''}`}
          onClick={() => setActiveTab('preview')}
        >
          Preview
        </button>
      </div>

      {/* Entries Tab */}
      {activeTab === 'entries' && (
        <div className="portfolio-content">
          {/* Filters */}
          <div className="portfolio-filters">
            <label>Filter by type:</label>
            <select value={filter} onChange={(e) => setFilter(e.target.value as any)}>
              <option value="all">All Types</option>
              <option value="residential">Residential</option>
              <option value="commercial">Commercial</option>
              <option value="solar">Solar</option>
              <option value="service">Service</option>
            </select>
          </div>

          {loading ? (
            <div className="loading">Loading portfolio...</div>
          ) : filteredEntries.length === 0 ? (
            <div className="empty-state">
              <p>No portfolio entries yet. Add your first completed project!</p>
            </div>
          ) : (
            <div className="portfolio-grid">
              {filteredEntries.map((entry) => (
                <div
                  key={entry.id}
                  className={`portfolio-card ${selectedEntry?.id === entry.id ? 'selected' : ''}`}
                  onClick={() => {
                    setSelectedEntry(entry);
                    onSelectEntry?.(entry);
                  }}
                >
                  {/* Thumbnail */}
                  <div className="card-thumbnail">
                    {entry.thumbnail_url ? (
                      <img
                        src={entry.thumbnail_url}
                        alt={entry.project_name}
                        onError={(e) => {
                          (e.target as any).src =
                            'https://via.placeholder.com/200x150?text=No+Photo';
                        }}
                      />
                    ) : (
                      <div className="placeholder">
                        <span>📷</span>
                      </div>
                    )}
                    {entry.featured && <div className="featured-badge">⭐ Featured</div>}
                  </div>

                  {/* Info */}
                  <div className="card-info">
                    <h4>{entry.project_name}</h4>
                    <p className="location">{entry.location_city}</p>
                    <p className="highlight">{entry.highlight_stat}</p>
                    <p className="type-badge">{entry.project_type}</p>
                  </div>

                  {/* Actions */}
                  <div className="card-actions">
                    <button
                      className="action-btn"
                      title="Request Testimonial"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRequestTestimonial(entry);
                      }}
                    >
                      💬
                    </button>
                    <button
                      className="action-btn"
                      title="Share"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShareModalEntry(entry);
                      }}
                    >
                      📤
                    </button>
                    <button
                      className={`action-btn ${entry.featured ? 'featured' : ''}`}
                      title="Toggle Featured"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggleFeatured(entry);
                      }}
                    >
                      ⭐
                    </button>
                    <button
                      className="action-btn delete"
                      title="Delete"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteEntry(entry.id);
                      }}
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Selected Entry Details */}
          {selectedEntry && (
            <div className="entry-details">
              <h3>{selectedEntry.project_name}</h3>
              <div className="details-grid">
                <div className="detail-item">
                  <label>Location:</label>
                  <span>{selectedEntry.location_city}</span>
                </div>
                <div className="detail-item">
                  <label>Type:</label>
                  <span className="capitalize">{selectedEntry.project_type}</span>
                </div>
                <div className="detail-item">
                  <label>Completed:</label>
                  <span>{formatDate(selectedEntry.completion_date)}</span>
                </div>
                <div className="detail-item">
                  <label>Highlight:</label>
                  <span>{selectedEntry.highlight_stat}</span>
                </div>
              </div>

              <div className="detail-section">
                <h4>Description</h4>
                <p>{selectedEntry.description}</p>
              </div>

              {selectedEntry.testimonial && (
                <div className="detail-section">
                  <h4>Client Testimonial</h4>
                  <blockquote>"{selectedEntry.testimonial.text}"</blockquote>
                  <p className="testimonial-author">
                    – {selectedEntry.testimonial.client_name} ({selectedEntry.testimonial.rating}
                    /5 ⭐)
                  </p>
                </div>
              )}

              {selectedEntry.photos && selectedEntry.photos.length > 0 && (
                <div className="detail-section">
                  <h4>Photos ({selectedEntry.photos.length})</h4>
                  <div className="photos-grid">
                    {selectedEntry.photos.map((photo, idx) => (
                      <div key={idx} className="photo-item">
                        <img src={photo.url} alt={photo.caption || `Photo ${idx + 1}`} />
                        {photo.caption && <p>{photo.caption}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Certifications Tab */}
      {activeTab === 'certifications' && (
        <div className="portfolio-content">
          <div className="certifications-grid">
            {certifications.length === 0 ? (
              <div className="empty-state">
                <p>No certifications added yet.</p>
              </div>
            ) : (
              certifications.map((cert) => (
                <div key={cert.id} className={`cert-card cert-${cert.status}`}>
                  {cert.badge_url && <img src={cert.badge_url} alt={cert.name} />}
                  <div className="cert-info">
                    <h4>{cert.name}</h4>
                    {cert.number && <p className="cert-number">{cert.number}</p>}
                    {cert.issuing_body && (
                      <p className="cert-issuer">{cert.issuing_body}</p>
                    )}
                    {cert.expiration_date && (
                      <p className="cert-expiration">
                        Expires: {formatDate(cert.expiration_date)}
                      </p>
                    )}
                    <div className={`cert-status ${cert.status}`}>
                      {cert.status === 'active' && '✓ Active'}
                      {cert.status === 'expired' && '⚠️ Expired'}
                      {cert.status === 'in_progress' && '⏳ In Progress'}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* C-10 License Info */}
          <div className="license-info">
            <h3>🏢 California C-10 License</h3>
            <div className="license-card">
              <p>License #: 1151468</p>
              <a
                href="https://www.cslb.ca.gov"
                target="_blank"
                rel="noopener noreferrer"
                className="verify-link"
              >
                Verify on CSLB →
              </a>
            </div>
          </div>

          {/* Certifications Summary */}
          <div className="certs-summary">
            <h3>📋 Professional Certifications</h3>
            <ul>
              <li>✓ EES Sales Certification</li>
              <li>✓ EES Design Certification</li>
              <li>⏳ NABCEP Solar Certification (In Progress)</li>
              <li>✓ Insurance & Bonding</li>
            </ul>
          </div>
        </div>
      )}

      {/* Preview Tab */}
      {activeTab === 'preview' && (
        <div className="portfolio-content preview-tab">
          <div className="preview-info">
            <p>Preview how your portfolio looks on your website or customer portal:</p>
          </div>
          <div className="preview-container">
            <iframe
              srcDoc={showCaseHTML}
              title="Portfolio Preview"
              className="preview-iframe"
            />
          </div>
          <div className="preview-actions">
            <button
              className="btn btn-primary"
              onClick={() => {
                navigator.clipboard.writeText(showCaseHTML);
                alert('HTML copied to clipboard!');
              }}
            >
              📋 Copy HTML
            </button>
            <a
              href={`data:text/html;charset=utf-8,${encodeURIComponent(showCaseHTML)}`}
              download="portfolio.html"
              className="btn btn-secondary"
            >
              📥 Download HTML
            </a>
          </div>
        </div>
      )}

      {/* Add Entry Modal */}
      {showAddModal && (
        <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Add Portfolio Entry</h3>
            <p>Select a completed project to add to your portfolio:</p>
            <div className="project-list">
              {completedProjects.length === 0 ? (
                <p className="no-projects">No completed projects available</p>
              ) : (
                completedProjects.map((project) => (
                  <div key={project.id} className="project-item">
                    <div>
                      <h4>{project.name}</h4>
                      <p>{project.type}</p>
                    </div>
                    <button
                      className="btn btn-sm btn-primary"
                      onClick={() => handleAddPortfolioEntry(project.id)}
                      disabled={loading}
                    >
                      Add
                    </button>
                  </div>
                ))
              )}
            </div>
            <button
              className="btn btn-secondary modal-close"
              onClick={() => setShowAddModal(false)}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Share Modal */}
      {shareModalEntry && (
        <div className="modal-overlay" onClick={() => setShareModalEntry(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Share {shareModalEntry.project_name}</h3>
            <p>Choose where to share this project:</p>
            <div className="share-buttons">
              <button
                className="share-btn instagram"
                onClick={() => {
                  handleShareEntry(shareModalEntry, 'instagram');
                  setShareModalEntry(null);
                }}
              >
                📱 Instagram
              </button>
              <button
                className="share-btn facebook"
                onClick={() => {
                  handleShareEntry(shareModalEntry, 'facebook');
                  setShareModalEntry(null);
                }}
              >
                👥 Facebook
              </button>
              <button
                className="share-btn linkedin"
                onClick={() => {
                  handleShareEntry(shareModalEntry, 'linkedin');
                  setShareModalEntry(null);
                }}
              >
                💼 LinkedIn
              </button>
            </div>
            <button
              className="btn btn-secondary modal-close"
              onClick={() => setShareModalEntry(null)}
            >
              Close
            </button>
          </div>
        </div>
      )}

      <style>{`
        .hunter-portfolio-panel {
          padding: 20px;
          background: #f9f9f9;
          border-radius: 8px;
        }

        .portfolio-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 20px;
        }

        .portfolio-header h2 {
          margin: 0;
          font-size: 1.5rem;
        }

        .header-controls {
          display: flex;
          gap: 10px;
        }

        .portfolio-tabs {
          display: flex;
          gap: 10px;
          margin-bottom: 20px;
          border-bottom: 2px solid #ddd;
        }

        .tab-btn {
          padding: 10px 15px;
          background: none;
          border: none;
          border-bottom: 3px solid transparent;
          cursor: pointer;
          font-weight: 500;
          color: #666;
          transition: all 0.2s;
        }

        .tab-btn.active {
          color: #ff6b35;
          border-bottom-color: #ff6b35;
        }

        .tab-btn:hover {
          color: #ff6b35;
        }

        .portfolio-content {
          background: white;
          padding: 20px;
          border-radius: 8px;
        }

        .portfolio-filters {
          display: flex;
          gap: 10px;
          align-items: center;
          margin-bottom: 20px;
        }

        .portfolio-filters label {
          font-weight: 600;
        }

        .portfolio-filters select {
          padding: 8px 12px;
          border: 1px solid #ddd;
          border-radius: 4px;
          font-size: 0.95rem;
        }

        .portfolio-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
          gap: 15px;
          margin-bottom: 30px;
        }

        .portfolio-card {
          background: #f5f5f5;
          border: 2px solid #eee;
          border-radius: 8px;
          overflow: hidden;
          cursor: pointer;
          transition: all 0.2s;
        }

        .portfolio-card:hover {
          border-color: #ff6b35;
          box-shadow: 0 4px 12px rgba(255, 107, 53, 0.15);
        }

        .portfolio-card.selected {
          border-color: #ff6b35;
          background: #fff8f3;
        }

        .card-thumbnail {
          position: relative;
          width: 100%;
          height: 180px;
          overflow: hidden;
          background: #e0e0e0;
        }

        .card-thumbnail img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .card-thumbnail .placeholder {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 100%;
          height: 100%;
          font-size: 3rem;
          background: linear-gradient(135deg, #f0f0f0, #e8e8e8);
        }

        .featured-badge {
          position: absolute;
          top: 8px;
          right: 8px;
          background: #fbbf24;
          color: #333;
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 0.8rem;
          font-weight: 600;
        }

        .card-info {
          padding: 12px;
        }

        .card-info h4 {
          margin: 0 0 4px 0;
          font-size: 1rem;
        }

        .card-info p {
          margin: 4px 0;
          font-size: 0.85rem;
          color: #666;
        }

        .card-info .location {
          color: #999;
        }

        .card-info .highlight {
          font-weight: 600;
          color: #ff6b35;
        }

        .card-info .type-badge {
          display: inline-block;
          padding: 2px 8px;
          background: #f0f0f0;
          border-radius: 3px;
          font-size: 0.75rem;
          text-transform: uppercase;
          font-weight: 600;
        }

        .card-actions {
          display: flex;
          gap: 6px;
          padding: 8px;
          border-top: 1px solid #ddd;
          background: white;
        }

        .action-btn {
          flex: 1;
          padding: 8px;
          background: #f0f0f0;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 1rem;
          transition: all 0.2s;
        }

        .action-btn:hover {
          background: #ff6b35;
          color: white;
        }

        .action-btn.featured {
          background: #fbbf24;
        }

        .action-btn.delete:hover {
          background: #ef4444;
        }

        .entry-details {
          margin-top: 30px;
          padding: 20px;
          background: #f9f9f9;
          border-radius: 8px;
        }

        .entry-details h3 {
          margin: 0 0 15px 0;
          font-size: 1.3rem;
        }

        .details-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 15px;
          margin-bottom: 20px;
        }

        .detail-item {
          display: flex;
          flex-direction: column;
        }

        .detail-item label {
          font-weight: 600;
          font-size: 0.85rem;
          color: #666;
          margin-bottom: 4px;
        }

        .detail-item span {
          font-size: 0.95rem;
        }

        .detail-section {
          margin-bottom: 20px;
        }

        .detail-section h4 {
          margin: 0 0 10px 0;
          font-size: 1rem;
        }

        .detail-section p {
          margin: 0;
          line-height: 1.6;
        }

        .detail-section blockquote {
          margin: 0 0 10px 0;
          padding: 15px;
          background: white;
          border-left: 4px solid #fbbf24;
          font-style: italic;
          color: #666;
        }

        .testimonial-author {
          margin: 0;
          font-style: normal;
          font-weight: 600;
        }

        .photos-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
          gap: 10px;
        }

        .photo-item {
          border-radius: 4px;
          overflow: hidden;
        }

        .photo-item img {
          width: 100%;
          height: 150px;
          object-fit: cover;
        }

        .photo-item p {
          padding: 8px;
          background: white;
          margin: 0;
          font-size: 0.85rem;
        }

        .certifications-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
          gap: 15px;
          margin-bottom: 30px;
        }

        .cert-card {
          padding: 15px;
          border: 2px solid #ddd;
          border-radius: 8px;
          text-align: center;
        }

        .cert-card.cert-active {
          border-color: #10b981;
          background: #f0fdf4;
        }

        .cert-card.cert-expired {
          border-color: #ef4444;
          background: #fef2f2;
        }

        .cert-card.cert-in_progress {
          border-color: #f59e0b;
          background: #fffbf0;
        }

        .cert-card img {
          max-width: 100px;
          margin-bottom: 10px;
        }

        .cert-info h4 {
          margin: 0 0 5px 0;
        }

        .cert-number {
          font-size: 0.85rem;
          color: #666;
          margin: 0;
        }

        .cert-issuer {
          font-size: 0.8rem;
          color: #999;
          margin: 0;
        }

        .cert-expiration {
          font-size: 0.8rem;
          margin: 5px 0 0 0;
        }

        .cert-status {
          margin-top: 10px;
          padding: 6px;
          border-radius: 4px;
          font-weight: 600;
          font-size: 0.85rem;
        }

        .cert-status.active {
          background: #d1fae5;
          color: #047857;
        }

        .cert-status.expired {
          background: #fee2e2;
          color: #991b1b;
        }

        .cert-status.in_progress {
          background: #fef3c7;
          color: #b45309;
        }

        .license-info {
          background: #f0f7ff;
          padding: 20px;
          border-radius: 8px;
          margin-bottom: 20px;
          border-left: 4px solid #3b82f6;
        }

        .license-card {
          background: white;
          padding: 15px;
          border-radius: 4px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .license-card p {
          margin: 0;
          font-weight: 600;
        }

        .verify-link {
          color: #3b82f6;
          text-decoration: none;
          font-weight: 600;
        }

        .verify-link:hover {
          text-decoration: underline;
        }

        .certs-summary {
          background: white;
          padding: 20px;
          border-radius: 8px;
        }

        .certs-summary h3 {
          margin: 0 0 15px 0;
        }

        .certs-summary ul {
          list-style: none;
          padding: 0;
          margin: 0;
        }

        .certs-summary li {
          padding: 10px 0;
          border-bottom: 1px solid #eee;
        }

        .certs-summary li:last-child {
          border-bottom: none;
        }

        .preview-tab {
          display: flex;
          flex-direction: column;
        }

        .preview-info {
          margin-bottom: 15px;
          padding: 12px;
          background: #e0f2fe;
          border-radius: 4px;
          color: #0369a1;
        }

        .preview-container {
          flex: 1;
          margin-bottom: 15px;
          border: 1px solid #ddd;
          border-radius: 4px;
          overflow: hidden;
        }

        .preview-iframe {
          width: 100%;
          height: 600px;
          border: none;
        }

        .preview-actions {
          display: flex;
          gap: 10px;
        }

        .modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
        }

        .modal {
          background: white;
          border-radius: 8px;
          padding: 20px;
          max-width: 500px;
          width: 90%;
          max-height: 80vh;
          overflow-y: auto;
        }

        .modal h3 {
          margin: 0 0 10px 0;
        }

        .project-list {
          margin: 15px 0;
        }

        .project-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 10px;
          border: 1px solid #ddd;
          border-radius: 4px;
          margin-bottom: 10px;
        }

        .project-item h4 {
          margin: 0;
          font-size: 0.95rem;
        }

        .project-item p {
          margin: 4px 0 0 0;
          font-size: 0.85rem;
          color: #666;
        }

        .btn {
          padding: 8px 16px;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-weight: 600;
          font-size: 0.95rem;
          transition: all 0.2s;
        }

        .btn-primary {
          background: #ff6b35;
          color: white;
        }

        .btn-primary:hover:not(:disabled) {
          background: #e55a24;
        }

        .btn-primary:disabled {
          background: #ccc;
          cursor: not-allowed;
        }

        .btn-secondary {
          background: #f0f0f0;
          color: #333;
        }

        .btn-secondary:hover {
          background: #e0e0e0;
        }

        .btn-sm {
          padding: 6px 12px;
          font-size: 0.85rem;
        }

        .modal-close {
          width: 100%;
          margin-top: 15px;
        }

        .share-buttons {
          display: flex;
          flex-direction: column;
          gap: 10px;
          margin: 15px 0;
        }

        .share-btn {
          padding: 12px;
          border: 2px solid #ddd;
          border-radius: 4px;
          background: white;
          cursor: pointer;
          font-weight: 600;
          transition: all 0.2s;
        }

        .share-btn.instagram {
          border-color: #e4405f;
          color: #e4405f;
        }

        .share-btn.instagram:hover {
          background: #e4405f;
          color: white;
        }

        .share-btn.facebook {
          border-color: #1877f2;
          color: #1877f2;
        }

        .share-btn.facebook:hover {
          background: #1877f2;
          color: white;
        }

        .share-btn.linkedin {
          border-color: #0a66c2;
          color: #0a66c2;
        }

        .share-btn.linkedin:hover {
          background: #0a66c2;
          color: white;
        }

        .loading {
          text-align: center;
          padding: 40px;
          color: #666;
        }

        .empty-state {
          text-align: center;
          padding: 40px;
          color: #999;
        }

        .no-projects {
          text-align: center;
          padding: 20px;
          color: #999;
        }

        .capitalize {
          text-transform: capitalize;
        }
      `}</style>
    </div>
  );
};

export default HunterPortfolioPanel;

// Helper function
function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date);
}
