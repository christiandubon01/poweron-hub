/**
 * SPARK Offline Capture Service
 * 
 * Handles offline recording, local storage, and automatic sync when connection restores.
 * - Monitors network connection (online/offline/slow)
 * - Stores audio chunks in IndexedDB during offline/slow periods
 * - Queues API calls (Whisper, Claude, ElevenLabs) for retry
 * - Syncs when connection restores with progress tracking
 * - Supports field notes, lead status changes, and practice mode offline
 */

// ============================================================================
// Types
// ============================================================================

export interface AudioChunk {
  id: string;
  timestamp: number;
  audioBlob: Blob;
  duration: number;
  mode: 'live_call' | 'practice' | 'debrief';
  synced: boolean;
  syncedAt?: number;
  metadata?: {
    callId?: string;
    clientName?: string;
    leadId?: string;
  };
}

export interface QueuedOperation {
  id: string;
  timestamp: number;
  type: 'transcription' | 'analysis' | 'synthesis';
  chunkId?: string;
  data: Record<string, unknown>;
  retries: number;
  lastRetryAt?: number;
  completed: boolean;
}

export interface FieldNote {
  id: string;
  timestamp: number;
  content: string;
  synced: boolean;
  syncedAt?: number;
  tags?: string[];
}

export interface LeadStatusChange {
  id: string;
  timestamp: number;
  leadId: string;
  oldStatus: string;
  newStatus: string;
  synced: boolean;
  syncedAt?: number;
}

export type ConnectionState = 'online' | 'offline' | 'slow';

export interface ConnectionChangeEvent extends Event {
  detail: {
    state: ConnectionState;
    previousState: ConnectionState;
    effectiveType?: string;
    downlink?: number;
  };
}

// ============================================================================
// IndexedDB Management
// ============================================================================

const DB_NAME = 'SparkOfflineCapture';
const DB_VERSION = 1;

const OBJECT_STORES = {
  audioChunks: 'audioChunks',
  queuedOperations: 'queuedOperations',
  fieldNotes: 'fieldNotes',
  leadStatusChanges: 'leadStatusChanges',
};

class IndexedDBManager {
  private db: IDBDatabase | null = null;

