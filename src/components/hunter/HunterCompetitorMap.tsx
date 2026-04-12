/**
 * HUNTER Competitor Map Component
 * Visual map or list showing competitor positions in service area
 * Color coded: green (weak/opportunity), amber (moderate), red (strong competitor)
 * Gap zones highlighted with opportunity descriptions
 */

import React, { useState, useEffect } from 'react';
import {
  HunterCompetitorScanner,
  CompetitorLocation,
  CompetitorGap,
  CompetitorScanResult,
  CompetitorStrength,
  GapType,
} from '../../services/hunter/HunterCompetitorScanner';

// =====================================================
// Types
// =====================================================

interface HunterCompetitorMapProps {
  serviceArea: string;
  radiusMiles?: number;
  onGapSelected?: (gap: CompetitorGap) => void;
  onCompetitorSelected?: (competitor: CompetitorLocation) => void;
}

type MapViewType = 'map' | 'list';
type FilterType = 'all' | 'weak' | 'gaps';

// =====================================================
// Component
// =====================================================

export const HunterCompetitorMap: React.FC<HunterCompetitorMapProps> = ({
  serviceArea,
  radiusMiles = 20,
  onGapSelected,
  onCompetitorSelected,
}) => {
  const [viewType, setViewType] = useState<MapViewType>('list');
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [scanResult, setScanResult] = useState<CompetitorScanResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedCompetitor, setSelectedCompetitor] = useState<CompetitorLocation | null>(null);
  const [selectedGap, setSelectedGap] = useState<CompetitorGap | null>(null);
  const [expandedGapId, setExpandedGapId] = useState<string | null>(null);

  const scanner = new HunterCompetitorScanner();

  // Perform initial scan on mount
  useEffect(() => {
    performScan();
  }, [serviceArea, radiusMiles]);

  const performScan = async () => {
    setIsLoading(true);
    try {
      const [googleCompetitors, yelpCompetitors] = await Promise.all([
        scanner.scanGoogleMaps(serviceArea, radiusMiles),
        scanner.scanYelpCompetitors(serviceArea),
      ]);

      const allCompetitors = [...googleCompetitors, ...yelpCompetitors];
      const gaps = await scanner.detectCompetitorGaps(allCompetitors, serviceArea, radiusMiles);

      const summary = {
        totalCompetitors: allCompetitors.length,
        weakCompetitors: allCompetitors.filter((c) => c.strength === CompetitorStrength.WEAK)
          .length,
        emergencyServiceCoverage: allCompetitors.some((c) => c.hours?.includes('24')),
        specialtiesAvailable: extractSpecialties(allCompetitors),
        topGapTypes: Array.from(new Set(gaps.map((g) => g.type))),
      };

      setScanResult({
        timestamp: new Date().toISOString(),
        serviceArea,
        radiusMiles,
        competitors: allCompetitors,
        gaps,
        summary,
      });
    } catch (error) {
      console.error('Competitor scan failed:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const extractSpecialties = (competitors: CompetitorLocation[]): string[] => {
    const specialties = new Set<string>();
    competitors.forEach((c) => {
      if (c.name.toLowerCase().includes('solar')) specialties.add('Solar');
      if (c.name.toLowerCase().includes('ev') || c.name.toLowerCase().includes('charger')) {
        specialties.add('EV Charger');
      }
      if (c.name.toLowerCase().includes('panel')) specialties.add('Panels');
    });
    return Array.from(specialties);
  };

  const getCompetitorColor = (competitor: CompetitorLocation): string => {
    switch (competitor.strength) {
      case CompetitorStrength.WEAK:
        return 'bg-green-50 border-green-300';
      case CompetitorStrength.MODERATE:
        return 'bg-yellow-50 border-yellow-300';
      case CompetitorStrength.STRONG:
        return 'bg-red-50 border-red-300';
      default:
        return 'bg-gray-50 border-gray-300';
    }
  };

  const getCompetitorBadgeColor = (competitor: CompetitorLocation): string => {
    switch (competitor.strength) {
      case CompetitorStrength.WEAK:
        return 'bg-green-100 text-green-800';
      case CompetitorStrength.MODERATE:
        return 'bg-yellow-100 text-yellow-800';
      case CompetitorStrength.STRONG:
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getGapIcon = (type: GapType): string => {
    switch (type) {
      case GapType.UNDERSERVED_AREA:
        return '📍';
      case GapType.WEAK_COMPETITOR:
        return '⚠️';
      case GapType.NO_EMERGENCY:
        return '🚨';
      case GapType.SPECIALTY_GAP:
        return '⭐';
      case GapType.CLOSED_BUSINESS:
        return '🔒';
      default:
        return '🎯';
    }
  };

  const filteredCompetitors =
    filterType === 'weak'
      ? scanResult?.competitors.filter((c) => c.strength === CompetitorStrength.WEAK) || []
      : scanResult?.competitors || [];

  const filteredGaps =
    filterType === 'gaps'
      ? scanResult?.gaps || []
      : filterType === 'weak'
        ? (scanResult?.gaps.filter((g) => g.type === GapType.WEAK_COMPETITOR) || [])
        : scanResult?.gaps || [];

  if (isLoading) {
    return (
      <div className="p-8 text-center">
        <div className="inline-block">
          <div className="animate-spin h-8 w-8 border-b-2 border-blue-500 rounded-full mb-4"></div>
          <p className="text-gray-600">Scanning Google Maps and Yelp...</p>
        </div>
      </div>
    );
  }

  if (!scanResult) {
    return (
      <div className="p-8 text-center text-gray-500">
        <p>No scan results available</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      {/* Header */}
      <div className="flex justify-between items-start mb-6 pb-4 border-b border-gray-200">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Competitor Intelligence Map</h2>
          <p className="text-sm text-gray-600 mt-1">
            {serviceArea} • {radiusMiles} mile radius • Last scan: {new Date(scanResult.timestamp).toLocaleString()}
          </p>
        </div>
        <button
          onClick={performScan}
          disabled={isLoading}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          🔄 Refresh Scan
        </button>
      </div>

      {/* Controls */}
      <div className="flex gap-4 mb-6">
        <div className="flex gap-2">
          <button
            onClick={() => setViewType('list')}
            className={`px-4 py-2 rounded-lg font-medium ${
              viewType === 'list'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            📋 List View
          </button>
          <button
            onClick={() => setViewType('map')}
            className={`px-4 py-2 rounded-lg font-medium ${
              viewType === 'map'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            🗺️ Map View
          </button>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => setFilterType('all')}
            className={`px-4 py-2 rounded-lg font-medium ${
              filterType === 'all'
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            All ({scanResult.competitors.length})
          </button>
          <button
            onClick={() => setFilterType('weak')}
            className={`px-4 py-2 rounded-lg font-medium ${
              filterType === 'weak'
                ? 'bg-green-600 text-white'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            🎯 Weak ({scanResult.summary.weakCompetitors})
          </button>
          <button
            onClick={() => setFilterType('gaps')}
            className={`px-4 py-2 rounded-lg font-medium ${
              filterType === 'gaps'
                ? 'bg-orange-600 text-white'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            💡 Gaps ({scanResult.gaps.length})
          </button>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
          <div className="text-sm text-gray-600">Total Competitors</div>
          <div className="text-2xl font-bold text-blue-600">{scanResult.summary.totalCompetitors}</div>
        </div>
        <div className="bg-green-50 p-4 rounded-lg border border-green-200">
          <div className="text-sm text-gray-600">Weak Competitors</div>
          <div className="text-2xl font-bold text-green-600">{scanResult.summary.weakCompetitors}</div>
        </div>
        <div className={`p-4 rounded-lg border ${scanResult.summary.emergencyServiceCoverage ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
          <div className="text-sm text-gray-600">24/7 Emergency</div>
          <div className={`text-2xl font-bold ${scanResult.summary.emergencyServiceCoverage ? 'text-green-600' : 'text-red-600'}`}>
            {scanResult.summary.emergencyServiceCoverage ? '✓' : '✗'}
          </div>
        </div>
        <div className="bg-purple-50 p-4 rounded-lg border border-purple-200">
          <div className="text-sm text-gray-600">Gaps Found</div>
          <div className="text-2xl font-bold text-purple-600">{scanResult.gaps.length}</div>
        </div>
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-3 gap-6">
        {/* Competitors List/Map */}
        <div className="col-span-2">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            {filterType === 'gaps' ? 'Market Gaps' : 'Competitors'}
          </h3>

          {filterType === 'gaps' ? (
            // Gap Zones
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {filteredGaps.map((gap) => (
                <div
                  key={gap.id}
                  onClick={() => {
                    setSelectedGap(gap);
                    setExpandedGapId(expandedGapId === gap.id ? null : gap.id);
                    onGapSelected?.(gap);
                  }}
                  className="p-4 bg-gradient-to-r from-orange-50 to-yellow-50 border border-orange-300 rounded-lg cursor-pointer hover:shadow-md transition"
                >
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex items-start gap-3">
                      <span className="text-2xl">{getGapIcon(gap.type)}</span>
                      <div>
                        <h4 className="font-semibold text-gray-900">{gap.area}</h4>
                        <p className="text-sm text-gray-600">{gap.type.replace(/_/g, ' ')}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-bold text-orange-600">{gap.opportunityScore}</div>
                      <div className="text-xs text-gray-500">opportunity</div>
                    </div>
                  </div>

                  <p className="text-sm text-gray-700 mb-3">{gap.description}</p>

                  <div className="flex justify-between text-xs text-gray-600">
                    <span>Est. {gap.estimatedLeadVolume} leads</span>
                    <span>{gap.radius} mile radius</span>
                  </div>

                  {expandedGapId === gap.id && (
                    <div className="mt-4 pt-4 border-t border-orange-200">
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        {gap.details.competitorCount && (
                          <div>
                            <span className="text-gray-600">Competitors:</span>{' '}
                            <span className="font-semibold">{gap.details.competitorCount}</span>
                          </div>
                        )}
                        {gap.details.avgRating && (
                          <div>
                            <span className="text-gray-600">Avg Rating:</span>{' '}
                            <span className="font-semibold">{gap.details.avgRating.toFixed(1)}★</span>
                          </div>
                        )}
                        {gap.details.specialtyGaps && gap.details.specialtyGaps.length > 0 && (
                          <div className="col-span-2">
                            <span className="text-gray-600">Missing:</span>{' '}
                            <span className="font-semibold">{gap.details.specialtyGaps.join(', ')}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            // Competitors List
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {filteredCompetitors.map((competitor) => (
                <div
                  key={competitor.id}
                  onClick={() => {
                    setSelectedCompetitor(competitor);
                    onCompetitorSelected?.(competitor);
                  }}
                  className={`p-4 border-2 rounded-lg cursor-pointer hover:shadow-md transition ${getCompetitorColor(competitor)}`}
                >
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <h4 className="font-semibold text-gray-900">{competitor.name}</h4>
                      {competitor.address && (
                        <p className="text-sm text-gray-600">{competitor.address}</p>
                      )}
                    </div>
                    <span className={`px-3 py-1 rounded-full text-sm font-medium ${getCompetitorBadgeColor(competitor)}`}>
                      {competitor.strength}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-sm mb-3">
                    <div>
                      <span className="text-gray-600">Rating:</span>{' '}
                      <span className="font-semibold">{competitor.rating.toFixed(1)}★ ({competitor.reviewCount})</span>
                    </div>
                    <div>
                      <span className="text-gray-600">Source:</span>{' '}
                      <span className="font-semibold">{competitor.source === 'google_maps' ? 'Google' : 'Yelp'}</span>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 text-xs">
                    {competitor.website && (
                      <span className="bg-blue-100 text-blue-700 px-2 py-1 rounded">🌐 Website</span>
                    )}
                    {!competitor.website && <span className="bg-red-100 text-red-700 px-2 py-1 rounded">❌ No Website</span>}
                    {competitor.phone && (
                      <span className="bg-green-100 text-green-700 px-2 py-1 rounded">📞 {competitor.phone}</span>
                    )}
                    {competitor.photoCount > 0 && (
                      <span className="bg-purple-100 text-purple-700 px-2 py-1 rounded">📸 {competitor.photoCount} photos</span>
                    )}
                    {competitor.hours && competitor.hours.includes('24') && (
                      <span className="bg-orange-100 text-orange-700 px-2 py-1 rounded">🕐 24/7</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Detail Panel */}
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Details</h3>

          {selectedGap ? (
            <div className="p-4 bg-orange-50 border border-orange-300 rounded-lg">
              <h4 className="font-semibold text-gray-900 mb-3">{selectedGap.area}</h4>
              <div className="space-y-2 text-sm">
                <div>
                  <span className="text-gray-600">Type:</span>{' '}
                  <span className="font-semibold">{selectedGap.type.replace(/_/g, ' ')}</span>
                </div>
                <div>
                  <span className="text-gray-600">Opportunity Score:</span>{' '}
                  <span className="font-semibold text-orange-600">{selectedGap.opportunityScore}/100</span>
                </div>
                <div>
                  <span className="text-gray-600">Est. Leads:</span>{' '}
                  <span className="font-semibold">{selectedGap.estimatedLeadVolume}</span>
                </div>
                <div className="pt-2 border-t border-orange-200">
                  <p className="text-gray-700">{selectedGap.description}</p>
                </div>
              </div>
            </div>
          ) : selectedCompetitor ? (
            <div className={`p-4 border-2 rounded-lg ${getCompetitorColor(selectedCompetitor)}`}>
              <h4 className="font-semibold text-gray-900 mb-3">{selectedCompetitor.name}</h4>
              <div className="space-y-2 text-sm">
                {selectedCompetitor.address && (
                  <div>
                    <span className="text-gray-600">Address:</span>
                    <p className="font-semibold">{selectedCompetitor.address}</p>
                  </div>
                )}
                <div>
                  <span className="text-gray-600">Rating:</span>{' '}
                  <span className="font-semibold">{selectedCompetitor.rating.toFixed(1)}★</span>
                </div>
                <div>
                  <span className="text-gray-600">Reviews:</span>{' '}
                  <span className="font-semibold">{selectedCompetitor.reviewCount}</span>
                </div>
                {selectedCompetitor.phone && (
                  <div>
                    <span className="text-gray-600">Phone:</span>
                    <p className="font-semibold">{selectedCompetitor.phone}</p>
                  </div>
                )}
                {selectedCompetitor.website && (
                  <div>
                    <span className="text-gray-600">Website:</span>
                    <p className="font-semibold text-blue-600">{selectedCompetitor.website}</p>
                  </div>
                )}
                {selectedCompetitor.hours && (
                  <div>
                    <span className="text-gray-600">Hours:</span>
                    <p className="font-semibold">{selectedCompetitor.hours}</p>
                  </div>
                )}
                <div className="pt-2 border-t">
                  <span className="text-gray-600">Strength:</span>
                  <p className={`font-semibold mt-1 ${getCompetitorBadgeColor(selectedCompetitor)}`}>
                    {selectedCompetitor.strength}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-4 bg-gray-50 border border-gray-300 rounded-lg text-center text-gray-600">
              Click a competitor or gap to view details
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default HunterCompetitorMap;
