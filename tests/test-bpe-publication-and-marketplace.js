/**
 * PrintPrice OS — Pricing Engine
 *
 * Tests for BPE Rate Publication, MongoDB Readback, Idempotency,
 * Multi-Repository Propagation, and Elimination of Static Fallback.
 */

'use strict';

const fastifyFactory = require('fastify');
const testHouse = require('./fixtures/test-house');
const { Repository, EstimatesService } = require('../index');
const { computeRatesChecksum } = require('../src/RatesChecksum');
const { mapEstimateToMarketplaceOffers } = require('../src/MarketplaceOfferMapper');
const mongodb = require('mongodb');

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

// Deep clone helper
function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
}

(async () => {
    console.log('\n================================================================');
    console.log('BPE PUBLICATION, PERSISTENCE & CALCULATION VERIFICATION SUITE');
    console.log('================================================================');

    // ──────────────────────────────────────────────────────────────────────────
    // 1. UNIT TESTS: Checksum, Repository Broadcast & Dimensions Mapping
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n[1] Checksum & Repository Multi-Instance Propagation (Unit Tests)');

    const sampleRates = {
        paper_price_cover_by_kilo: { mc: 1.50 },
        interior_one_colour_fixed: { '16p': 18 },
        cover_fixed_by_colours: { '4': 65 }
    };

    const checksum1 = computeRatesChecksum(sampleRates);
    assert('computeRatesChecksum returns sha256 prefix', checksum1.startsWith('sha256:'));

    // Deterministic sorted-key property
    const sampleRatesReordered = {
        cover_fixed_by_colours: { '4': 65 },
        paper_price_cover_by_kilo: { mc: 1.50 },
        interior_one_colour_fixed: { '16p': 18 }
    };
    const checksum2 = computeRatesChecksum(sampleRatesReordered);
    assert('computeRatesChecksum is key-order independent', checksum1 === checksum2);

    // Multi-instance Repository broadcast
    const repoA = new Repository();
    const repoB = new Repository();
    repoA.loadFromArray([clone(testHouse)]);
    repoB.loadFromArray([clone(testHouse)]);

    const initialRateA = repoA.find(testHouse.id).rates.paper_price_cover_by_kilo.mc;
    const initialRateB = repoB.find(testHouse.id).rates.paper_price_cover_by_kilo.mc;
    assert('repoA and repoB initialized with identical rates', initialRateA === initialRateB);

    const updatedRates = clone(testHouse.rates);
    updatedRates.paper_price_cover_by_kilo.mc = 99.99;

    const broadcastCount = Repository.broadcastRatesUpdate(testHouse.id, updatedRates, {
        accepted_patch_checksum: 'sha256:test_patch_123',
        rates_checksum: computeRatesChecksum(updatedRates),
        revision_id: 'rev_test_001',
        version: 2,
        printer_node_id: 'node_1',
        tenant_id: 'tenant_1'
    });

    assert('broadcast updated at least 2 instances', broadcastCount >= 2);
    assert('repoA cache reflects updated rate', repoA.find(testHouse.id).rates.paper_price_cover_by_kilo.mc === 99.99);
    assert('repoB cache reflects updated rate', repoB.find(testHouse.id).rates.paper_price_cover_by_kilo.mc === 99.99);
    assert('repoA has version 2', repoA.find(testHouse.id).version === 2);
    assert('repoB has version 2', repoB.find(testHouse.id).version === 2);

    repoA.destroy();
    repoB.destroy();

    // ──────────────────────────────────────────────────────────────────────────
    // 2. CONNECTED ROUTE TESTS: Elimination of BPE_STATIC_FALLBACK
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n[2] Elimination of BPE_STATIC_FALLBACK & Strict Engine Calculation');

    // In-memory mock database collection for MongoDB
    const mockMongoHouses = [
        {
            _id: new mongodb.ObjectId(),
            id: testHouse.id,
            house_id: testHouse.id,
            name: testHouse.name,
            tenant_id: 'tenant_alpha',
            printer_node_id: 'node_alpha',
            version: 1,
            accepted_patch_checksum: 'sha256:initial_checksum',
            published_revision_id: 'rev_init',
            rates: clone(testHouse.rates),
            signatures: clone(testHouse.signatures),
            production_lead_days: testHouse.production_lead_days,
            shipping_days: testHouse.shipping_days,
            limits: clone(testHouse.limits),
            shipping: clone(testHouse.shipping),
            updated_at: new Date()
        }
    ];

    let clientCloseCalled = 0;
    let simulateMongoError = false;
    let simulateReadbackCorruption = false;

    // Spy/Mock MongoClient to simulate isolated MongoDB operations
    const originalDescriptor = Object.getOwnPropertyDescriptor(mongodb, 'MongoClient');
    function MockMongoClient(uri) {
        this.uri = uri;
        this.connect = async () => {
            if (simulateMongoError) throw new Error('Simulated Mongo connection failure');
            return this;
        };
        this.close = async () => {
            clientCloseCalled++;
        };
        this.db = () => ({
            collection: (collName) => ({
                find: () => ({
                    toArray: async () => clone(mockMongoHouses)
                }),
                findOne: async (query) => {
                    if (query._id) {
                        const found = mockMongoHouses.find(h => h._id.equals(query._id));
                        if (!found) return null;
                        if (simulateReadbackCorruption) {
                            return { ...clone(found), accepted_patch_checksum: 'sha256:corrupted_checksum' };
                        }
                        return clone(found);
                    }
                    if (query.$or) {
                        return clone(mockMongoHouses.find(h => query.$or.some(cond => (cond.id && h.id === cond.id) || (cond.house_id && h.house_id === cond.house_id))) || null);
                    }
                    return null;
                },
                updateOne: async (filter, update) => {
                    const house = mockMongoHouses.find(h => h._id.equals(filter._id));
                    if (!house) return { matchedCount: 0, modifiedCount: 0 };
                    Object.assign(house, update.$set);
                    return { matchedCount: 1, modifiedCount: 1 };
                }
            })
        });
    }

    Object.defineProperty(mongodb, 'MongoClient', {
        value: MockMongoClient,
        configurable: true,
        writable: true
    });

    const app = fastifyFactory({ logger: false });
    process.env.PPOS_BPE_SERVICE_TOKEN = 'test_secret_service_token_12345';
    process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/test_bpe_db';

    const estimatesRoutes = require('../routes/estimates');
    const marketplaceOffersRoutes = require('../routes/marketplace-offers');

    // Register routes under /api
    await app.register(estimatesRoutes, { prefix: '/api' });
    await app.register(marketplaceOffersRoutes, { prefix: '/api' });

    // Valid spec payload with custom book_width_mm / book_height_mm
    const validPayload = {
        source: 'CONTROL_PLANE',
        tenant_id: 'tenant_alpha',
        trace_id: 'trace_001',
        copies: 1000,
        interior_pages: 128,
        book_size: 'custom',
        book_width_mm: 148,
        book_height_mm: 210,
        binding_method: 'hardcover',
        interior_print: '1/1',
        cover_print: '4/0',
        paper_type_interior: 'offset',
        paper_weight_interior: 80,
        paper_type_cover: 'mc',
        paper_weight_cover: 300,
        finishing_options: 'matt lamination',
        delivery_country: 'spain'
    };

    // Before publication: test calculation
    const calcBeforeRes = await app.inject({
        method: 'POST',
        url: '/api/marketplace/offers',
        payload: validPayload
    });

    assert('calcBeforeRes status 200', calcBeforeRes.statusCode === 200);
    const bodyBefore = JSON.parse(calcBeforeRes.payload);
    assert('calcBeforeRes ok is true', bodyBefore.ok === true);
    assert('calcBeforeRes source is not static fallback', bodyBefore.source !== 'BPE_STATIC_FALLBACK');
    assert('calcBeforeRes does NOT contain BPE_STATIC_PRICING_DETECTED warning', !bodyBefore.warnings?.includes('BPE_STATIC_PRICING_DETECTED'));
    const initialPrice = bodyBefore.offers[0].total_cost;
    assert('initialPrice is positive calculated number', typeof initialPrice === 'number' && initialPrice > 0);

    // Test calculation failure returns explicit error, NEVER static fallback
    const invalidPayload = {
        copies: 0, // Invalid: copies < 1
        interior_pages: 2
    };

    const failRes = await app.inject({
        method: 'POST',
        url: '/api/marketplace/offers',
        payload: invalidPayload
    });

    assert('invalid payload returns error status (400 or 422)', failRes.statusCode >= 400);
    const failBody = JSON.parse(failRes.payload);
    assert('invalid payload returns ok=false', failBody.ok === false);
    assert('invalid payload never returns fabricated offers array', !Array.isArray(failBody.offers));

    // ──────────────────────────────────────────────────────────────────────────
    // 3. AUTHENTICATION & INPUT VALIDATION IN PUBLICATION ENDPOINT
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n[3] Publication Endpoint Authentication & Validation');

    // Missing token
    const noAuthRes = await app.inject({
        method: 'POST',
        url: '/api/marketplace/revisions/publish',
        payload: { bpe_printhouse_id: testHouse.id }
    });
    assert('missing auth returns 401', noAuthRes.statusCode === 401);

    // Invalid token
    const badAuthRes = await app.inject({
        method: 'POST',
        url: '/api/marketplace/revisions/publish',
        headers: { 'X-BPE-Service-Token': 'wrong_token' },
        payload: { bpe_printhouse_id: testHouse.id }
    });
    assert('invalid auth returns 401', badAuthRes.statusCode === 401);

    // Missing required fields
    const missingFieldsRes = await app.inject({
        method: 'POST',
        url: '/api/marketplace/revisions/publish',
        headers: { 'X-BPE-Service-Token': 'test_secret_service_token_12345' },
        payload: { bpe_printhouse_id: testHouse.id } // missing tenant_id, rates, etc.
    });
    assert('missing required fields returns 400', missingFieldsRes.statusCode === 400);
    const missingBody = JSON.parse(missingFieldsRes.payload);
    assert('missing fields error code is MISSING_REQUIRED_FIELDS', missingBody.error === 'MISSING_REQUIRED_FIELDS');

    // ──────────────────────────────────────────────────────────────────────────
    // 4. MONGODB ISOLATION, PERSISTENCE, READBACK & ERROR ENFORCEMENT
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n[4] Isolated MongoDB Persistence, Readback Verification & Rejection Tests');

    // A. Printhouse not found
    const notFoundRes = await app.inject({
        method: 'POST',
        url: '/api/marketplace/revisions/publish',
        headers: { 'X-BPE-Service-Token': 'test_secret_service_token_12345' },
        payload: {
            tenant_id: 'tenant_alpha',
            printer_node_id: 'node_alpha',
            bpe_printhouse_id: 'non_existent_house',
            revision_id: 'rev_002',
            accepted_patch_checksum: 'sha256:patch_002',
            version: 2,
            rates: clone(testHouse.rates)
        }
    });
    assert('non-existent printhouse returns 404', notFoundRes.statusCode === 404);
    assert('non-existent printhouse status is NOT published', JSON.parse(notFoundRes.payload).status !== 'PUBLISHED');

    // B. Tenant mismatch
    const tenantMismatchRes = await app.inject({
        method: 'POST',
        url: '/api/marketplace/revisions/publish',
        headers: { 'X-BPE-Service-Token': 'test_secret_service_token_12345' },
        payload: {
            tenant_id: 'tenant_intruder', // Mismatch with tenant_alpha
            printer_node_id: 'node_alpha',
            bpe_printhouse_id: testHouse.id,
            revision_id: 'rev_002',
            accepted_patch_checksum: 'sha256:patch_002',
            version: 2,
            rates: clone(testHouse.rates)
        }
    });
    assert('tenant mismatch returns 403', tenantMismatchRes.statusCode === 403);
    assert('tenant mismatch is NEVER published', JSON.parse(tenantMismatchRes.payload).status !== 'PUBLISHED');

    // C. Printer node mismatch
    const nodeMismatchRes = await app.inject({
        method: 'POST',
        url: '/api/marketplace/revisions/publish',
        headers: { 'X-BPE-Service-Token': 'test_secret_service_token_12345' },
        payload: {
            tenant_id: 'tenant_alpha',
            printer_node_id: 'node_wrong', // Mismatch with node_alpha
            bpe_printhouse_id: testHouse.id,
            revision_id: 'rev_002',
            accepted_patch_checksum: 'sha256:patch_002',
            version: 2,
            rates: clone(testHouse.rates)
        }
    });
    assert('printer node mismatch returns 400', nodeMismatchRes.statusCode === 400);

    // C1. Unconfigured tenant mapping in BPE
    const savedTenantId = mockMongoHouses[0].tenant_id;
    mockMongoHouses[0].tenant_id = null;
    const unconfigTenantRes = await app.inject({
        method: 'POST',
        url: '/api/marketplace/revisions/publish',
        headers: { 'X-BPE-Service-Token': 'test_secret_service_token_12345' },
        payload: {
            tenant_id: 'tenant_alpha',
            printer_node_id: 'node_alpha',
            bpe_printhouse_id: testHouse.id,
            revision_id: 'rev_002',
            accepted_patch_checksum: 'sha256:patch_002',
            version: 2,
            rates: clone(testHouse.rates)
        }
    });
    assert('unconfigured tenant mapping returns 403', unconfigTenantRes.statusCode === 403);
    assert('unconfigured tenant error code is TENANT_MAPPING_UNCONFIGURED', JSON.parse(unconfigTenantRes.payload).error === 'TENANT_MAPPING_UNCONFIGURED');
    mockMongoHouses[0].tenant_id = savedTenantId;

    // C2. Unconfigured printer node mapping in BPE
    const savedNodeId = mockMongoHouses[0].printer_node_id;
    mockMongoHouses[0].printer_node_id = null;
    mockMongoHouses[0].control_plane_node_id = null;
    mockMongoHouses[0].node_id = null;
    const unconfigNodeRes = await app.inject({
        method: 'POST',
        url: '/api/marketplace/revisions/publish',
        headers: { 'X-BPE-Service-Token': 'test_secret_service_token_12345' },
        payload: {
            tenant_id: 'tenant_alpha',
            printer_node_id: 'node_alpha',
            bpe_printhouse_id: testHouse.id,
            revision_id: 'rev_002',
            accepted_patch_checksum: 'sha256:patch_002',
            version: 2,
            rates: clone(testHouse.rates)
        }
    });
    assert('unconfigured printer node mapping returns 400', unconfigNodeRes.statusCode === 400);
    assert('unconfigured node error code is PRINTER_NODE_MAPPING_UNCONFIGURED', JSON.parse(unconfigNodeRes.payload).error === 'PRINTER_NODE_MAPPING_UNCONFIGURED');
    mockMongoHouses[0].printer_node_id = savedNodeId;

    // D. Mongo failure handles error and closes client
    simulateMongoError = true;
    const mongoFailRes = await app.inject({
        method: 'POST',
        url: '/api/marketplace/revisions/publish',
        headers: { 'X-BPE-Service-Token': 'test_secret_service_token_12345' },
        payload: {
            tenant_id: 'tenant_alpha',
            printer_node_id: 'node_alpha',
            bpe_printhouse_id: testHouse.id,
            revision_id: 'rev_002',
            accepted_patch_checksum: 'sha256:patch_002',
            version: 2,
            rates: clone(testHouse.rates)
        }
    });
    assert('mongo failure returns 500', mongoFailRes.statusCode === 500);
    assert('mongo failure is NEVER published', JSON.parse(mongoFailRes.payload).status !== 'PUBLISHED');
    assert('client.close() called on failure', clientCloseCalled > 0);
    simulateMongoError = false;

    // E. Readback checksum corruption detection
    simulateReadbackCorruption = true;
    const corruptReadbackRes = await app.inject({
        method: 'POST',
        url: '/api/marketplace/revisions/publish',
        headers: { 'X-BPE-Service-Token': 'test_secret_service_token_12345' },
        payload: {
            tenant_id: 'tenant_alpha',
            printer_node_id: 'node_alpha',
            bpe_printhouse_id: testHouse.id,
            revision_id: 'rev_002',
            accepted_patch_checksum: 'sha256:patch_002',
            version: 2,
            rates: clone(testHouse.rates)
        }
    });
    assert('corrupted readback checksum returns 500', corruptReadbackRes.statusCode === 500);
    assert('corrupted readback is NEVER published', JSON.parse(corruptReadbackRes.payload).status !== 'PUBLISHED');
    simulateReadbackCorruption = false;

    // Reset mock house state back to pristine version 1 for subsequent tests
    mockMongoHouses[0].version = 1;
    mockMongoHouses[0].accepted_patch_checksum = 'sha256:initial_checksum';
    mockMongoHouses[0].published_revision_id = 'rev_init';
    mockMongoHouses[0].rates = clone(testHouse.rates);

    // F. Successful publication with double rate on cover paper and cover print
    const modifiedRates = clone(testHouse.rates);
    // Substantially raise paper rate for cover and fixed print to produce clear calculation change
    modifiedRates.paper_price_cover_by_kilo.mc = 15.0;
    modifiedRates.cover_fixed_by_colours['4'] = 500;
    const expectedNewRatesChecksum = computeRatesChecksum(modifiedRates);

    const publishSuccessRes = await app.inject({
        method: 'POST',
        url: '/api/marketplace/revisions/publish',
        headers: { 'X-BPE-Service-Token': 'test_secret_service_token_12345' },
        payload: {
            tenant_id: 'tenant_alpha',
            printer_node_id: 'node_alpha',
            bpe_printhouse_id: testHouse.id,
            revision_id: 'rev_002',
            accepted_patch_checksum: 'sha256:verified_patch_checksum_002',
            version: 2,
            rates: modifiedRates
        }
    });

    assert('successful publication returns 200', publishSuccessRes.statusCode === 200);
    const pubSuccessBody = JSON.parse(publishSuccessRes.payload);
    assert('status is PUBLISHED', pubSuccessBody.status === 'PUBLISHED');
    assert('accepted_patch_checksum matches Control Plane', pubSuccessBody.accepted_patch_checksum === 'sha256:verified_patch_checksum_002');
    assert('rates_checksum calculated accurately', pubSuccessBody.rates_checksum === expectedNewRatesChecksum);
    assert('readback.verified is true', pubSuccessBody.readback.verified === true);
    assert('readback.accepted_patch_checksum matches', pubSuccessBody.readback.accepted_patch_checksum === 'sha256:verified_patch_checksum_002');
    assert('readback.rates_checksum matches', pubSuccessBody.readback.rates_checksum === expectedNewRatesChecksum);

    // G. Idempotent re-submission of exact same revision
    const idempotentRes = await app.inject({
        method: 'POST',
        url: '/api/marketplace/revisions/publish',
        headers: { 'X-BPE-Service-Token': 'test_secret_service_token_12345' },
        payload: {
            tenant_id: 'tenant_alpha',
            printer_node_id: 'node_alpha',
            bpe_printhouse_id: testHouse.id,
            revision_id: 'rev_002',
            accepted_patch_checksum: 'sha256:verified_patch_checksum_002',
            version: 2,
            rates: modifiedRates
        }
    });
    assert('idempotent replay returns 200', idempotentRes.statusCode === 200);
    const idempBody = JSON.parse(idempotentRes.payload);
    assert('idempotent replay indicates already_published', idempBody.already_published === true);
    assert('idempotent replay status is PUBLISHED', idempBody.status === 'PUBLISHED');

    // G1. Replay attempt with same revision and patch checksum but conflicting rates payload -> rejected 409
    const conflictingRates = clone(modifiedRates);
    conflictingRates.paper_price_cover_by_kilo.mc = 999.99; // Tampered rate
    const replayConflictRes = await app.inject({
        method: 'POST',
        url: '/api/marketplace/revisions/publish',
        headers: { 'X-BPE-Service-Token': 'test_secret_service_token_12345' },
        payload: {
            tenant_id: 'tenant_alpha',
            printer_node_id: 'node_alpha',
            bpe_printhouse_id: testHouse.id,
            revision_id: 'rev_002',
            accepted_patch_checksum: 'sha256:verified_patch_checksum_002',
            version: 2,
            rates: conflictingRates
        }
    });
    assert('conflicting rates replay returns 409', replayConflictRes.statusCode === 409);
    assert('conflicting rates error code is RATES_CHECKSUM_MISMATCH', JSON.parse(replayConflictRes.payload).error === 'RATES_CHECKSUM_MISMATCH');

    // H. Outdated revision rejection (version 1 attempted after version 2)
    const outdatedRes = await app.inject({
        method: 'POST',
        url: '/api/marketplace/revisions/publish',
        headers: { 'X-BPE-Service-Token': 'test_secret_service_token_12345' },
        payload: {
            tenant_id: 'tenant_alpha',
            printer_node_id: 'node_alpha',
            bpe_printhouse_id: testHouse.id,
            revision_id: 'rev_old',
            accepted_patch_checksum: 'sha256:patch_old',
            version: 1, // < current version 2
            rates: modifiedRates
        }
    });
    assert('outdated version returns 409', outdatedRes.statusCode === 409);
    assert('outdated version error is OUTDATED_REVISION', JSON.parse(outdatedRes.payload).error === 'OUTDATED_REVISION');

    // I. Version conflict rejection (same version 2, different checksum)
    const conflictRes = await app.inject({
        method: 'POST',
        url: '/api/marketplace/revisions/publish',
        headers: { 'X-BPE-Service-Token': 'test_secret_service_token_12345' },
        payload: {
            tenant_id: 'tenant_alpha',
            printer_node_id: 'node_alpha',
            bpe_printhouse_id: testHouse.id,
            revision_id: 'rev_conflict',
            accepted_patch_checksum: 'sha256:different_patch_checksum',
            version: 2,
            rates: modifiedRates
        }
    });
    assert('version conflict returns 409', conflictRes.statusCode === 409);
    assert('version conflict error is VERSION_CONFLICT', JSON.parse(conflictRes.payload).error === 'VERSION_CONFLICT');

    // ──────────────────────────────────────────────────────────────────────────
    // 5. CALCULATION PROPAGATION TO BOTH ROUTES (Estimates & Marketplace)
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n[5] Both Calculation Routes Consume Published Rates');

    // Route 1: POST /api/marketplace/offers calculation after publication
    const calcAfterMarketplaceRes = await app.inject({
        method: 'POST',
        url: '/api/marketplace/offers',
        payload: validPayload
    });

    assert('calcAfterMarketplaceRes status 200', calcAfterMarketplaceRes.statusCode === 200);
    const bodyAfterMarketplace = JSON.parse(calcAfterMarketplaceRes.payload);
    const newPriceMarketplace = bodyAfterMarketplace.offers[0].total_cost;
    assert('marketplace calculation price changed after rate publication', newPriceMarketplace !== initialPrice);
    assert('new marketplace price is higher due to tripled cover paper rate', newPriceMarketplace > initialPrice);

    // Route 2: POST /api/estimates calculation after publication
    const calcAfterEstimatesRes = await app.inject({
        method: 'POST',
        url: '/api/estimates',
        payload: {
            copies: 1000,
            interior_pages: 128,
            book_size: 'custom',
            custom_width: 148,
            custom_height: 210,
            binding_method: 'hardcover',
            interior_print: '1/1',
            cover_print: '4/0',
            paper_type_interior: 'offset',
            paper_weight_interior: 80,
            paper_type_cover: 'mc',
            paper_weight_cover: 300,
            finishing_options: 'matt lamination',
            delivery_country: 'spain'
        }
    });

    assert('estimates route status 200', calcAfterEstimatesRes.statusCode === 200);
    const bodyAfterEstimates = JSON.parse(calcAfterEstimatesRes.payload);
    const newPriceEstimates = bodyAfterEstimates.selected_print_house.total_cost;
    assert('estimates route consumes published rates', newPriceEstimates === newPriceMarketplace);

    // Restore original MongoClient
    Object.defineProperty(mongodb, 'MongoClient', originalDescriptor);
    await app.close();

    console.log('\n────────────────────────────────────────────────────────────────');
    console.log(`Results: ${passed} passed, ${failed} failed`);
    console.log('────────────────────────────────────────────────────────────────');

    if (failed > 0) {
        process.exit(1);
    }
})();
