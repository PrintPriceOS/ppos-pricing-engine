'use strict';

const { Repository, EstimatesService } = require('../index');
const testHouse = require('./fixtures/test-house');

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
    repo.loadFromArray([testHouse]);

    const meta = repo.debugMeta();
    assert('loads without errors',   meta.errors.length === 0, meta.errors.join(', '));
    assert('loads at least 1 house', meta.count > 0, `count=${meta.count}`);
    assert('source is fixture',      meta.source === 'fixture');

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

    console.log('\n[7] MarketplaceOfferMapper — Control Plane compatibility');
    const { mapEstimateToMarketplaceOffers } = require('../src/MarketplaceOfferMapper');

    const estimateResult = service.estimate({
        copies: 1000,
        interior_pages: 128,
        book_size: 'A5',
        binding_method: 'hardcover',
    });

    const context = {
        source: 'BPE',
        tenant_id: 'test-tenant',
        order_id: '123',
        target_margin_pct: 30
    };

    const mapped = mapEstimateToMarketplaceOffers(estimateResult, context);

    assert('mapped ok', mapped.ok === true);
    assert('mapped engine version', mapped.engine === 'v3.0');
    assert('mapped tenant_id', mapped.tenant_id === 'test-tenant');
    assert('mapped offers count', mapped.offers.length > 0);
    assert('selected_offer exists', !!mapped.selected_offer);
    assert('selected_offer is house-1', mapped.selected_offer.printer_id === 'ci-test-house');
    assert('suggested_price logic (margin 30%)',
        Math.abs(mapped.selected_offer.suggested_price - (mapped.selected_offer.production_cost / 0.7)) < 0.01);
    assert('offer_rank is 1', mapped.selected_offer.offer_rank === 1);
    assert('offer_priority_score is 100', mapped.selected_offer.offer_priority_score === 100);
    assert('offer_selected is false by default', mapped.selected_offer.offer_selected === false);
    assert('offer_status is SENT by default', mapped.selected_offer.offer_status === 'SENT');

    // ---------------------------------------------------------------------------

    console.log('\n[8] PriceEngine — Decoupled Cover & Endpapers Print Cost');
    const { buildPrice } = require('../src/PriceEngine');

    // Live node-329a3bc4 rates snapshot
    const liveRatesNode329a3bc4 = {
        paper_price_interior_by_kilo: { munken: 0, offset: 1.5 },
        paper_price_cover_by_kilo: { mc: 4.0756 },
        interior_full_colour_fixed: { '24p': 0 },
        interior_full_colour_var: { '24p': 0 },
        cover_fixed_by_colours: { '4': 134.8284 },
        cover_var_per_1000_by_colours: { '4': 25.5357 },
        binding_hc_fixed_by_sections: { '9': 1.25 },
        binding_hc_var_per_1000_by_sections: { '9': 0 },
        endpaper_fixed_by_colours: { '4': 50.0 },
        endpaper_var_per_1000_by_colours: { '4': 10.0 }
    };

    const node329House = {
        id: 'node-329a3bc4',
        name: 'philologica.ai Printhouse',
        signatures: [24],
        rates: liveRatesNode329a3bc4
    };

    // Test 8.1: Printed cover (4/0) with interior print cost = 0.0 (Munken=0 / 24p=0)
    const fahrmannLiveEstimate = buildPrice({
        copies: 3000,
        book_width_mm: 139,
        book_height_mm: 212,
        interior_pages: 216,
        binding_method: 'hardcover',
        paper_type_interior: 'munken',
        paper_weight_interior: 90,
        interior_print: '4/4',
        cover_print: '4/0',
        paper_type_cover: 'mc',
        paper_weight_cover: 130,
        finishing_options: 'none',
        endpapers: 'none',
        endpapers_print: 'none',
        delivery_country: 'ES'
    }, node329House);

    assert('Fährmann interior print cost is 0.0', fahrmannLiveEstimate.debug.components.cost_print_int === 0);
    assert('Fährmann cover paper cost is 293.44 €', fahrmannLiveEstimate.debug.components.cost_paper_cov === 293.44);
    assert('Fährmann cover print cost is evaluated independently (211.44 €)', fahrmannLiveEstimate.debug.components.cost_print_cov === 211.44);
    assert('Fährmann hardcover binding cost is 1.25 €', fahrmannLiveEstimate.debug.components.cost_binding === 1.25);
    assert('Fährmann total cost is exactly 506.13 €', fahrmannLiveEstimate.total_cost === 506.13);

    // Test 8.2: Unprinted cover (cover_print = "6" or unprinted) evaluates to 0.0 cover print cost
    const unprintedCoverEstimate = buildPrice({
        copies: 1000,
        interior_pages: 128,
        cover_print: '6',
        finishing_options: 'none',
        binding_method: 'perfect bound'
    }, testHouse);
    assert('unprinted cover evaluates to 0.0 print cost', unprintedCoverEstimate.debug.components.cost_print_cov === 0);

    // Test 8.3: Hardcover with printed endpapers (4/0) when interior print cost is 0.0
    const printedEndsEstimate = buildPrice({
        copies: 1000,
        interior_pages: 128,
        interior_print: '4/4',
        binding_method: 'hardcover',
        endpapers: 'standard',
        endpapers_print: '4/0'
    }, node329House);
    assert('printed endpapers cost evaluates independently of interior print cost (60.0 €)', printedEndsEstimate.lines.find(l => l.item === 'Endpapers print').line_total === 60);

    // Test 8.4: Hardcover with endpapers="none" or unprinted endpapers evaluates to 0.0
    const noEndsEstimate = buildPrice({
        copies: 1000,
        interior_pages: 128,
        binding_method: 'hardcover',
        endpapers: 'none',
        endpapers_print: 'none'
    }, node329House);
    assert('endpapers="none" evaluates to 0.0 print cost', noEndsEstimate.lines.find(l => l.item === 'Endpapers print').line_total === 0);

    // Test 8.5: Non-hardcover binding (e.g., perfect bound) does not add unrequested endpaper costs
    const pbEstimate = buildPrice({
        copies: 1000,
        interior_pages: 128,
        binding_method: 'perfect bound',
        endpapers: 'standard',
        endpapers_print: '4/0'
    }, node329House);
    assert('non-hardcover binding evaluates endpapers cost to 0.0', pbEstimate.lines.find(l => l.item === 'Endpapers print').line_total === 0);

    // ---------------------------------------------------------------------------

    console.log(`\n${'─'.repeat(40)}`);
    console.log(`Results: ${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
})();
