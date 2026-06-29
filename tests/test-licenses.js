'use strict';

const Fastify = require('fastify');
const licensesRoutes = require('../routes/licenses');

let passed = 0;
let failed = 0;

function assert(label, condition, detail = '') {
    if (condition) {
        console.log(`  ✓ ${label}`);
        passed++;
    } else {
        console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
        failed++;
    }
}

// ---------------------------------------------------------------------------
// In-memory mock of LicenseRepository
// ---------------------------------------------------------------------------

function createMockRepo() {
    const licenses = [
        {
            license_key: 'PPP-VALID-PRO-0001',
            plan: 'pro_calculator',
            customer: 'Test Pro Customer',
            status: 'active',
            expires_at: new Date('2099-12-31'),
            max_activations: 2,
            activated_sites: [],
            created_at: new Date(),
            updated_at: new Date(),
        },
        {
            license_key: 'PPP-NO-EXPIRE-0001',
            plan: 'marketplace_node',
            customer: 'Marketplace Customer',
            status: 'active',
            expires_at: null,
            max_activations: -1,
            activated_sites: [],
            created_at: new Date(),
            updated_at: new Date(),
        },
        {
            license_key: 'PPP-EXPIRED-0001',
            plan: 'pro_calculator',
            customer: 'Expired Customer',
            status: 'active',
            expires_at: new Date('2020-01-01'),
            max_activations: 3,
            activated_sites: [],
            created_at: new Date(),
            updated_at: new Date(),
        },
        {
            license_key: 'PPP-SUSPENDED-0001',
            plan: 'pro_calculator',
            customer: 'Suspended Customer',
            status: 'suspended',
            expires_at: null,
            max_activations: 3,
            activated_sites: [],
            created_at: new Date(),
            updated_at: new Date(),
        },
        {
            license_key: 'PPP-MAXED-0001',
            plan: 'pro_calculator',
            customer: 'Maxed Customer',
            status: 'active',
            expires_at: null,
            max_activations: 1,
            activated_sites: [
                { site_url: 'https://existing.example.com', plugin_version: '1.0.0', activated_at: new Date() },
            ],
            created_at: new Date(),
            updated_at: new Date(),
        },
    ];

    return {
        findByKey: async (key) => {
            const lic = licenses.find(l => l.license_key === key);
            return lic ? JSON.parse(JSON.stringify(lic, (k, v) => {
                if (v instanceof Date) return v;
                return v;
            })) : null;
        },
        addSiteActivation: async (key, siteUrl, pluginVersion) => {
            const lic = licenses.find(l => l.license_key === key);
            if (lic) {
                lic.activated_sites.push({
                    site_url: siteUrl,
                    plugin_version: pluginVersion,
                    activated_at: new Date(),
                });
                lic.updated_at = new Date();
            }
        },
        updateSiteActivation: async (key, siteUrl, pluginVersion) => {
            const lic = licenses.find(l => l.license_key === key);
            if (lic) {
                const site = lic.activated_sites.find(s => s.site_url === siteUrl);
                if (site) {
                    site.plugin_version = pluginVersion;
                    site.activated_at = new Date();
                }
                lic.updated_at = new Date();
            }
        },
        removeSiteActivation: async (key, siteUrl) => {
            const lic = licenses.find(l => l.license_key === key);
            if (lic) {
                lic.activated_sites = lic.activated_sites.filter(s => s.site_url !== siteUrl);
                lic.updated_at = new Date();
            }
        },
        close: async () => {},
    };
}

// ---------------------------------------------------------------------------

async function buildApp(mockRepo) {
    const app = Fastify({ logger: false });
    await app.register(licensesRoutes, {
        prefix: '/api',
        licenseRepository: mockRepo,
    });
    await app.ready();
    return app;
}

