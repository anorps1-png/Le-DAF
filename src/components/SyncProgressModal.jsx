import React, { useEffect, useState } from 'react';
import { CloudUpload, CloudDownload, CheckCircle2, AlertCircle, Loader2, X } from 'lucide-react';

export default function SyncProgressModal({ isOpen, type = 'push', onClose, onComplete }) {
  const [progress, setProgress] = useState({
    active: true,
    type,
    step: 'Initialisation de la synchronisation...',
    current: 0,
    total: 0,
    percentage: 0,
    status: 'running',
    message: ''
  });

  useEffect(() => {
    if (!isOpen) return;

    setProgress({
      active: true,
      type,
      step: type === 'push' ? 'Préparation de l\'envoi PUSH...' : 'Préparation du téléchargement PULL...',
      current: 0,
      total: 0,
      percentage: 0,
      status: 'running',
      message: ''
    });

    let isSubscribed = true;

    const pollProgress = async () => {
      try {
        const res = await fetch('/api/sync/progress');
        if (res.ok) {
          const data = await res.json();
          if (isSubscribed) {
            setProgress(prev => ({
              ...prev,
              ...data,
              type: type, // Garder l'action déclenchée par l'utilisateur
              percentage: data.percentage !== undefined ? data.percentage : prev.percentage
            }));

            if (!data.active && data.status === 'success' && onComplete) {
              onComplete(data);
            }
          }
        }
      } catch (err) {
        console.error('Error fetching sync progress:', err);
      }
    };

    pollProgress();
    const interval = setInterval(pollProgress, 250);

    return () => {
      isSubscribed = false;
      clearInterval(interval);
    };
  }, [isOpen, type, onComplete]);

  if (!isOpen) return null;

  const isPush = type === 'push';
  const isRunning = progress.status === 'running' || progress.active;
  const isSuccess = progress.status === 'success' && !isRunning;
  const isError = progress.status === 'error';

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(15, 23, 42, 0.75)',
      backdropFilter: 'blur(8px)',
      WebkitBackdropFilter: 'blur(8px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 9999,
      padding: '1rem',
      animation: 'fadeIn 0.25s ease-out'
    }}>
      <div style={{
        background: 'linear-gradient(145deg, #1e293b 0%, #0f172a 100%)',
        borderRadius: '16px',
        border: '1px solid rgba(255, 255, 255, 0.12)',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 30px rgba(59, 130, 246, 0.15)',
        width: '100%',
        maxWidth: '480px',
        color: '#f8fafc',
        padding: '2rem',
        position: 'relative',
        overflow: 'hidden'
      }}>
        {/* Decorative Top Accent Line */}
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: '4px',
          background: isError 
            ? 'linear-gradient(90deg, #ef4444 0%, #dc2626 100%)' 
            : isSuccess 
            ? 'linear-gradient(90deg, #10b981 0%, #059669 100%)' 
            : isPush 
            ? 'linear-gradient(90deg, #3b82f6 0%, #6366f1 100%)' 
            : 'linear-gradient(90deg, #06b6d4 0%, #3b82f6 100%)'
        }} />

        {/* Close Button if done */}
        {!isRunning && (
          <button
            onClick={onClose}
            style={{
              position: 'absolute',
              top: '1rem',
              right: '1rem',
              background: 'rgba(255, 255, 255, 0.1)',
              border: 'none',
              borderRadius: '50%',
              width: '32px',
              height: '32px',
              color: '#94a3b8',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.2s'
            }}
          >
            <X size={18} />
          </button>
        )}

        {/* Header Icon + Title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
          <div style={{
            width: '52px',
            height: '52px',
            borderRadius: '14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: isError 
              ? 'rgba(239, 68, 68, 0.15)' 
              : isSuccess 
              ? 'rgba(16, 185, 129, 0.15)' 
              : isPush 
              ? 'rgba(59, 130, 246, 0.15)' 
              : 'rgba(6, 182, 212, 0.15)',
            border: isError 
              ? '1px solid rgba(239, 68, 68, 0.3)' 
              : isSuccess 
              ? '1px solid rgba(16, 185, 129, 0.3)' 
              : isPush 
              ? '1px solid rgba(59, 130, 246, 0.3)' 
              : '1px solid rgba(6, 182, 212, 0.3)'
          }}>
            {isRunning ? (
              isPush ? <CloudUpload className="spin" size={28} style={{ color: '#60a5fa' }} /> : <CloudDownload className="spin" size={28} style={{ color: '#22d3ee' }} />
            ) : isSuccess ? (
              <CheckCircle2 size={28} style={{ color: '#34d399' }} />
            ) : (
              <AlertCircle size={28} style={{ color: '#f87171' }} />
            )}
          </div>

          <div>
            <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: '#f8fafc' }}>
              {isPush ? 'Synchronisation PUSH (Envoi)' : 'Synchronisation PULL (Téléchargement)'}
            </h3>
            <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>
              {isRunning 
                ? (isPush ? 'Envoi vers Supabase Cloud...' : 'Téléchargement depuis Supabase Cloud...')
                : isSuccess 
                ? 'Opération terminée avec succès !' 
                : 'Une erreur s\'est produite.'}
            </span>
          </div>
        </div>

        {/* Step Text & Record Counter Badge */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '0.75rem',
          fontSize: '0.9rem',
          color: '#cbd5e1'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 500 }}>
            {isRunning && <Loader2 size={16} className="spin" style={{ color: '#60a5fa' }} />}
            <span style={{ maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {progress.step || 'Synchronisation en cours...'}
            </span>
          </div>

          {progress.total > 0 && (
            <span style={{
              fontSize: '0.75rem',
              fontWeight: 700,
              padding: '0.2rem 0.6rem',
              borderRadius: '20px',
              background: 'rgba(255, 255, 255, 0.1)',
              color: '#93c5fd',
              letterSpacing: '0.5px'
            }}>
              {progress.current} / {progress.total}
            </span>
          )}
        </div>

        {/* Progress Bar Track */}
        <div style={{
          width: '100%',
          height: '14px',
          backgroundColor: 'rgba(15, 23, 42, 0.8)',
          borderRadius: '10px',
          overflow: 'hidden',
          padding: '2px',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          boxShadow: 'inset 0 2px 4px rgba(0, 0, 0, 0.4)',
          marginBottom: '1.25rem'
        }}>
          <div style={{
            height: '100%',
            width: `${Math.max(3, Math.min(100, progress.percentage))}%`,
            background: isError 
              ? 'linear-gradient(90deg, #f87171 0%, #ef4444 100%)' 
              : isSuccess 
              ? 'linear-gradient(90deg, #34d399 0%, #10b981 100%)' 
              : isPush 
              ? 'linear-gradient(90deg, #3b82f6 0%, #6366f1 100%)' 
              : 'linear-gradient(90deg, #06b6d4 0%, #3b82f6 100%)',
            borderRadius: '8px',
            transition: 'width 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            boxShadow: isPush 
              ? '0 0 12px rgba(59, 130, 246, 0.6)' 
              : '0 0 12px rgba(6, 182, 212, 0.6)'
          }} />
        </div>

        {/* Percentage Counter & Status Footer */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: '0.85rem'
        }}>
          <div style={{ color: isError ? '#f87171' : isSuccess ? '#34d399' : '#94a3b8', fontWeight: 600 }}>
            {progress.message || (isRunning ? 'Synchronisation active...' : 'Terminé')}
          </div>

          <div style={{
            fontSize: '1.25rem',
            fontWeight: 800,
            fontFamily: 'monospace',
            color: isError ? '#f87171' : isSuccess ? '#34d399' : '#60a5fa'
          }}>
            {progress.percentage}%
          </div>
        </div>

        {/* Close Button when done */}
        {!isRunning && (
          <button
            onClick={onClose}
            className="btn btn-primary"
            style={{
              width: '100%',
              marginTop: '1.5rem',
              padding: '0.75rem',
              fontSize: '0.95rem',
              fontWeight: 600,
              borderRadius: '10px',
              background: isError 
                ? 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)' 
                : 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)'
            }}
          >
            Fermer
          </button>
        )}
      </div>
    </div>
  );
}
