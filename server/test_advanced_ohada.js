const http = require('http');

function post(url, bodyData) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(bodyData || {});
    const req = http.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    }, res => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => resolve(JSON.parse(b)));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => resolve(JSON.parse(b)));
    }).on('error', reject);
  });
}

async function runTests() {
  console.log('Testing Auto Lettrage...');
  const autoRes = await post('http://localhost:3003/api/lettrage/auto', {});
  console.log('Auto lettrage result:', autoRes);

  console.log('\nTesting Balance Âgée Client...');
  const ageeClients = await get('http://localhost:3003/api/echeances/balance-agee?type=client');
  console.log('Balance Âgée Clients count:', ageeClients.length);

  console.log('\nTesting Rapprochement State...');
  const rappState = await get('http://localhost:3003/api/rapprochement/etat');
  console.log('Statement lines:', rappState.statementLines.length, 'Journal Bank lines:', rappState.journalBankLines.length);

  process.exit(0);
}

runTests().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
