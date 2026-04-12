/**
 * SPARK Connection Monitor Component
 * 
 * React component displaying connection status in the SPARK panel header.
 * Shows:
 * - Visual indicator: green dot (online), amber dot (slow), red dot (offline)
 * - Tooltip with detailed status
 * - Tap to expand: queued items count, last sync time
 */

import React, { useEffect, useState } from 'react';
import { sparkOfflineCapture, ConnectionState } from './SparkOfflineCapture';

interface ConnectionMonitorProps {
  className?: string;
  showLabel?: boolean;
}

interface QueueStatus {
  audioChunks: number;
  fieldNotes: number;
  leadChanges: number;
  total: number;
}

/**
 * Connection Monitor Component
 * 
 * Usage:
 * ```tsx
 * <SparkConnectionMonitor className="ml-2" showLabel={true} />
 * ```
 */
export const SparkConnectionMonitor: React.FC<ConnectionMonitorProps> = ({
  className = '',
  showLabel = false,
}) => {
  const [connectionState, setConnectionState] = useState<ConnectionState>('online');
  const [queueStatus, setQueueStatus] = useState<QueueStatus>({
    audioChunks: 0,
    fieldNotes: 0,
    leadChanges: 0,
    total: 0,
  });
  const [showDetails, setShowDetails] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<number | null>(null);

  // Initialize and subscribe to connection changes
  useEffect(() => {
    const initService = async () => {
      try {
        await sparkOfflineCapture.initialize();
        setConnectionState(sparkOfflineCapture.getConnectionState());

        // Update queue counts
        const counts = await sparkOfflineCapture.getQueueCounts();
        setQueueStatus({
          audioChunks: counts.audioChunks,
          fieldNotes: counts.fieldNotes,
          leadChanges: counts.leadChanges,
          total: counts.audioChunks + counts.fieldNotes + counts.leadChanges,
        });
      } catch (error) {
        console.error('Failed to initialize SparkOfflineCapture:', error);
      }
    };

    initService();
  }, []);

  // Listen for connection state changes
  useEffect(() => {
    const handler = ((event: any) => {
      const newState = event.detail?.state as ConnectionState;
      if (newState) {
        setConnectionState(newState);
      }
    }) as EventListener;

    window.addEventListener('spark:connection-change', handler);

    return () => {
      window.removeEventListener('spark:connection-change', handler);
    };
  }, []);

  // Periodically update queue counts
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const counts = await sparkOfflineCapture.getQueueCounts();
        setQueueStatus({
          audioChunks: counts.audioChunks,
          fieldNotes: counts.fieldNotes,
          leadChanges: counts.leadChanges,
          total: counts.audioChunks + counts.fieldNotes + counts.leadChanges,
        });
      } catch (error) {
        console.error('Failed to update queue counts:', error);
      }
    }, 5000); // Update every 5 seconds

    return () => clearInterval(interval);
  }, []);

  // Subscribe to sync progress
  useEffect(() => {
    const unsubscribe = sparkOfflineCapture.onSyncProgress((progress) => {
      if (progress.status === 'complete') {
        setLastSyncTime(Date.now());
        // Refresh queue counts after sync
        setTimeout(() => {
          sparkOfflineCapture.getQueueCounts().then(counts => {
            setQueueStatus({
              audioChunks: counts.audioChunks,
              fieldNotes: counts.fieldNotes,
              leadChanges: counts.leadChanges,
              total: counts.audioChunks + counts.fieldNotes + counts.leadChanges,
            });
          });
        }, 1000);
      }
    });

    return () => unsubscribe();
  }, []);

  // Determine indicator color and label
  const getIndicatorStyle = () => {
    switch (connectionState) {
      case 'online':
        return { color: '#10b981', label: 'Connected' }; // green
      case 'slow':
        return { color: '#f59e0b', label: 'Slow connection — some features limited' }; // amber
      case 'offline':
        return { color: '#ef4444', label: 'Offline — capturing locally' }; // red
      default:
        return { color: '#6b7280', label: 'Unknown' }; // gray
    }
  };

  const indicator = getIndicatorStyle();
  const hasQueuedItems = queueStatus.total > 0;

  const formatTime = (timestamp: number) => {
    const now = Date.now();
    const diff = now - timestamp;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (seconds < 60) return `${seconds}s ago`;
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return new Date(timestamp).toLocaleString();
  };

  return (
    <div className={`flex items-center gap-2 relative ${className}`}>
      {/* Indicator Dot */}
      <div
        className="relative cursor-pointer"
        title={indicator.label}
        onClick={() => hasQueuedItems && setShowDetails(!showDetails)}
      >
        <div
          className="w-3 h-3 rounded-full transition-all duration-300"
          style={{ backgroundColor: indicator.color }}
        />
        {connectionState === 'offline' && (
          <div
            className="absolute inset-0 rounded-full animate-ping"
            style={{ backgroundColor: indicator.color, opacity: 0.75 }}
          />
        )}
        {hasQueuedItems && (
          <div className="absolute -top-1 -right-1 bg-orange-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center font-bold">
            {queueStatus.total > 9 ? '9+' : queueStatus.total}
          </div>
        )}
      </div>

      {/* Status Label */}
      {showLabel && (
        <span className="text-xs font-medium" style={{ color: indicator.color }}>
          {connectionState === 'offline' && 'Offline'}
          {connectionState === 'slow' && 'Slow'}
          {connectionState === 'online' && 'Online'}
        </span>
      )}

      {/* Details Popup */}
      {showDetails && hasQueuedItems && (
        <div className="absolute top-full left-0 mt-2 bg-slate-900 text-white rounded-lg shadow-xl p-3 min-w-max z-50 border border-slate-700">
          <div className="text-sm font-semibold mb-2">Offline Queue</div>

          {queueStatus.audioChunks > 0 && (
            <div className="text-xs text-slate-300 mb-1">
              🎤 Audio chunks: {queueStatus.audioChunks}
            </div>
          )}

          {queueStatus.fieldNotes > 0 && (
            <div className="text-xs text-slate-300 mb-1">
              📝 Field notes: {queueStatus.fieldNotes}
            </div>
          )}

          {queueStatus.leadChanges > 0 && (
            <div className="text-xs text-slate-300 mb-1">
              👤 Lead updates: {queueStatus.leadChanges}
            </div>
          )}

          {lastSyncTime && (
            <div className="text-xs text-slate-400 mt-2 pt-2 border-t border-slate-700">
              Last synced: {formatTime(lastSyncTime)}
            </div>
          )}

          {connectionState === 'online' && (
            <div className="text-xs text-green-400 mt-2 pt-2 border-t border-slate-700">
              ✓ Ready to sync
            </div>
          )}
        </div>
      )}

      {/* Tooltip */}
      {!showDetails && (
        <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 bg-slate-900 text-white text-xs rounded px-2 py-1 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none">
          {indicator.label}
        </div>
      )}
    </div>
  );
};

