// @ts-nocheck
import { useState, useRef, useCallback } from 'react';
import {
  Upload,
  FileText,
  AlertTriangle,
  CheckCircle,
  Package,
  Users,
  Calendar,
  Loader2,
  Plus,
  Download,
  Wrench,
  HardHat,
  Waves,
} from 'lucide-react';
import type { BlueprintUpload, BlueprintOutput } from '../types';
import { processBlueprint } from '../agents/blueprint';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getSeverity(flag: string): 'high' | 'medium' | 'low' {
  const lower = flag.toLowerCase();
  if (lower.includes('required')) return 'high';
  if (lower.includes('verify')) return 'medium';
  return 'low';
}

function parseMtoItem(item: string): { description: string; quantity: string } {
  const parts = item.split(' — ');
  if (parts.length === 2) {
    return { description: parts[0].trim(), quantity: parts[1].trim() };
  }
  return { description: item, quantity: '' };
}

function parseCoordinationItem(item: string): { trade: string; description: string } {
  const colonIdx = item.indexOf(':');
  if (colonIdx !== -1) {
    return {
      trade: item.slice(0, colonIdx).trim(),
      description: item.slice(colonIdx + 1).trim(),
    };
  }
  return { trade: 'General', description: item };
}

function parseScheduleItem(item: string): { phase: string; task: string; timeline: string } {
  const dashIdx = item.indexOf(' — ');
  if (dashIdx !== -1) {
    const phaseAndTask = item.slice(0, dashIdx);
    const timeline = item.slice(dashIdx + 3);
    const colonIdx = phaseAndTask.indexOf(':');
    if (colonIdx !== -1) {
      return {
        phase: phaseAndTask.slice(0, colonIdx).trim(),
        task: phaseAndTask.slice(colonIdx + 1).trim(),
        timeline,
      };
    }
    return { phase: phaseAndTask, task: '', timeline };
  }
  return { phase: item, task: '', timeline: '' };
}

function getTradeIcon(trade: string) {
  const t = trade.toLowerCase();
  if (t === 'mechanical') return <Waves size={12} />;
  if (t === 'plumbing') return <Wrench size={12} />;
  if (t === 'gc') return <HardHat size={12} />;
  return <Users size={12} />;
}

function getTradeColor(trade: string): string {
  const t = trade.toLowerCase();
  if (t === 'mechanical') return 'bg-blue-900/40 text-blue-300 border-blue-800/50';
  if (t === 'plumbing') return 'bg-cyan-900/40 text-cyan-300 border-cyan-800/50';
  if (t === 'gc') return 'bg-orange-900/40 text-orange-300 border-orange-800/50';
  return 'bg-gray-800/60 text-gray-300 border-gray-700/50';
}

// ─── Severity Badge ───────────────────────────────────────────────────────────

function SeverityBadge({ severity }: { severity: 'high' | 'medium' | 'low' }) {
  const styles = {
    high: 'bg-red-900/40 text-red-400 border border-red-800/50',
    medium: 'bg-yellow-900/40 text-yellow-400 border border-yellow-800/50',
    low: 'bg-gray-800/60 text-gray-400 border border-gray-700/50',
  };
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${styles[severity]}`}>
      {severity.toUpperCase()}
    </span>
  );
}

// ─── Panel Shell ─────────────────────────────────────────────────────────────

function Panel({
  title,
  icon,
  count,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div
      className="rounded-xl border flex flex-col overflow-hidden"
      style={{ borderColor: '#1e2128', backgroundColor: '#0d0e14' }}
    >
      <div
        className="flex items-center justify-between px-4 py-3 border-b"
        style={{ borderColor: '#1a1c23' }}
      >
        <div className="flex items-center gap-2 text-gray-300">
          <span className="text-green-400">{icon}</span>
          <span className="text-sm font-semibold">{title}</span>
        </div>
        <span
          className="text-xs font-medium px-2 py-0.5 rounded-full border"
          style={{ color: '#4ade80', borderColor: '#16a34a33', backgroundColor: '#052e1688' }}
        >
          {count}
        </span>
      </div>
      <div className="flex flex-col gap-0">{children}</div>
    </div>
  );
}

// ─── Panel 1: Compliance Flags ───────────────────────────────────────────────

function ComplianceFlagsPanel({ flags }: { flags: string[] }) {
  return (
    <Panel title="Compliance Flags" icon={<AlertTriangle size={15} />} count={flags.length}>
      {flags.map((flag, i) => {
        const severity = getSeverity(flag);
        return (
          <div
            key={i}
            className="flex items-start gap-3 px-4 py-3 border-b last:border-0"
            style={{ borderColor: '#1a1c23' }}
          >
            <AlertTriangle
              size={15}
              className={`flex-shrink-0 mt-0.5 ${
                severity === 'high'
                  ? 'text-red-400'
                  : severity === 'medium'
                  ? 'text-yellow-400'
                  : 'text-gray-500'
              }`}
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-gray-200 leading-snug">{flag}</p>
            </div>
            <SeverityBadge severity={severity} />
          </div>
        );
      })}
    </Panel>
  );
}

// ─── Panel 2: MTO Items ───────────────────────────────────────────────────────

function MtoPanel({ items }: { items: string[] }) {
  const [added, setAdded] = useState<Set<number>>(new Set());

  function handleAdd(i: number) {
    setAdded((prev) => new Set(prev).add(i));
    // Wire to Supabase during integration — persist MTO item to project
  }

  return (
    <Panel title="Material Takeoff (MTO)" icon={<Package size={15} />} count={items.length}>
      {items.map((item, i) => {
        const { description, quantity } = parseMtoItem(item);
        const isAdded = added.has(i);
        return (
          <div
            key={i}
            className="flex items-center justify-between gap-3 px-4 py-3 border-b last:border-0"
            style={{ borderColor: '#1a1c23' }}
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm text-gray-200 truncate">{description}</p>
              {quantity && (
                <p className="text-xs text-gray-500 mt-0.5">{quantity}</p>
              )}
            </div>
            <button
              onClick={() => handleAdd(i)}
              disabled={isAdded}
              className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors flex-shrink-0 ${
                isAdded
                  ? 'bg-green-900/30 text-green-400 border-green-800/40 cursor-default'
                  : 'border-gray-700 text-gray-400 hover:border-green-700 hover:text-green-400 hover:bg-green-900/20'
              }`}
            >
              {isAdded ? (
                <>
                  <CheckCircle size={11} />
                  Added
                </>
              ) : (
                <>
                  <Plus size={11} />
                  Add to MTO
                </>
              )}
            </button>
          </div>
        );
      })}
    </Panel>
  );
}

