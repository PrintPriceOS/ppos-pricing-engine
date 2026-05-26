'use strict';

const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');

// Load environment variables from BPE, Control Plane, or Budget server environments
const searchPaths = [
    path.join(__dirname, '..', '.env'),
    path.join(__dirname, '..', '..', 'ppos-control-plane-phase-10-intelligence-layer', '.env'),
    path.join(__dirname, '..', '..', 'PrintPricePro_BookPrice-feature-adversarial-node-v5.2', 'server', '.env')
];

for (const envPath of searchPaths) {
    if (fs.existsSync(envPath)) {
        require('dotenv').config({ path: envPath });
        break;
    }
}

const JWT_SECRET = process.env.JWT_SECRET || process.env.BPE_JWT_SECRET || '85Kr/w0fiPkDHsisReEPBXhPVVJyVej5Fcy1dU3MvuQ=';

console.log('[SMOKE_TEST] Using JWT_SECRET:', JWT_SECRET ? '(loaded)' : 'not found');

const token = jwt.sign(
    { sub: 'bpe-system-user' },
    JWT_SECRET,
    {
        issuer: 'https://auth.printprice.pro',
        audience: 'ppos:control',
        expiresIn: 60
    }
);

async function callMarketplaceOffers(payload) {
    const response = await fetch('http://127.0.0.1:8081/api/marketplace/offers', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Request failed with status ${response.status}: ${text}`);
    }

    return response.json();
}

async function run() {
    console.log('[SMOKE_TEST] Running Case A...');
    const caseA = {
        copies: 100,
        interior_pages: 200,
        delivery_country: 'MX',
        book_size: 'A5'
    };
    const resA = await callMarketplaceOffers(caseA);
    console.log('Case A Response offers count:', resA.offers ? resA.offers.length : 0);

    console.log('[SMOKE_TEST] Running Case B...');
    const caseB = {
        copies: 1800,
        interior_pages: 360,
        delivery_country: 'ES',
        book_size: 'A5'
    };
    const resB = await callMarketplaceOffers(caseB);
    console.log('Case B Response offers count:', resB.offers ? resB.offers.length : 0);

    console.log('[SMOKE_TEST] Running Case C...');
    const caseC = {
        copies: 6000,
        interior_pages: 120,
        delivery_country: 'DE',
        book_size: 'A4'
    };
    const resC = await callMarketplaceOffers(caseC);
    console.log('Case C Response offers count:', resC.offers ? resC.offers.length : 0);

    // Assertions
    if (!resA.offers || resA.offers.length === 0) throw new Error('Case A has no offers');
    if (!resB.offers || resB.offers.length === 0) throw new Error('Case B has no offers');
    if (!resC.offers || resC.offers.length === 0) throw new Error('Case C has no offers');

    const checkOffer = (off) => {
        const p = off.suggested_price ?? off.total_price;
        const c = off.production_cost ?? off.total_cost;
        if (typeof p !== 'number' || isNaN(p)) throw new Error(`Invalid suggested_price for printer ${off.printer_id}`);
        if (typeof c !== 'number' || isNaN(c)) throw new Error(`Invalid production_cost for printer ${off.printer_id}`);
        if (!off.printer_name) throw new Error(`Missing printer_name for printer ${off.printer_id}`);
    };

    resA.offers.forEach(checkOffer);
    resB.offers.forEach(checkOffer);
    resC.offers.forEach(checkOffer);

    // Check pricing variance between Case B and Case C
    const pricesB = resB.offers.map(o => o.suggested_price ?? o.total_price).sort();
    const pricesC = resC.offers.map(o => o.suggested_price ?? o.total_price).sort();

    console.log('[SMOKE_TEST] Case B prices:', pricesB);
    console.log('[SMOKE_TEST] Case C prices:', pricesC);

    const allStaticB = resB.offers.every(o => {
        const p = o.suggested_price ?? o.total_price;
        return [2607.2429, 2718.3, 2752.1571].some(fp => Math.abs(p - fp) < 0.01);
    });

    const allStaticC = resC.offers.every(o => {
        const p = o.suggested_price ?? o.total_price;
        return [2607.2429, 2718.3, 2752.1571].some(fp => Math.abs(p - fp) < 0.01);
    });

    if (allStaticB && allStaticC) {
        throw new Error('BPE_STATIC_PRICING_DETECTED');
    }

    let differs = false;
    for (let i = 0; i < Math.min(pricesB.length, pricesC.length); i++) {
        if (Math.abs(pricesB[i] - pricesC[i]) > 0.01) {
            differs = true;
            break;
        }
    }

    if (!differs) {
        throw new Error('No price variance detected between Case B and Case C');
    }

    // Check source fields
    resB.offers.forEach(o => {
        if (o.source === 'BPE_STATIC_FALLBACK') {
            throw new Error(`Offer ${o.printer_id} returned fallback source on valid specifications`);
        }
    });

    console.log('[SMOKE_TEST] All assertions passed successfully! Price variance confirmed.');
}

run().catch(err => {
    console.error('[SMOKE_TEST] FAILED:', err.message);
    process.exit(1);
});
