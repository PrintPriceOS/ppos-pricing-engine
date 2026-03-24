'use strict';

/**
 * Smoke check — validates that exports load and the basic pipeline runs.
 * Used by CI. Exit 0 = pass, exit 1 = fail.
 */

let passed = 0;
let failed = 0;

function check(label, fn) {
    try {
        const result = fn();
        if (result === false) throw new Error('returned false');
        console.log(`  ✓ ${label}`);
        passed++;
    } catch (err) {
        console.error(`  ✗ ${label} — ${err.message}`);
        failed++;
    }
}

console.log('\n[smoke-check] ppos-pricing-engine\n');

// --- Exports ---
let Repository, Normalizer, buildPrice, estimateAll, EstimatesService;

check('index loads without error', () => {
    ({ Repository, Normalizer, buildPrice, estimateAll, EstimatesService } = require('./index'));
});

check('Repository is exported',       () => typeof Repository       === 'function');
check('Normalizer is exported',       () => typeof Normalizer       === 'function');
check('buildPrice is exported',       () => typeof buildPrice       === 'function');
check('estimateAll is exported',      () => typeof estimateAll      === 'function');
check('EstimatesService is exported', () => typeof EstimatesService === 'function');

// --- Repository ---
let repo;
check('Repository instantiates', () => { repo = new Repository(); return true; });
check('Repository loads data',   () => repo.debugMeta().errors.length === 0);
check('Repository has houses',   () => repo.all().length > 0);

// --- EstimatesService ---
let service;
check('EstimatesService instantiates', () => { service = new EstimatesService(repo); return true; });

check('estimate() with defaults returns ok', () => {
    const r = service.estimate({});
    return r.ok === true && r.engine === 'json-engine-v2.9';
});

// --- Summary ---
console.log(`\n${'─'.repeat(40)}`);
console.log(`Smoke check: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