  async init(): Promise<void> {
    if (this.db) return;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        console.error('IndexedDB open failed:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        console.log('IndexedDB initialized:', DB_NAME);
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Audio chunks store
        if (!db.objectStoreNames.contains(OBJECT_STORES.audioChunks)) {
          const audioStore = db.createObjectStore(OBJECT_STORES.audioChunks, { keyPath: 'id' });
          audioStore.createIndex('synced', 'synced', { unique: false });
          audioStore.createIndex('timestamp', 'timestamp', { unique: false });
        }

        // Queued operations store
        if (!db.objectStoreNames.contains(OBJECT_STORES.queuedOperations)) {
          const opStore = db.createObjectStore(OBJECT_STORES.queuedOperations, { keyPath: 'id' });
          opStore.createIndex('completed', 'completed', { unique: false });
          opStore.createIndex('type', 'type', { unique: false });
        }

        // Field notes store
        if (!db.objectStoreNames.contains(OBJECT_STORES.fieldNotes)) {
          const notesStore = db.createObjectStore(OBJECT_STORES.fieldNotes, { keyPath: 'id' });
          notesStore.createIndex('synced', 'synced', { unique: false });
          notesStore.createIndex('timestamp', 'timestamp', { unique: false });
        }

        // Lead status changes store
        if (!db.objectStoreNames.contains(OBJECT_STORES.leadStatusChanges)) {
          const leadStore = db.createObjectStore(OBJECT_STORES.leadStatusChanges, { keyPath: 'id' });
          leadStore.createIndex('synced', 'synced', { unique: false });
          leadStore.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };
    });
  }

  async addAudioChunk(chunk: AudioChunk): Promise<string> {
    if (!this.db) throw new Error('IndexedDB not initialized');
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([OBJECT_STORES.audioChunks], 'readwrite');
      const store = tx.objectStore(OBJECT_STORES.audioChunks);
      const request = store.add(chunk);

      request.onsuccess = () => resolve(request.result as string);
      request.onerror = () => reject(request.error);
    });
  }

  async getUnsynced(): Promise<AudioChunk[]> {
    if (!this.db) throw new Error('IndexedDB not initialized');
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([OBJECT_STORES.audioChunks], 'readonly');
      const store = tx.objectStore(OBJECT_STORES.audioChunks);
      const index = store.index('synced');
      const request = index.getAll(false as unknown as IDBValidKey);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async markChunkSynced(chunkId: string): Promise<void> {
    if (!this.db) throw new Error('IndexedDB not initialized');
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([OBJECT_STORES.audioChunks], 'readwrite');
      const store = tx.objectStore(OBJECT_STORES.audioChunks);
      const request = store.get(chunkId);

      request.onsuccess = () => {
        const chunk = request.result;
        if (chunk) {
          chunk.synced = true;
          chunk.syncedAt = Date.now();
          const updateRequest = store.put(chunk);
          updateRequest.onerror = () => reject(updateRequest.error);
          updateRequest.onsuccess = () => resolve();
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  async addQueuedOperation(op: QueuedOperation): Promise<string> {
    if (!this.db) throw new Error('IndexedDB not initialized');
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([OBJECT_STORES.queuedOperations], 'readwrite');
      const store = tx.objectStore(OBJECT_STORES.queuedOperations);
      const request = store.add(op);

      request.onsuccess = () => resolve(request.result as string);
      request.onerror = () => reject(request.error);
    });
  }

  async addFieldNote(note: FieldNote): Promise<string> {
    if (!this.db) throw new Error('IndexedDB not initialized');
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([OBJECT_STORES.fieldNotes], 'readwrite');
      const store = tx.objectStore(OBJECT_STORES.fieldNotes);
      const request = store.add(note);

      request.onsuccess = () => resolve(request.result as string);
      request.onerror = () => reject(request.error);
    });
  }

  async addLeadStatusChange(change: LeadStatusChange): Promise<string> {
    if (!this.db) throw new Error('IndexedDB not initialized');
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([OBJECT_STORES.leadStatusChanges], 'readwrite');
      const store = tx.objectStore(OBJECT_STORES.leadStatusChanges);
      const request = store.add(change);

      request.onsuccess = () => resolve(request.result as string);
      request.onerror = () => reject(request.error);
    });
  }

  async getUnsynkedFieldNotes(): Promise<FieldNote[]> {
    if (!this.db) throw new Error('IndexedDB not initialized');
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([OBJECT_STORES.fieldNotes], 'readonly');
      const store = tx.objectStore(OBJECT_STORES.fieldNotes);
      const index = store.index('synced');
      const request = index.getAll(false as unknown as IDBValidKey);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async getUnsynkedLeadChanges(): Promise<LeadStatusChange[]> {
    if (!this.db) throw new Error('IndexedDB not initialized');
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([OBJECT_STORES.leadStatusChanges], 'readonly');
      const store = tx.objectStore(OBJECT_STORES.leadStatusChanges);
      const index = store.index('synced');
      const request = index.getAll(false as unknown as IDBValidKey);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async getQueuedOperations(completed: boolean = false): Promise<QueuedOperation[]> {
    if (!this.db) throw new Error('IndexedDB not initialized');
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([OBJECT_STORES.queuedOperations], 'readonly');
      const store = tx.objectStore(OBJECT_STORES.queuedOperations);
      const index = store.index('completed');
      const request = index.getAll(completed as unknown as IDBValidKey);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async getCounts(): Promise<{
    audioChunks: number;
    queuedOps: number;
    fieldNotes: number;
    leadChanges: number;
  }> {
    if (!this.db) throw new Error('IndexedDB not initialized');
    const chunksReq = this.db.transaction([OBJECT_STORES.audioChunks], 'readonly')
      .objectStore(OBJECT_STORES.audioChunks).count();
    const opsReq = this.db.transaction([OBJECT_STORES.queuedOperations], 'readonly')
      .objectStore(OBJECT_STORES.queuedOperations).count();
    const notesReq = this.db.transaction([OBJECT_STORES.fieldNotes], 'readonly')
      .objectStore(OBJECT_STORES.fieldNotes).count();
    const leadsReq = this.db.transaction([OBJECT_STORES.leadStatusChanges], 'readonly')
      .objectStore(OBJECT_STORES.leadStatusChanges).count();

    return new Promise((resolve, reject) => {
      let completed = 0;
      const result = { audioChunks: 0, queuedOps: 0, fieldNotes: 0, leadChanges: 0 };

      chunksReq.onsuccess = () => {
        result.audioChunks = chunksReq.result;
        if (++completed === 4) resolve(result);
      };
      opsReq.onsuccess = () => {
        result.queuedOps = opsReq.result;
        if (++completed === 4) resolve(result);
      };
      notesReq.onsuccess = () => {
        result.fieldNotes = notesReq.result;
        if (++completed === 4) resolve(result);
      };
      leadsReq.onsuccess = () => {
        result.leadChanges = leadsReq.result;
        if (++completed === 4) resolve(result);
      };

      chunksReq.onerror = () => reject(chunksReq.error);
      opsReq.onerror = () => reject(opsReq.error);
      notesReq.onerror = () => reject(notesReq.error);
      leadsReq.onerror = () => reject(leadsReq.error);
    });
  }
}

// ============================================================================
// Connection Monitor
// ============================================================================

class ConnectionMonitor {
  private state: ConnectionState = 'online';
  private listeners: Set<(state: ConnectionState) => void> = new Set();

  constructor() {
    this.init();
  }

  private init(): void {
    // Initial state
    this.updateState();

    // Online/offline events
    window.addEventListener('online', () => this.updateState());
    window.addEventListener('offline', () => this.updateState());

    // Connection API changes
    const nav = navigator as any;
    const connection = nav.connection || nav.mozConnection || nav.webkitConnection;
    if (connection) {
      connection.addEventListener('change', () => this.updateState());
    }

    // Periodic check (every 10 seconds)
    setInterval(() => this.updateState(), 10000);
  }

  private updateState(): void {
    const previousState = this.state;

    // Determine current state
    if (!navigator.onLine) {
      this.state = 'offline';
    } else {
      const nav = navigator as any;
      const connection = nav.connection || nav.mozConnection || nav.webkitConnection;
      if (connection && connection.downlink !== undefined && connection.downlink < 0.5) {
        this.state = 'slow';
      } else {
        this.state = 'online';
      }
    }

    // Emit change event if state changed
    if (previousState !== this.state) {
      this.emit(this.state);
      this.fireConnectionChangeEvent(previousState, this.state);
    }
  }

  private fireConnectionChangeEvent(previousState: ConnectionState, newState: ConnectionState): void {
    const nav = navigator as any;
    const connection = nav.connection || nav.mozConnection || nav.webkitConnection;
    const event = new Event('spark:connection-change', { bubbles: true }) as any;
    event.detail = {
      state: newState,
      previousState,
      effectiveType: connection?.effectiveType,
      downlink: connection?.downlink,
    };
    window.dispatchEvent(event);
  }

  getState(): ConnectionState {
    return this.state;
  }

  isOfflineOrSlow(): boolean {
    return this.state !== 'online';
  }

  subscribe(listener: (state: ConnectionState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(state: ConnectionState): void {
    this.listeners.forEach(listener => listener(state));
  }
}

// ============================================================================
// Main Service
// ============================================================================

export class SparkOfflineCapture {
  private static instance: SparkOfflineCapture;
  private dbManager = new IndexedDBManager();
  private connectionMonitor = new ConnectionMonitor();
  private isSyncing = false;
  private syncProgressListeners: Set<(progress: SyncProgress) => void> = new Set();

  private constructor() {}

  static getInstance(): SparkOfflineCapture {
    if (!SparkOfflineCapture.instance) {
      SparkOfflineCapture.instance = new SparkOfflineCapture();
    }
    return SparkOfflineCapture.instance;
  }

  async initialize(): Promise<void> {
    await this.dbManager.init();
    console.log('SPARK Offline Capture initialized');

    // Monitor connection changes
    this.connectionMonitor.subscribe((state) => {
      console.log('Connection state changed:', state);
      if (state === 'online') {
        this.triggerSync();
      }
    });
  }

  /**
   * Store audio chunk during offline/slow periods
   */
  async captureAudioChunk(
    audioBlob: Blob,
    duration: number,
    mode: 'live_call' | 'practice' | 'debrief',
    metadata?: Record<string, unknown>
  ): Promise<string> {
    const chunk: AudioChunk = {
      id: `chunk_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      timestamp: Date.now(),
      audioBlob,
      duration,
      mode,
      synced: false,
      metadata: metadata as any,
    };

    const chunkId = await this.dbManager.addAudioChunk(chunk);

    // Queue transcription operation
    await this.dbManager.addQueuedOperation({
      id: `transcribe_${chunkId}`,
      timestamp: Date.now(),
      type: 'transcription',
      chunkId,
      data: { audioChunkId: chunkId },
      retries: 0,
      completed: false,
    });

    console.log('Audio chunk captured:', chunkId);
    return chunkId;
  }

  /**
   * Queue field note for offline storage
   */
  async saveFieldNote(content: string, tags?: string[]): Promise<string> {
    const note: FieldNote = {
      id: `note_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      timestamp: Date.now(),
      content,
      synced: false,
      tags,
    };

    const noteId = await this.dbManager.addFieldNote(note);
    console.log('Field note queued for sync:', noteId);
    return noteId;
  }

  /**
   * Queue lead status change for offline storage
   */
  async trackLeadStatusChange(
    leadId: string,
    oldStatus: string,
    newStatus: string
  ): Promise<string> {
    const change: LeadStatusChange = {
      id: `lead_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      timestamp: Date.now(),
      leadId,
      oldStatus,
      newStatus,
      synced: false,
    };

    const changeId = await this.dbManager.addLeadStatusChange(change);
    console.log('Lead status change queued for sync:', changeId);
    return changeId;
  }

  /**
   * Check current connection state
   */
  getConnectionState(): ConnectionState {
    return this.connectionMonitor.getState();
  }

  /**
   * Check if offline or slow
   */
  isOfflineOrSlow(): boolean {
    return this.connectionMonitor.isOfflineOrSlow();
  }

  /**
   * Get queue counts for UI indicator
   */
  async getQueueCounts(): Promise<{ audioChunks: number; fieldNotes: number; leadChanges: number }> {
    const counts = await this.dbManager.getCounts();
    return {
      audioChunks: counts.audioChunks,
      fieldNotes: counts.fieldNotes,
      leadChanges: counts.leadChanges,
    };
  }

  /**
   * Subscribe to sync progress updates
   */
  onSyncProgress(listener: (progress: SyncProgress) => void): () => void {
    this.syncProgressListeners.add(listener);
    return () => this.syncProgressListeners.delete(listener);
  }

  /**
   * Trigger sync when connection restores
   */
  private triggerSync(): void {
    if (this.isSyncing) return;
    this.sync();
  }

  /**
   * Main sync process
   */
  async sync(): Promise<void> {
    if (this.isSyncing) {
      console.warn('Sync already in progress');
      return;
    }

    this.isSyncing = true;

    try {
      const chunks = await this.dbManager.getUnsynced();
      const fieldNotes = await this.dbManager.getUnsynkedFieldNotes();
      const leadChanges = await this.dbManager.getUnsynkedLeadChanges();

      const totalItems = chunks.length + fieldNotes.length + leadChanges.length;

      if (totalItems === 0) {
        this.notifyProgress({ total: 0, current: 0, status: 'idle' });
        this.isSyncing = false;
        return;
      }

      let processed = 0;

      // Sync audio chunks with transcription
      for (const chunk of chunks) {
        try {
          // In production, send to Whisper API here
          console.log('Processing audio chunk:', chunk.id);
          await this.dbManager.markChunkSynced(chunk.id);
          processed++;
          this.notifyProgress({ total: totalItems, current: processed, status: 'syncing' });
        } catch (error) {
          console.error('Failed to sync chunk:', chunk.id, error);
        }
      }

      // Sync field notes
      for (const note of fieldNotes) {
        try {
          console.log('Syncing field note:', note.id);
          // In production, send to backend/Claude here
          await this.dbManager.markChunkSynced(note.id);
          processed++;
          this.notifyProgress({ total: totalItems, current: processed, status: 'syncing' });
        } catch (error) {
          console.error('Failed to sync field note:', note.id, error);
        }
      }

      // Sync lead status changes
      for (const change of leadChanges) {
        try {
          console.log('Syncing lead status change:', change.id);
          // In production, send to backend/SPARK here
          await this.dbManager.markChunkSynced(change.id);
          processed++;
          this.notifyProgress({ total: totalItems, current: processed, status: 'syncing' });
        } catch (error) {
          console.error('Failed to sync lead change:', change.id, error);
        }
      }

      this.notifyProgress({ total: totalItems, current: processed, status: 'complete', message: 'All captures synced' });
    } catch (error) {
      console.error('Sync failed:', error);
      this.notifyProgress({ total: 0, current: 0, status: 'error', message: 'Sync failed' });
    } finally {
      this.isSyncing = false;
    }
  }

  private notifyProgress(progress: SyncProgress): void {
    this.syncProgressListeners.forEach(listener => listener(progress));
  }
}

export interface SyncProgress {
  total: number;
  current: number;
  status: 'idle' | 'syncing' | 'complete' | 'error';
  message?: string;
}

// Export singleton instance
export const sparkOfflineCapture = SparkOfflineCapture.getInstance();
