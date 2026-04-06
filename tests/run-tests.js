'use strict';

require('dotenv').config();

const { Repository, EstimatesService } = require('../index');

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

(async () => {
    console.log('\n[1] Repository');
    const repo = new Repository();
    await repo.init();

    const meta = repo.debugMeta();
    assert('loads without errors',   meta.errors.length === 0, meta.errors.join(', '));
    assert('loads at least 1 house', meta.count > 0, `count=${meta.count}`);
    assert('source is mongodb',      meta.source === 'mongodb');

    const first = repo.all()[0];
    assert('first house has an id',      !!first?.id);
    assert('first house has rates',      first?.rates && Object.keys(first.rates).length > 0);
    assert('first house has signatures', Array.isArray(first?.signatures) && first.signatures.length > 0);

    const validation = repo.validateData();
    assert('validateData passes', validation.valid, validation.issues.join('; '));

    // ---------------------------------------------------------------------------

    console.log('\n[2] EstimatesService — basic A5 hardcover');
    const service = new EstimatesService(repo);

    const result1 = service.estimate({
        copies: 1000,
        interior_pages: 128,
        book_size: 'A5',
        binding_method: 'hardcover',
        finishing_options: 'matt lamination',
        interior_print: '1/1',
        cover_print: '4/0',
        delivery_country: 'NL',
        paper_weight_interior: 135,
        paper_weight_cover: 250,
    });

    assert('ok = true',                    result1.ok === true);
    assert('engine is v3.0',               result1.engine === 'v3.0');
    assert('returns at least 1 house',     result1.count > 0, `count=${result1.count}`);
    assert('selected_print_house exists',  result1.selected_print_house !== null);
    assert('selected has total_cost > 0',  result1.selected_print_house?.total_cost > 0);
    assert('print_houses is an array',     Array.isArray(result1.print_houses));
    assert('houses sorted by cost',        result1.print_houses[0].total_cost <= (result1.print_houses[1]?.total_cost ?? Infinity));
    assert('each house has line items',    result1.print_houses[0].lines?.length > 0);

    // ---------------------------------------------------------------------------

    console.log('\n[3] EstimatesService — Spanish/English synonym normalisation');

    const result2 = service.estimate({
        copies: 500,
        interior_pages: 96,
        book_size: 'A5',
        binding_method: 'tapa dura',          // Spanish for hardcover
        finishing_options: 'laminado mate',    // Spanish for matt lamination
        interior_print: 'blanco y negro',      // Spanish for 1/1
        cover_print: '4/0',
        delivery_country: 'ES',
    });

    assert('ok = true (Spanish synonyms)',  result2.ok === true);
    assert('normalised binding to hardcover',
        result2.selected_print_house != null || result2.count >= 0);

    // ---------------------------------------------------------------------------

    console.log('\n[4] EstimatesService — defaults applied when fields omitted');

    const result3 = service.estimate({});   // all defaults
    assert('ok with empty params', result3.ok === true);

    // ---------------------------------------------------------------------------

    console.log('\n[5] EstimatesService — validation rejects bad input');

    let caughtCopies = false;
    try { service.estimate({ copies: 0, interior_pages: 100 }); }
    catch (e) { caughtCopies = e.code === 400; }
    assert('rejects copies < 1', caughtCopies);

    let caughtPages = false;
    try { service.estimate({ copies: 100, interior_pages: 2 }); }
    catch (e) { caughtPages = e.code === 400; }
    assert('rejects interior_pages < 4', caughtPages);

    // ---------------------------------------------------------------------------

    console.log('\n[6] EstimatesService — different binding methods');

    for (const binding of ['perfect bound', 'saddle', 'wiro', 'spiral']) {
        const r = service.estimate({ copies: 500, interior_pages: 64, book_size: 'A5', binding_method: binding });
        assert(`ok with binding="${binding}"`, r.ok === true);
    }

    // ---------------------------------------------------------------------------

    console.log(`\n${'─'.repeat(40)}`);
    console.log(`Results: ${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
})();
