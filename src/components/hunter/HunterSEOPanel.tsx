/**
 * HunterSEOPanel.tsx
 * 
 * SEO management sub-panel in HUNTER agent
 * Displays:
 * - Google Business section: post queue, review responses, profile health
 * - Directory tracker: grid with status badges
 * - Content generator: service page and blog post creation with preview
 * - Keyword tracker: target keywords with ranking estimates
 */

import React, { useState } from 'react';
import {
  Globe,
  MessageSquare,
  TrendingUp,
  CheckCircle,
  AlertCircle,
  Plus,
  Eye,
  Heart,
  Star,
  MapPin,
  Phone,
  FileText,
  BookOpen,
  Search,
  Settings,
  Copy,
  Download,
} from 'lucide-react';

interface GoogleBusinessPost {
  id: string;
  title: string;
  content: string;
  callToAction: string;
  scheduled: boolean;
  date: string;
}

interface ReviewItem {
  id: string;
  author: string;
  rating: number;
  review: string;
  draftResponse: string;
  responded: boolean;
}

interface DirectoryStatus {
  name: string;
  url: string;
  status: 'unclaimed' | 'claimed' | 'verified';
  reviews: number;
  rating: number | string;
  lastUpdated: string;
}

interface ServicePageDraft {
  serviceType: string;
  titleTag: string;
  preview: string;
}

interface BlogPostDraft {
  topic: string;
  title: string;
  preview: string;
}

interface KeywordTracking {
  keyword: string;
  monthlyVolume: number;
  competition: 'low' | 'medium' | 'high';
  relevance: number;
  ranking: number | null;
}