// ─── Panel 3: Coordination Items ──────────────────────────────────────────────

function CoordinationPanel({ items }: { items: string[] }) {
  return (
    <Panel title="Coordination Items" icon={<Users size={15} />} count={items.length}>
      {items.map((item, i) => {
        const { trade, description } = parseCoordinationItem(item);
        return (
          <div
            key={i}
            className="flex items-start gap-3 px-4 py-3 border-b last:border-0"
            style={{ borderColor: '#1a1c23' }}
          >
            <span
              className={`flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-md border flex-shrink-0 mt-0.5 ${getTradeColor(trade)}`}
            >
              {getTradeIcon(trade)}
              {trade}
            </span>
            <p className="text-sm text-gray-200 leading-snug flex-1">{description}</p>
          </div>
        );
      })}
    </Panel>
  );
}

// ─── Panel 4: Task Schedule ───────────────────────────────────────────────────

function TaskSchedulePanel({ items }: { items: string[] }) {
  function handleExport() {
    // Wire to Supabase during integration — export task schedule to project
  }

  return (
    <Panel title="Task Schedule" icon={<Calendar size={15} />} count={items.length}>
      {items.map((item, i) => {
        const { phase, task, timeline } = parseScheduleItem(item);
        return (
          <div
            key={i}
            className="flex items-center gap-4 px-4 py-3 border-b last:border-0"
            style={{ borderColor: '#1a1c23' }}
          >
            <div
              className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
              style={{ backgroundColor: '#16a34a22', color: '#4ade80', border: '1px solid #16a34a44' }}
            >
              {i + 1}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-green-400 uppercase tracking-wide">{phase}</p>
              {task && <p className="text-sm text-gray-200 mt-0.5">{task}</p>}
            </div>
            {timeline && (
              <span className="text-xs text-gray-500 flex-shrink-0">{timeline}</span>
            )}
          </div>
        );
      })}
      <div className="px-4 py-3">
        <button
          onClick={handleExport}
          className="w-full flex items-center justify-center gap-2 text-sm font-medium px-4 py-2.5 rounded-lg border border-gray-700 text-gray-400 hover:border-green-700 hover:text-green-400 hover:bg-green-900/20 transition-colors"
        >
          <Download size={14} />
          Export to Project
        </button>
      </div>
    </Panel>
  );
}

// ─── Upload Zone ──────────────────────────────────────────────────────────────