/**
 * Offline Banner Component
 * 
 * Shows a prominent banner when offline or in slow mode.
 * Optionally displayed at the top of SPARK panel.
 * 
 * Usage:
 * ```tsx
 * <SparkOfflineBanner />
 * ```
 */
export const SparkOfflineBanner: React.FC<{ className?: string }> = ({ className = '' }) => {
  const [connectionState, setConnectionState] = useState<ConnectionState>('online');
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const handleConnectionChange = (event: Event) => {
      const customEvent = event as any;
      const newState = customEvent.detail?.state as ConnectionState;
      if (newState) {
        setConnectionState(newState);
        setIsVisible(newState !== 'online');
      }
    };

    window.addEventListener('spark:connection-change', handleConnectionChange);
    // Check initial state
    setConnectionState(sparkOfflineCapture.getConnectionState());
    setIsVisible(sparkOfflineCapture.isOfflineOrSlow());

    return () => {
      window.removeEventListener('spark:connection-change', handleConnectionChange);
    };
  }, []);

  if (!isVisible) return null;

  return (
    <div
      className={`w-full px-4 py-3 text-sm font-medium rounded-lg border ${className}`}
      style={
        connectionState === 'offline'
          ? {
              backgroundColor: '#fee2e2',
              borderColor: '#fca5a5',
              color: '#7f1d1d',
            }
          : {
              backgroundColor: '#fef3c7',
              borderColor: '#fcd34d',
              color: '#78350f',
            }
      }
    >
      {connectionState === 'offline' && (
        <>
          🔴 <strong>Offline</strong> — Recording locally. All data will sync when connection restores.
        </>
      )}
      {connectionState === 'slow' && (
        <>
          🟡 <strong>Slow Connection</strong> — Some features may be limited. Recording continues locally.
        </>
      )}
    </div>
  );
};

/**
 * Sync Progress Component
 * 
 * Shows progress of ongoing sync operation.
 * 
 * Usage:
 * ```tsx
 * <SparkSyncProgress />
 * ```
 */
export const SparkSyncProgress: React.FC<{ className?: string }> = ({ className = '' }) => {
  const [progress, setProgress] = useState<{
    total: number;
    current: number;
    status: 'idle' | 'syncing' | 'complete' | 'error';
    message?: string;
  }>({ total: 0, current: 0, status: 'idle' });

  useEffect(() => {
    const unsubscribe = sparkOfflineCapture.onSyncProgress((p) => {
      setProgress(p);
    });

    return () => unsubscribe();
  }, []);

  if (progress.status === 'idle') return null;

  const percentage = progress.total > 0 ? (progress.current / progress.total) * 100 : 0;

  return (
    <div className={`w-full ${className}`}>
      {progress.status === 'syncing' && (
        <div className="flex items-center gap-3 px-4 py-3 bg-blue-50 border border-blue-200 rounded-lg">
          <div className="animate-spin">⟳</div>
          <div className="flex-1">
            <div className="text-sm font-medium text-blue-900">
              Syncing {progress.current} of {progress.total} captures...
            </div>
            <div className="mt-1 w-full bg-blue-200 rounded-full h-2">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${percentage}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {progress.status === 'complete' && progress.message && (
        <div className="flex items-center gap-2 px-4 py-3 bg-green-50 border border-green-200 rounded-lg">
          <span>✓</span>
          <div className="text-sm font-medium text-green-900">{progress.message}</div>
        </div>
      )}

      {progress.status === 'error' && progress.message && (
        <div className="flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-lg">
          <span>✕</span>
          <div className="text-sm font-medium text-red-900">{progress.message}</div>
        </div>
      )}
    </div>
  );
};