export const HunterSEOPanel: React.FC<{
  onClose?: () => void;
}> = ({ onClose }) => {
  const [activeTab, setActiveTab] = useState<'google_business' | 'directory' | 'content' | 'keywords'>('google_business');
  const [googleBusinessPosts, setGoogleBusinessPosts] = useState<GoogleBusinessPost[]>([
    {
      id: '1',
      title: 'Panel Upgrade Completed in Palm Desert',
      content: 'Just completed a 200A panel upgrade...',
      callToAction: 'If your home has an older panel, call for a free inspection.',
      scheduled: false,
      date: new Date().toISOString().split('T')[0],
    },
  ]);
  
  const [reviews, setReviews] = useState<ReviewItem[]>([
    {
      id: '1',
      author: 'John D.',
      rating: 5,
      review: 'Great service, very professional.',
      draftResponse: 'Thank you so much for the 5-star review!',
      responded: false,
    },
  ]);

  const [directories] = useState<DirectoryStatus[]>([
    { name: 'Google Business', url: 'https://google.com/business', status: 'verified', reviews: 47, rating: 4.8, lastUpdated: '2024-12-15' },
    { name: 'Yelp', url: 'https://yelp.com', status: 'verified', reviews: 32, rating: 4.7, lastUpdated: '2024-12-10' },
    { name: 'Angi (Angie\'s List)', url: 'https://angi.com', status: 'claimed', reviews: 18, rating: 4.9, lastUpdated: '2024-11-20' },
    { name: 'HomeAdvisor', url: 'https://homeadvisor.com', status: 'claimed', reviews: 15, rating: 4.6, lastUpdated: '2024-11-15' },
    { name: 'Thumbtack', url: 'https://thumbtack.com', status: 'verified', reviews: 22, rating: 4.8, lastUpdated: '2024-12-01' },
    { name: 'BBB', url: 'https://bbb.org', status: 'verified', reviews: 8, rating: 'A+', lastUpdated: '2024-12-05' },
  ]);

  const [servicePageDrafts, setServicePageDrafts] = useState<ServicePageDraft[]>([
    {
      serviceType: 'panel_upgrades',
      titleTag: 'Panel Upgrades in Desert Hot Springs | Licensed Electrician',
      preview: 'Professional electrical panel upgrades in Desert Hot Springs. Modern, safe replacements...',
    },
  ]);

  const [blogPostDrafts, setBlogPostDrafts] = useState<BlogPostDraft[]>([
    {
      topic: 'old_panel_dangers',
      title: 'Why Older Electrical Panels Are a Safety Risk',
      preview: 'Older electrical panels, especially Federal Pacific and Zinsco panels, pose significant fire risks...',
    },
  ]);

  const [keywords, setKeywords] = useState<KeywordTracking[]>([
    { keyword: 'electrician Desert Hot Springs', monthlyVolume: 320, competition: 'high', relevance: 0.95, ranking: 3 },
    { keyword: 'electrical contractor Coachella Valley', monthlyVolume: 240, competition: 'high', relevance: 0.92, ranking: 5 },
    { keyword: 'solar installer Palm Desert', monthlyVolume: 180, competition: 'medium', relevance: 0.88, ranking: null },
    { keyword: 'EV charger installation', monthlyVolume: 450, competition: 'high', relevance: 0.85, ranking: 12 },
    { keyword: 'emergency electrician 24/7', monthlyVolume: 150, competition: 'medium', relevance: 0.90, ranking: null },
  ]);

  const [showPostForm, setShowPostForm] = useState(false);
  const [showReviewForm, setShowReviewForm] = useState(false);
  const [selectedReview, setSelectedReview] = useState<string | null>(null);
  const [showServicePageForm, setShowServicePageForm] = useState(false);
  const [showBlogForm, setShowBlogForm] = useState(false);

  const handleGeneratePost = () => {
    const newPost: GoogleBusinessPost = {
      id: String(googleBusinessPosts.length + 1),
      title: 'New Project Completed',
      content: 'Recently finished a project...',
      callToAction: 'Call for your free estimate today!',
      scheduled: false,
      date: new Date().toISOString().split('T')[0],
    };
    setGoogleBusinessPosts([...googleBusinessPosts, newPost]);
    setShowPostForm(false);
  };

  const handlePublishPost = (postId: string) => {
    setGoogleBusinessPosts(
      googleBusinessPosts.map(p => p.id === postId ? { ...p, scheduled: true } : p)
    );
  };

  const handleRespondToReview = (reviewId: string) => {
    setReviews(
      reviews.map(r => r.id === reviewId ? { ...r, responded: true } : r)
    );
  };

  const handleGenerateServicePage = () => {
    const newPage: ServicePageDraft = {
      serviceType: 'ev_charger_installation',
      titleTag: 'EV Charger Installation in Desert Hot Springs | Licensed Electrician',
      preview: 'Professional EV charger installation in Desert Hot Springs. Level 1 & 2 chargers...',
    };
    setServicePageDrafts([...servicePageDrafts, newPage]);
    setShowServicePageForm(false);
  };

  const handleGenerateBlogPost = () => {
    const newPost: BlogPostDraft = {
      topic: 'nec_updates',
      title: 'Latest NEC Code Changes: What You Need to Know',
      preview: 'The National Electrical Code (NEC) is updated every 3 years. Here are the most important changes...',
    };
    setBlogPostDrafts([...blogPostDrafts, newPost]);
    setShowBlogForm(false);
  };

  const verifiedCount = directories.filter(d => d.status === 'verified').length;
  const avgRating = (directories.reduce((sum, d) => sum + (typeof d.rating === 'number' ? d.rating : 4.7), 0) / directories.length).toFixed(1);
  const totalReviews = directories.reduce((sum, d) => sum + d.reviews, 0);

  return (
    <div className="space-y-6 p-4">
      {/* Tabs */}
      <div className="flex border-b border-gray-700 space-x-8 overflow-x-auto">
        <button
          onClick={() => setActiveTab('google_business')}
          className={`pb-3 font-medium text-sm whitespace-nowrap ${
            activeTab === 'google_business'
              ? 'border-b-2 border-blue-500 text-blue-400'
              : 'text-gray-400 hover:text-gray-300'
          }`}
        >
          <Globe className="inline mr-2 h-4 w-4" />
          Google Business
        </button>
        <button
          onClick={() => setActiveTab('directory')}
          className={`pb-3 font-medium text-sm whitespace-nowrap ${
            activeTab === 'directory'
              ? 'border-b-2 border-blue-500 text-blue-400'
              : 'text-gray-400 hover:text-gray-300'
          }`}
        >
          <MapPin className="inline mr-2 h-4 w-4" />
          Directories
        </button>
        <button
          onClick={() => setActiveTab('content')}
          className={`pb-3 font-medium text-sm whitespace-nowrap ${
            activeTab === 'content'
              ? 'border-b-2 border-blue-500 text-blue-400'
              : 'text-gray-400 hover:text-gray-300'
          }`}
        >
          <FileText className="inline mr-2 h-4 w-4" />
          Content
        </button>
        <button
          onClick={() => setActiveTab('keywords')}
          className={`pb-3 font-medium text-sm whitespace-nowrap ${
            activeTab === 'keywords'
              ? 'border-b-2 border-blue-500 text-blue-400'
              : 'text-gray-400 hover:text-gray-300'
          }`}
        >
          <Search className="inline mr-2 h-4 w-4" />
          Keywords
        </button>
      </div>

      {/* Google Business Tab */}
      {activeTab === 'google_business' && (
        <div className="space-y-6">
          {/* Profile Health Score */}
          <div className="bg-gradient-to-r from-blue-900/30 to-purple-900/30 border border-blue-700/50 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-blue-300">Profile Health Score</h3>
              <span className="text-2xl font-bold text-blue-400">{verifiedCount === directories.length ? '95' : '78'}</span>
            </div>
            <div className="flex items-center space-x-3 text-sm">
              <div className="flex items-center">
                <Star className="h-4 w-4 text-yellow-400 mr-1" fill="currentColor" />
                <span>{avgRating} avg rating</span>
              </div>
              <span className="text-gray-500">•</span>
              <span>{totalReviews} total reviews</span>
              <span className="text-gray-500">•</span>
              <span>{verifiedCount}/{directories.length} verified</span>
            </div>
          </div>

          {/* Post Queue */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-lg">Post Queue</h3>
              <button
                onClick={() => setShowPostForm(!showPostForm)}
                className="bg-blue-600 hover:bg-blue-700 px-3 py-1 rounded text-sm flex items-center space-x-1"
              >
                <Plus className="h-4 w-4" />
                <span>Generate Post</span>
              </button>
            </div>

            {showPostForm && (
              <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 mb-3">
                <p className="text-sm text-gray-400 mb-3">Select a completed job to generate a Google Business post</p>
                <div className="flex space-x-2">
                  <select className="flex-1 bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm">
                    <option>Panel Upgrade - 2024-12-15</option>
                    <option>EV Charger Install - 2024-12-10</option>
                    <option>Solar Work - 2024-12-05</option>
                  </select>
                  <button
                    onClick={handleGeneratePost}
                    className="bg-green-600 hover:bg-green-700 px-4 py-2 rounded text-sm"
                  >
                    Generate
                  </button>
                </div>
              </div>
            )}

            <div className="space-y-3">
              {googleBusinessPosts.map(post => (
                <div key={post.id} className="bg-gray-800/40 border border-gray-700 rounded-lg p-3">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <h4 className="font-semibold text-sm">{post.title}</h4>
                      <p className="text-xs text-gray-400 mt-1">{post.content.substring(0, 60)}...</p>
                    </div>
                    <span className={`text-xs px-2 py-1 rounded whitespace-nowrap ${
                      post.scheduled 
                        ? 'bg-green-900/30 text-green-300' 
                        : 'bg-yellow-900/30 text-yellow-300'
                    }`}>
                      {post.scheduled ? 'Published' : 'Draft'}
                    </span>
                  </div>
                  <div className="flex space-x-2 text-xs">
                    <button className="text-gray-400 hover:text-gray-300">
                      <Eye className="inline h-4 w-4 mr-1" />
                      Preview
                    </button>
                    {!post.scheduled && (
                      <button
                        onClick={() => handlePublishPost(post.id)}
                        className="text-blue-400 hover:text-blue-300"
                      >
                        <CheckCircle className="inline h-4 w-4 mr-1" />
                        Publish
                      </button>
                    )}
                    <button className="text-gray-400 hover:text-gray-300">
                      <Download className="inline h-4 w-4 mr-1" />
                      Export
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Review Responses */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-lg">Review Responses</h3>
              <span className="text-xs bg-gray-700 px-2 py-1 rounded">{reviews.length} reviews</span>
            </div>
            <div className="space-y-3">
              {reviews.map(review => (
                <div key={review.id} className="bg-gray-800/40 border border-gray-700 rounded-lg p-3">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="font-semibold text-sm">{review.author}</span>
                        <div className="flex space-x-0.5">
                          {[...Array(review.rating)].map((_, i) => (
                            <Star key={i} className="h-3 w-3 text-yellow-400" fill="currentColor" />
                          ))}
                        </div>
                      </div>
                      <p className="text-xs text-gray-400 mt-1">"{review.review}"</p>
                    </div>
                    <span className={`text-xs px-2 py-1 rounded whitespace-nowrap ${
                      review.responded 
                        ? 'bg-green-900/30 text-green-300' 
                        : 'bg-yellow-900/30 text-yellow-300'
                    }`}>
                      {review.responded ? 'Responded' : 'Pending'}
                    </span>
                  </div>
                  {review.responded && (
                    <p className="text-xs bg-gray-900/50 rounded p-2 mb-2 text-gray-300">
                      Response: {review.draftResponse}
                    </p>
                  )}
                  {!review.responded && (
                    <div className="flex space-x-2 text-xs">
                      <button
                        onClick={() => setSelectedReview(review.id)}
                        className="text-blue-400 hover:text-blue-300 flex-1 bg-gray-700 hover:bg-gray-600 px-2 py-1 rounded"
                      >
                        <MessageSquare className="inline h-3 w-3 mr-1" />
                        Draft Response
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Directory Tab */}
      {activeTab === 'directory' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {directories.map((dir, idx) => (
              <div key={idx} className="bg-gray-800/40 border border-gray-700 rounded-lg p-3">
                <div className="flex items-start justify-between mb-2">
                  <h4 className="font-semibold text-sm">{dir.name}</h4>
                  <span className={`text-xs px-2 py-1 rounded flex items-center space-x-1 ${
                    dir.status === 'verified' ? 'bg-green-900/30 text-green-300' :
                    dir.status === 'claimed' ? 'bg-blue-900/30 text-blue-300' :
                    'bg-gray-700 text-gray-300'
                  }`}>
                    <CheckCircle className="h-3 w-3" />
                    {dir.status.charAt(0).toUpperCase() + dir.status.slice(1)}
                  </span>
                </div>
                <div className="space-y-1 text-xs text-gray-400">
                  <div className="flex items-center space-x-2">
                    <Star className="h-3 w-3 text-yellow-400" fill="currentColor" />
                    <span>{dir.rating} rating</span>
                    <span className="text-gray-500">•</span>
                    <span>{dir.reviews} reviews</span>
                  </div>
                  <p className="text-gray-500">Updated: {dir.lastUpdated}</p>
                </div>
                <button className="mt-2 text-xs text-blue-400 hover:text-blue-300">
                  View Profile →
                </button>
              </div>
            ))}
          </div>

          {/* NAP Consistency Report */}
          <div className="bg-gray-800/40 border border-gray-700 rounded-lg p-4">
            <h3 className="font-semibold text-sm mb-3">NAP Consistency Check</h3>
            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-gray-400">All directories consistent</span>
                <span className="text-green-400">✓ Verified</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-400">Last checked</span>
                <span className="text-gray-400">2024-12-15</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Content Tab */}
      {activeTab === 'content' && (
        <div className="space-y-6">
          {/* Service Pages */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-lg">Service Pages</h3>
              <button
                onClick={() => setShowServicePageForm(!showServicePageForm)}
                className="bg-blue-600 hover:bg-blue-700 px-3 py-1 rounded text-sm flex items-center space-x-1"
              >
                <Plus className="h-4 w-4" />
                <span>Create Page</span>
              </button>
            </div>

            {showServicePageForm && (
              <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 mb-3">
                <p className="text-sm text-gray-400 mb-3">Select service type to generate optimized page</p>
                <select className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm mb-3">
                  <option>Panel Upgrades</option>
                  <option>EV Charger Installation</option>
                  <option>Solar Electrical</option>
                  <option>Commercial TI</option>
                  <option>Emergency Service</option>
                </select>
                <button
                  onClick={handleGenerateServicePage}
                  className="w-full bg-green-600 hover:bg-green-700 px-4 py-2 rounded text-sm"
                >
                  Generate Page
                </button>
              </div>
            )}

            <div className="space-y-3">
              {servicePageDrafts.map((page, idx) => (
                <div key={idx} className="bg-gray-800/40 border border-gray-700 rounded-lg p-3">
                  <h4 className="font-semibold text-sm mb-1">{page.serviceType.replace(/_/g, ' ')}</h4>
                  <p className="text-xs text-gray-400 mb-2">{page.titleTag}</p>
                  <p className="text-xs text-gray-400 mb-3">{page.preview}</p>
                  <div className="flex space-x-2 text-xs">
                    <button className="text-blue-400 hover:text-blue-300">
                      <Eye className="inline h-4 w-4 mr-1" />
                      Preview
                    </button>
                    <button className="text-gray-400 hover:text-gray-300">
                      <Copy className="inline h-4 w-4 mr-1" />
                      Copy Content
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Blog Posts */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-lg">Blog Posts</h3>
              <button
                onClick={() => setShowBlogForm(!showBlogForm)}
                className="bg-blue-600 hover:bg-blue-700 px-3 py-1 rounded text-sm flex items-center space-x-1"
              >
                <Plus className="h-4 w-4" />
                <span>Create Post</span>
              </button>
            </div>

            {showBlogForm && (
              <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 mb-3">
                <p className="text-sm text-gray-400 mb-3">Select topic to generate blog post</p>
                <select className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm mb-3">
                  <option>Old Panel Dangers</option>
                  <option>EV Charging Guide</option>
                  <option>Solar Electrical FAQ</option>
                  <option>Latest NEC Updates</option>
                  <option>Receptacle Safety</option>
                </select>
                <button
                  onClick={handleGenerateBlogPost}
                  className="w-full bg-green-600 hover:bg-green-700 px-4 py-2 rounded text-sm"
                >
                  Generate Post
                </button>
              </div>
            )}

            <div className="space-y-3">
              {blogPostDrafts.map((post, idx) => (
                <div key={idx} className="bg-gray-800/40 border border-gray-700 rounded-lg p-3">
                  <h4 className="font-semibold text-sm mb-1">{post.title}</h4>
                  <p className="text-xs text-gray-400 mb-3">{post.preview}</p>
                  <div className="flex space-x-2 text-xs">
                    <button className="text-blue-400 hover:text-blue-300">
                      <Eye className="inline h-4 w-4 mr-1" />
                      Preview
                    </button>
                    <button className="text-gray-400 hover:text-gray-300">
                      <Copy className="inline h-4 w-4 mr-1" />
                      Copy Content
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Keywords Tab */}
      {activeTab === 'keywords' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-lg">Target Keywords</h3>
            <button className="text-gray-400 hover:text-gray-300">
              <Settings className="h-5 w-5" />
            </button>
          </div>

          <div className="space-y-2">
            {keywords.map((kw, idx) => (
              <div key={idx} className="bg-gray-800/40 border border-gray-700 rounded-lg p-3">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h4 className="font-semibold text-sm">{kw.keyword}</h4>
                    <div className="flex items-center space-x-3 mt-1 text-xs text-gray-400">
                      <span>{kw.monthlyVolume} searches/mo</span>
                      <span className={`px-2 py-0.5 rounded ${
                        kw.competition === 'low' ? 'bg-green-900/30 text-green-300' :
                        kw.competition === 'medium' ? 'bg-yellow-900/30 text-yellow-300' :
                        'bg-red-900/30 text-red-300'
                      }`}>
                        {kw.competition} competition
                      </span>
                    </div>
                  </div>
                  <div className="text-right">
                    {kw.ranking ? (
                      <div className="font-semibold text-sm text-blue-400">#{kw.ranking}</div>
                    ) : (
                      <div className="text-xs text-gray-400">Not ranked</div>
                    )}
                    <div className="text-xs text-gray-400 mt-1">
                      Relevance: {Math.round(kw.relevance * 100)}%
                    </div>
                  </div>
                </div>
                <div className="flex space-x-2 text-xs">
                  <button className="text-gray-400 hover:text-gray-300">
                    <TrendingUp className="inline h-3 w-3 mr-1" />
                    Track
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default HunterSEOPanel;