function UploadZone({
  onFileSelected,
}: {
  onFileSelected: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const handleFile = useCallback(
    (file: File) => {
      if (file.type !== 'application/pdf') {
        alert('Only PDF files are accepted.');
        return;
      }
      setSelectedFile(file);
      onFileSelected(file);
    },
    [onFileSelected]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  return (
    <div className="flex flex-col gap-3">
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={`relative flex flex-col items-center justify-center gap-3 px-8 py-10 rounded-xl border-2 border-dashed cursor-pointer transition-colors ${
          isDragging
            ? 'border-green-500 bg-green-900/10'
            : selectedFile
            ? 'border-green-800/60 bg-green-900/5'
            : 'border-gray-700 hover:border-gray-600 bg-gray-900/30'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,application/pdf"
          className="hidden"
          onChange={handleInputChange}
        />

        {selectedFile ? (
          <>
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center"
              style={{ backgroundColor: '#16a34a22', border: '1px solid #16a34a44' }}
            >
              <FileText size={22} className="text-green-400" />
            </div>
            <div className="text-center">
              <p className="text-sm font-semibold text-gray-200">{selectedFile.name}</p>
              <p className="text-xs text-gray-500 mt-0.5">{formatFileSize(selectedFile.size)}</p>
            </div>
            <p className="text-xs text-gray-600">Click to replace</p>
          </>
        ) : (
          <>
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center"
              style={{ backgroundColor: '#1a1c23', border: '1px solid #2a2d36' }}
            >
              <Upload size={22} className="text-gray-500" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-gray-300">
                Drag & drop or <span className="text-green-400">click to upload</span>
              </p>
              <p className="text-xs text-gray-600 mt-1">PDF files only</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Main BlueprintAI View ────────────────────────────────────────────────────

export default function BlueprintAI() {
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [upload, setUpload] = useState<BlueprintUpload | null>(null);
  const [output, setOutput] = useState<BlueprintOutput | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  function handleFileSelected(file: File) {
    setUpload({
      id: `bp-${Date.now()}`,
      fileName: file.name,
      uploadedAt: new Date().toISOString(),
      status: 'uploaded',
    });
    setUploadedFile(file);
    setOutput(null);
  }

  function handleProcess() {
    if (!upload) return;
    setIsProcessing(true);
    setUpload((prev) => prev ? { ...prev, status: 'processing' } : prev);

    // Replace with real Supabase query during integration — fetch uploaded file and extract text via Claude API
    const mockBlueprintText = `
      ELECTRICAL BLUEPRINT — Riverside Commercial Buildout
      200A panel with 20A breakers and GFCI outlets throughout.
      3/4 EMT conduit runs from panel to all circuits.
      12/2 MC cable for branch circuits.
      Arc fault (AFCI) protection required for bedroom circuits.
      Underground trench for service entry conduit — 24in depth.
      HVAC RTU disconnect on rooftop, within sight of unit.
      Coordinate with GC on drywall schedule before rough-in inspection.
      Plumbing: dedicated circuit for water heater in kitchen.
      Mechanical: confirm RTU location before rough-in.
      NEC compliance required — permit to be posted on site.
      Commercial occupancy — Title 24 lighting power density limits apply.
      Schedule: underground Day 1-2, rough-in Day 3-7, inspection Day 8, trim Day 9-11.
    `;

    // Simulated processing delay (replaces with async Claude API call during integration)
    setTimeout(() => {
      const result = processBlueprint(mockBlueprintText);
      setIsProcessing(false);
      setUpload((prev) => prev ? { ...prev, status: 'complete' } : prev);
      setOutput(result);
    }, 3000);
  }

  const canProcess = uploadedFile !== null && !isProcessing && upload?.status !== 'complete';

  return (
    <div className="flex flex-col gap-6 px-6 py-6 max-w-4xl mx-auto w-full">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <FileText size={18} className="text-green-400" />
          <h1 className="text-lg font-semibold text-gray-100">Blueprint AI</h1>
          <span
            className="text-xs font-medium px-2 py-0.5 rounded-full border"
            style={{ color: '#4ade80', borderColor: '#16a34a33', backgroundColor: '#052e1688' }}
          >
            E12 · Pipeline
          </span>
        </div>
        <p className="text-sm text-gray-500">
          Upload an electrical blueprint PDF to extract compliance flags, material takeoffs, coordination items, and a task schedule.
        </p>
      </div>

      {/* Upload Zone */}
      <div
        className="rounded-xl border p-5 flex flex-col gap-4"
        style={{ borderColor: '#1e2128', backgroundColor: '#0d0e14' }}
      >
        <p className="text-xs font-semibold uppercase tracking-widest text-gray-600">
          Upload Blueprint
        </p>
        <UploadZone onFileSelected={handleFileSelected} />

        {/* Process Button */}
        {uploadedFile && (
          <button
            onClick={handleProcess}
            disabled={!canProcess}
            className={`flex items-center justify-center gap-2 text-sm font-semibold px-5 py-2.5 rounded-lg transition-colors ${
              isProcessing
                ? 'bg-green-900/30 text-green-300 border border-green-800/40 cursor-not-allowed'
                : upload?.status === 'complete'
                ? 'bg-gray-800/60 text-gray-500 border border-gray-700/50 cursor-default'
                : 'bg-green-600 hover:bg-green-500 text-white border border-green-500'
            }`}
          >
            {isProcessing ? (
              <>
                <Loader2 size={15} className="animate-spin" />
                Analyzing blueprint...
              </>
            ) : upload?.status === 'complete' ? (
              <>
                <CheckCircle size={15} className="text-green-400" />
                Analysis Complete
              </>
            ) : (
              <>
                <FileText size={15} />
                Process Blueprint
              </>
            )}
          </button>
        )}
      </div>

      {/* Output Panels */}
      {output && (
        <div className="grid grid-cols-1 gap-4">
          <ComplianceFlagsPanel flags={output.complianceFlags} />
          <MtoPanel items={output.mtoItems} />
          <CoordinationPanel items={output.coordinationItems} />
          <TaskSchedulePanel items={output.taskSchedule} />
        </div>
      )}
    </div>
  );
}
