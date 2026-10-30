const sqlite3 = require('sqlite3').verbose();
const dbPath = 'C:/Users/USER/Desktop/Compta 26.sqlite';
const db = new sqlite3.Database(dbPath);

function query(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

async function run() {
  try {
    console.log('=== 1. JOURNAUX (CODE_JOURNAL) DANS LA BASE ===');
    const journals = await query('SELECT code_journal, count(*) as count, round(sum(debit), 2) as debit, round(sum(credit), 2) as credit FROM journal GROUP BY code_journal');
    console.table(journals);

    console.log('\n=== 2. COMPTES 57 (CAISSE) DANS LA BASE ===');
    const c57 = await query("SELECT DISTINCT compte FROM journal WHERE compte LIKE '57%' ORDER BY compte");
    console.table(c57);

    console.log('\n=== 3. TOTAUX PAR COMPTE 57 EN SEPTEMBRE 2026 ===');
    const c57Tot = await query("SELECT compte, round(sum(debit),2) as debit, round(sum(credit),2) as credit FROM journal WHERE compte LIKE '57%' AND date LIKE '2026-09%' GROUP BY compte");
    console.table(c57Tot);

    console.log('\n=== 4. EXEMPLES ECRITURES JOURNAL CAISSE (CAI) SEPT 2026 ===');
    const caiRows = await query("SELECT date, piece_id, reference, compte, libelle, debit, credit FROM journal WHERE code_journal = 'CAI' AND date LIKE '2026-09%' LIMIT 10");
    console.table(caiRows);

    console.log('\n=== 5. ANALYSE DES ECRITURES AVEC HORS FACTURE TP EN SEPT 2026 ===');
    const vteHf = await query("SELECT date, piece_id, reference, compte, libelle, debit, credit FROM journal WHERE libelle LIKE '%HORS FACTURE TP%' AND date LIKE '2026-09%' LIMIT 10");
    console.table(vteHf);

    if (vteHf.length > 0) {
      const refs = [...new Set(vteHf.slice(0, 5).map(r => r.reference || r.piece_id))];
      console.log('\nVérification des pièces/références associées dans toute la base :', refs);
      for (const ref of refs) {
        if (!ref) continue;
        const allRows = await query("SELECT code_journal, date, piece_id, reference, compte, libelle, debit, credit FROM journal WHERE reference = ? OR piece_id = ?", [ref, ref]);
        console.log(`\n--- Référence: ${ref} ---`);
        console.table(allRows);
      }
    }

    console.log('\n=== 6. CHERCHER EN CAISSE SI DES ECRITURES ONT DES LIBELLES DE FACTURES TP / FTP ===');
    const caiMatches = await query("SELECT code_journal, date, piece_id, reference, compte, libelle, debit, credit FROM journal WHERE code_journal = 'CAI' AND (libelle LIKE '%FTP%' OR libelle LIKE '%FACT%') AND date LIKE '2026-09%' LIMIT 10");
    console.table(caiMatches);

    console.log('\n=== 7. CHERCHER TOUS LES LIBELLES DE CAISSE EN SEPTEMBRE 2026 (DISTINCT OU TOP 20) ===');
    const caiLibelles = await query("SELECT libelle, count(*) as cnt, round(sum(debit),2) as deb, round(sum(credit),2) as cred FROM journal WHERE code_journal = 'CAI' AND date LIKE '2026-09%' GROUP BY libelle ORDER BY cnt DESC LIMIT 20");
    console.table(caiLibelles);

  } catch (e) {
    console.error('Error during execution:', e);
  } finally {
    db.close();
  }
}

run();
