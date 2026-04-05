/**
 * SignaturePad.tsx
 * HTML Canvas-based signature pad.
 * - Draw with finger (touch) on mobile, mouse on desktop
 * - Clear button resets canvas
 * - Returns signature as base64 PNG via onChange callback
 * - Minimum 300×150px, responsive
 * - Dark theme: white stroke on dark canvas
 */

import { useRef, useEffect, useState, useCallback } from 'react';
import { Trash2 } from 'lucide-react';

interface SignaturePadProps {
  /** Called whenever the signature changes (base64 PNG data URL, or null if cleared) */
  onChange?: (dataUrl: string | null) => void;
  /** Optional width override (defaults to container width, min 300) */
  width?: number;
  /** Canvas height in px (default 150) */
  height?: number;
  className?: string;
}

export default function SignaturePad({
  onChange,
  height = 150,
  className = '',
}: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDrawingRef = useRef(false);
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);
  const [isEmpty, setIsEmpty] = useState(true);

  // ── Helpers ────────────────────────────────────────────────────────────────

  const getCtx = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    return ctx;
  }, []);

  const getPos = useCallback(
    (e: MouseEvent | TouchEvent): { x: number; y: number } | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      if ('touches' in e) {
        const touch = e.touches[0];
        if (!touch) return null;
        return {
          x: (touch.clientX - rect.left) * scaleX,
          y: (touch.clientY - rect.top) * scaleY,
        };
      }
      return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY,
      };
    },
    []
  );

  const emitChange = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !onChange) return;
    onChange(canvas.toDataURL('image/png'));
  }, [onChange]);

  // ── Drawing handlers ───────────────────────────────────────────────────────

  const startDraw = useCallback(
    (e: MouseEvent | TouchEvent) => {
      e.preventDefault();
      const pos = getPos(e);
      if (!pos) return;
      isDrawingRef.current = true;
      lastPosRef.current = pos;
      const ctx = getCtx();
      if (!ctx) return;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 1.1, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      setIsEmpty(false);
    },
    [getCtx, getPos]
  );

  const draw = useCallback(
    (e: MouseEvent | TouchEvent) => {
      e.preventDefault();
      if (!isDrawingRef.current) return;
      const pos = getPos(e);
      if (!pos || !lastPosRef.current) return;
      const ctx = getCtx();
      if (!ctx) return;
      ctx.beginPath();
      ctx.moveTo(lastPosRef.current.x, lastPosRef.current.y);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
      lastPosRef.current = pos;
    },
    [getCtx, getPos]
  );

  const stopDraw = useCallback(
    (e: MouseEvent | TouchEvent) => {
      e.preventDefault();
      if (!isDrawingRef.current) return;
      isDrawingRef.current = false;
      lastPosRef.current = null;
      emitChange();
    },
    [emitChange]
  );

  // ── Canvas resize observer ─────────────────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const resize = () => {
      const w = Math.max(300, container.clientWidth);
      // Preserve existing drawing across resize (snapshot → restore)
      const snapshot = canvas.toDataURL();
      canvas.width = w;
      canvas.height = height;
      // Repaint background
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#0d0e14';
        ctx.fillRect(0, 0, w, height);
      }
      // Restore drawing if any
      if (!isEmpty) {
        const img = new Image();
        img.onload = () => ctx?.drawImage(img, 0, 0);
        img.src = snapshot;
      }
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    return () => observer.disconnect();
  }, [height, isEmpty]);

  // ── Event listeners ────────────────────────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.addEventListener('mousedown', startDraw);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stopDraw);
    canvas.addEventListener('mouseleave', stopDraw);
    canvas.addEventListener('touchstart', startDraw, { passive: false });
    canvas.addEventListener('touchmove', draw, { passive: false });
    canvas.addEventListener('touchend', stopDraw, { passive: false });

    return () => {
      canvas.removeEventListener('mousedown', startDraw);
      canvas.removeEventListener('mousemove', draw);
      canvas.removeEventListener('mouseup', stopDraw);
      canvas.removeEventListener('mouseleave', stopDraw);
      canvas.removeEventListener('touchstart', startDraw);
      canvas.removeEventListener('touchmove', draw);
      canvas.removeEventListener('touchend', stopDraw);
    };
  }, [startDraw, draw, stopDraw]);

  // ── Clear ──────────────────────────────────────────────────────────────────

  const clear = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#0d0e14';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    setIsEmpty(true);
    onChange?.(null);
  }, [onChange]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <div
        ref={containerRef}
        className="relative w-full rounded-lg overflow-hidden border"
        style={{
          borderColor: '#2e3040',
          minWidth: 300,
          minHeight: height,
        }}
      >
        <canvas
          ref={canvasRef}
          className="block w-full touch-none cursor-crosshair"
          style={{ display: 'block', backgroundColor: '#0d0e14' }}
        />
        {isEmpty && (
          <div
            className="absolute inset-0 flex items-center justify-center pointer-events-none select-none"
            style={{ color: '#3a3d50' }}
          >
            <span className="text-sm italic">Sign here</span>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs" style={{ color: '#4b5160' }}>
          {isEmpty ? 'Draw your signature above' : 'Signature captured'}
        </p>
        <button
          type="button"
          onClick={clear}
          className="flex items-center gap-1.5 px-3 py-1 rounded-md text-xs transition-colors"
          style={{
            backgroundColor: '#1a1c23',
            color: '#9ca3af',
            border: '1px solid #2e3040',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#252833';
            (e.currentTarget as HTMLButtonElement).style.color = '#e5e7eb';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#1a1c23';
            (e.currentTarget as HTMLButtonElement).style.color = '#9ca3af';
          }}
        >
          <Trash2 size={12} />
          Clear
        </button>
      </div>
    </div>
  );
}
