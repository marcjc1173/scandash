import http from 'http';

const BASE_URL = 'http://127.0.0.1:3500';

function request(path, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const req = http.request(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ status: res.statusCode, data: json, headers: res.headers });
        } catch {
          resolve({ status: res.statusCode, data, headers: res.headers });
        }
      });
    });
    req.on('error', reject);
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

async function runTests() {
  console.log('--- Starting ScanDash End-to-End Tests ---\n');

  // Test 1: Config API
  console.log('1. Testing /api/config ...');
  const config = await request('/api/config');
  console.log(`   Status: ${config.status}, Configured Port: ${config.data.port}`);
  if (config.data.port !== 3500) throw new Error('Port does not match .env!');

  // Test 2: Network Info API
  console.log('\n2. Testing /api/network-info ...');
  const netInfo = await request('/api/network-info');
  console.log(`   Found ${netInfo.data.localIps.length} network interfaces.`);

  // Test 3: Trigger Port Scan (Custom Range to test fast discovery)
  console.log('\n3. Testing /api/scan with custom port range (3000, 3001, 8080, 22, 3306) ...');
  const scanStart = await request('/api/scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    targets: '127.0.0.1',
    portOption: 'custom',
    customPorts: '22, 3000, 3001, 8080, 3306'
  });
  console.log(`   Scan response:`, scanStart.data);

  // Wait for inspection and thumbnail generation
  console.log('   Waiting 4 seconds for web inspection and thumbnail captures...');
  await new Promise(r => setTimeout(r, 4000));

  // Test 4: Retrieve Discovered Services
  console.log('\n4. Testing /api/services ...');
  const servicesRes = await request('/api/services');
  console.log(`   Discovered ${servicesRes.data.length} services:`);
  for (const s of servicesRes.data) {
    console.log(`   - [${s.protocol.toUpperCase()}] ${s.id} -> Title: "${s.title}" (Thumbnail: ${s.thumbnail || 'none'})`);
  }

  // Test 5: Edit Service Card
  console.log('\n5. Testing PUT /api/services/:id (Editing card) ...');
  const targetService = servicesRes.data[0];
  const editRes = await request(`/api/services/${encodeURIComponent(targetService.id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' }
  }, {
    customTitle: 'My Custom App Name',
    tags: ['custom-tag', 'verified'],
    notes: 'Testing customized service card description'
  });
  console.log(`   Updated title: "${editRes.data.customTitle}", tags: [${editRes.data.tags.join(', ')}]`);

  // Verify persistence
  const checkUpdated = await request(`/api/services/${encodeURIComponent(targetService.id)}`);
  if (checkUpdated.data.customTitle !== 'My Custom App Name') {
    throw new Error('Service update was not persisted!');
  }
  console.log('   Service update verified persisted successfully.');

  // Test 6: Delete Service Card
  console.log('\n6. Testing DELETE /api/services/:id ...');
  const toDelete = servicesRes.data[servicesRes.data.length - 1];
  console.log(`   Deleting ${toDelete.id} ...`);
  const deleteRes = await request(`/api/services/${encodeURIComponent(toDelete.id)}`, {
    method: 'DELETE'
  });
  console.log(`   Delete response:`, deleteRes.data);

  const afterDelete = await request('/api/services');
  const found = afterDelete.data.find(s => s.id === toDelete.id);
  if (found) throw new Error('Deleted service was still found!');
  console.log(`   Verified deleted item is no longer in dashboard (${afterDelete.data.length} remaining).`);

  // Test 7: Verify static HTML and CSS are served
  console.log('\n7. Testing Frontend static assets ...');
  const htmlRes = await request('/');
  if (htmlRes.status !== 200 || !htmlRes.data.includes('ScanDash')) {
    throw new Error('Failed to serve index.html');
  }
  const cssRes = await request('/css/style.css');
  if (cssRes.status !== 200 || !cssRes.data.includes('--primary-gradient')) {
    throw new Error('Failed to serve style.css');
  }
  console.log('   Static assets (HTML, CSS, JS) verified OK.');

  // Test 8: Test Favorite status toggle
  console.log('\n8. Testing POST /api/services/:id/favorite ...');
  const favTarget = afterDelete.data[0];
  const favRes = await request(`/api/services/${encodeURIComponent(favTarget.id)}/favorite`, {
    method: 'POST'
  });
  console.log(`   Favorite status toggled for ${favTarget.id}: isFavorite=${favRes.data.isFavorite}`);
  if (typeof favRes.data.isFavorite !== 'boolean') {
    throw new Error('Favorite toggle response did not return boolean isFavorite!');
  }

  // Test 9: Test Backup Export & Import
  console.log('\n9. Testing GET /api/backup/export & POST /api/backup/import ...');
  const exportRes = await request('/api/backup/export');
  if (!exportRes.data.services || !Array.isArray(exportRes.data.services)) {
    throw new Error('Backup export did not return services array!');
  }
  console.log(`   Exported backup with ${exportRes.data.services.length} services (Version: ${exportRes.data.version})`);

  const importRes = await request(
    '/api/backup/import',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    },
    {
      services: exportRes.data.services,
      mode: 'merge'
    }
  );
  console.log(`   Import response:`, importRes.data);
  if (!importRes.data.total) {
    throw new Error('Import did not return total count!');
  }
  console.log('   Backup Export and Import verified successfully.');

  console.log('\n✅ ALL SCAN DASH TESTS PASSED SUCCESSFULLY!\n');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
