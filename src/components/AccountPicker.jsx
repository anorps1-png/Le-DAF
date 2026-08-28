import { useState, useEffect, useRef } from 'react';

// Sélecteur de compte avec liste déroulante (n° + intitulé), filtrable en tapant : le champ reste
// un texte libre (un compte peut être utilisé pour la première fois), la liste n'est qu'une aide.
export const AccountPicker = ({ value, onChange, accounts, style, placeholder }) => {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const q = String(value || '').trim().toLowerCase();
  const filtered = (!q
    ? accounts
    : accounts.filter(a => a.compte.toLowerCase().includes(q) || a.libelle.toLowerCase().includes(q))
  ).slice(0, 50);

  return (
    <div ref={wrapRef} style={{ position: 'relative', ...style }}>
      <input
        className="input"
        style={{ padding: '0.35rem', width: '100%' }}
        value={value || ''}
        placeholder={placeholder || 'N° compte'}
        onFocus={() => setOpen(true)}
        onChange={e => { onChange(e.target.value); setOpen(true); }}
      />
      {open && filtered.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, zIndex: 50, marginTop: '2px',
          width: '340px', maxHeight: '260px', overflowY: 'auto', textAlign: 'left',
          background: 'var(--color-bg, #fff)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
          boxShadow: '0 4px 16px rgba(0,0,0,0.18)'
        }}>
          {filtered.map(a => (
            <div
              key={a.compte}
              onMouseDown={(e) => { e.preventDefault(); onChange(a.compte); setOpen(false); }}
              style={{ padding: '0.4rem 0.6rem', cursor: 'pointer', fontSize: '0.8rem', borderBottom: '1px solid rgba(0,0,0,0.05)' }}
            >
              <strong>{a.compte}</strong> — {a.libelle}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
