// Zone Administrateur : mot de passe requis pour toute action pouvant toucher un exercice
// comptable autre que l'exercice actif (édition/suppression manuelle, SQL exécuté par le Cerveau
// IA, etc.) — voir server/index.js (ADMIN_LOCKED, hasValidAdminToken). Sans piste d'audit dans ce
// logiciel, c'est le seul garde-fou contre une correction accidentelle d'un exercice antérieur.
// Une fois déverrouillé, le jeton est mémorisé pour toute la session (sessionStorage) : pas besoin
// de ressaisir le mot de passe à chaque action tant que l'appli reste ouverte.
export async function unlockAdminZone() {
  const password = window.prompt("Cette action concerne un exercice différent de l'exercice actif.\nMot de passe Zone Administrateur :");
  if (!password) return null;
  try {
    const res = await fetch('/api/admin/unlock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    const data = await res.json();
    if (!res.ok) {
      window.alert(data.error || 'Mot de passe incorrect.');
      return null;
    }
    sessionStorage.setItem('adminToken', data.token);
    return data.token;
  } catch (e) {
    window.alert('Erreur réseau lors du déverrouillage.');
    return null;
  }
}

// Remplace fetch() pour toute action pouvant toucher un autre exercice que l'actif : rejoue
// automatiquement la requête avec le jeton Zone Administrateur si le serveur la refuse pour cette
// raison (code ADMIN_LOCKED).
export async function adminFetch(url, options = {}) {
  const existingToken = sessionStorage.getItem('adminToken') || '';
  const withToken = (token) => ({ ...options, headers: { ...(options.headers || {}), ...(token ? { 'X-Admin-Token': token } : {}) } });
  let res = await fetch(url, withToken(existingToken));
  if (res.status === 403) {
    let data = null;
    try { data = await res.clone().json(); } catch (e) { /* réponse non-JSON, ignorer */ }
    if (data && data.code === 'ADMIN_LOCKED') {
      const newToken = await unlockAdminZone();
      if (newToken) {
        res = await fetch(url, withToken(newToken));
      }
    }
  }
  return res;
}