(async () => {
    // --- ACTIVATE ---
    console.log('\n[1] POST /api/licenses/activate');

    let repo = createMockRepo();
    let app = await buildApp(repo);

    let res = await app.inject({
        method: 'POST',
        url: '/api/licenses/activate',
        payload: { license_key: 'PPP-VALID-PRO-0001', site_url: 'https://shop.test.com', plugin_version: '1.0.0' },
    });
    assert('activate valid license → 200', res.statusCode === 200, `got ${res.statusCode}`);
    let body = JSON.parse(res.payload);
    assert('returns plan', body.plan === 'pro_calculator', `got ${body.plan}`);
    assert('returns customer', body.customer === 'Test Pro Customer');
    assert('returns expires_at as ISO string', typeof body.expires_at === 'string' && body.expires_at.length > 0);
    assert('returns message', body.message === 'License activated successfully');

    res = await app.inject({
        method: 'POST',
        url: '/api/licenses/activate',
        payload: { license_key: 'PPP-VALID-PRO-0001', site_url: 'https://shop.test.com', plugin_version: '2.0.0' },
    });
    assert('re-activate same site → 200', res.statusCode === 200);

    res = await app.inject({
        method: 'POST',
        url: '/api/licenses/activate',
        payload: { license_key: 'PPP-VALID-PRO-0001' },
    });
    assert('missing fields → 400', res.statusCode === 400);

    res = await app.inject({
        method: 'POST',
        url: '/api/licenses/activate',
        payload: { license_key: 'PPP-NONEXISTENT', site_url: 'https://x.com', plugin_version: '1.0' },
    });
    assert('unknown key → 404', res.statusCode === 404);

    res = await app.inject({
        method: 'POST',
        url: '/api/licenses/activate',
        payload: { license_key: 'PPP-EXPIRED-0001', site_url: 'https://x.com', plugin_version: '1.0' },
    });
    assert('expired license → 403', res.statusCode === 403);

    res = await app.inject({
        method: 'POST',
        url: '/api/licenses/activate',
        payload: { license_key: 'PPP-SUSPENDED-0001', site_url: 'https://x.com', plugin_version: '1.0' },
    });
    assert('suspended license → 403', res.statusCode === 403);
    body = JSON.parse(res.payload);
    assert('suspended message includes status', body.message.includes('suspended'));

    res = await app.inject({
        method: 'POST',
        url: '/api/licenses/activate',
        payload: { license_key: 'PPP-MAXED-0001', site_url: 'https://new-site.com', plugin_version: '1.0' },
    });
    assert('max activations reached → 403', res.statusCode === 403);

    res = await app.inject({
        method: 'POST',
        url: '/api/licenses/activate',
        payload: { license_key: 'PPP-NO-EXPIRE-0001', site_url: 'https://site1.com', plugin_version: '1.0' },
    });
    body = JSON.parse(res.payload);
    assert('null expires_at → empty string', body.expires_at === '', `got "${body.expires_at}"`);
    assert('unlimited activations → 200', res.statusCode === 200);

    await app.close();

    // --- DEACTIVATE ---
    console.log('\n[2] POST /api/licenses/deactivate');

    repo = createMockRepo();
    app = await buildApp(repo);

    await app.inject({
        method: 'POST',
        url: '/api/licenses/activate',
        payload: { license_key: 'PPP-VALID-PRO-0001', site_url: 'https://shop.test.com', plugin_version: '1.0.0' },
    });

    res = await app.inject({
        method: 'POST',
        url: '/api/licenses/deactivate',
        payload: { license_key: 'PPP-VALID-PRO-0001', site_url: 'https://shop.test.com' },
    });
    assert('deactivate active site → 200', res.statusCode === 200);

    res = await app.inject({
        method: 'POST',
        url: '/api/licenses/deactivate',
        payload: { license_key: 'PPP-VALID-PRO-0001', site_url: 'https://never-activated.com' },
    });
    assert('deactivate non-activated site → 200 (idempotent)', res.statusCode === 200);

    res = await app.inject({
        method: 'POST',
        url: '/api/licenses/deactivate',
        payload: { license_key: 'PPP-NONEXISTENT', site_url: 'https://x.com' },
    });
    assert('deactivate unknown key → 404', res.statusCode === 404);

    res = await app.inject({
        method: 'POST',
        url: '/api/licenses/deactivate',
        payload: { license_key: 'PPP-VALID-PRO-0001' },
    });
    assert('deactivate missing fields → 400', res.statusCode === 400);

    await app.close();

    // --- VERIFY ---
    console.log('\n[3] POST /api/licenses/verify');

    repo = createMockRepo();
    app = await buildApp(repo);

    await app.inject({
        method: 'POST',
        url: '/api/licenses/activate',
        payload: { license_key: 'PPP-VALID-PRO-0001', site_url: 'https://shop.test.com', plugin_version: '1.0.0' },
    });

    res = await app.inject({
        method: 'POST',
        url: '/api/licenses/verify',
        payload: { license_key: 'PPP-VALID-PRO-0001', site_url: 'https://shop.test.com' },
    });
    assert('verify active site → 200', res.statusCode === 200);
    body = JSON.parse(res.payload);
    assert('verify returns plan', body.plan === 'pro_calculator');
    assert('verify returns customer', body.customer === 'Test Pro Customer');

    res = await app.inject({
        method: 'POST',
        url: '/api/licenses/verify',
        payload: { license_key: 'PPP-VALID-PRO-0001', site_url: 'https://not-activated.com' },
    });
    assert('verify non-activated site → 403', res.statusCode === 403);

    res = await app.inject({
        method: 'POST',
        url: '/api/licenses/verify',
        payload: { license_key: 'PPP-EXPIRED-0001', site_url: 'https://x.com' },
    });
    assert('verify expired → 403', res.statusCode === 403);

    res = await app.inject({
        method: 'POST',
        url: '/api/licenses/verify',
        payload: { license_key: 'PPP-NONEXISTENT', site_url: 'https://x.com' },
    });
    assert('verify unknown key → 404', res.statusCode === 404);

    res = await app.inject({
        method: 'POST',
        url: '/api/licenses/verify',
        payload: { license_key: 'PPP-VALID-PRO-0001' },
    });
    assert('verify missing fields → 400', res.statusCode === 400);

    await app.close();

    // --- Summary ---
    console.log(`\n  ${passed} passed, ${failed} failed\n`);
    process.exit(failed > 0 ? 1 : 0);
})();
