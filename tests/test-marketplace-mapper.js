/**
 * PrintPrice OS — Pricing Engine
 *
 * Tests for MarketplaceOfferMapper.
 */

'use strict';

const { mapEstimateToMarketplaceOffers } = require('../src/MarketplaceOfferMapper');

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

console.log('\n[MarketplaceOfferMapper] Tests');

// Mock data
const mockEstimateResult = {
    engine: 'v3.0',
    ok: true,
    count: 3,
    params: { copies: 1000 },
    selected_print_house: {
        id: 'house-1',
        house_id: 'house-1',
        print_house: 'House 1',
        total_cost: 700.0,
        production_lead_days: 5,
        shipping_days: 2,
        estimated_delivery_time: '7 days',
        lines: [{ item: 'Test', line_total: 700 }]
    },
    print_houses: [
        {
            id: 'house-1',
            house_id: 'house-1',
            print_house: 'House 1',
            total_cost: 700.0,
            production_lead_days: 5,
            shipping_days: 2,
            estimated_delivery_time: '7 days',
            lines: [{ item: 'Test', line_total: 700 }]
        },
        {
            id: 'house-2',
            house_id: 'house-2',
            print_house: 'House 2',
            total_cost: 800.0,
            production_lead_days: 6,
            shipping_days: 3,
            delivery_time: '9 days',
            lines: [{ item: 'Test', line_total: 800 }]
        },
        {
            id: 'house-3',
            house_id: 'house-3',
            print_house: 'House 3',
            total_cost: 900.0,
            estimated_delivery_time: '5+2 days',
            lines: [{ item: 'Test', line_total: 900 }]
        }
    ]
};

const context = {
    source: 'BPE',
    source_ref: 'ref-123',
    tenant_id: 'tenant-1',
    trace_id: 'trace-1',
    order_id: 'order-1',
    job_id: 'job-1',
    quote_id: 'quote-1',
    currency: 'EUR',
    target_margin_pct: 30
};

// 1. Maps print_houses to offers
const result1 = mapEstimateToMarketplaceOffers(mockEstimateResult, context);
assert('result1 ok', result1.ok === true);
assert('offers length is 3', result1.offers.length === 3);
assert('offer_rank 1', result1.offers[0].offer_rank === 1);
assert('offer_rank 2', result1.offers[1].offer_rank === 2);
assert('offer_rank 3', result1.offers[2].offer_rank === 3);
assert('priority score 100', result1.offers[0].offer_priority_score === 100);
assert('priority score 95', result1.offers[1].offer_priority_score === 95);
assert('priority score 90', result1.offers[2].offer_priority_score === 90);

// 2. Maps selected_print_house (as recommendation)
assert('selected_offer matches house-1', result1.selected_offer.printer_id === 'house-1');
assert('offer_selected is false by default for house-1', result1.offers[0].offer_selected === false);
assert('offer_status is SENT by default for house-1', result1.offers[0].offer_status === 'SENT');
assert('all offers have offer_selected = false', result1.offers.every(o => o.offer_selected === false));

// 3. auto_accept_selected behavior
const result3 = mapEstimateToMarketplaceOffers(mockEstimateResult, { ...context, auto_accept_selected: true });
assert('offer_selected is true when auto_accept_selected = true', result3.selected_offer.offer_selected === true);
assert('offer_status is ACCEPTED when auto_accept_selected = true', result3.selected_offer.offer_status === 'ACCEPTED');
assert('non-recommended offers still SENT', result3.offers[1].offer_status === 'SENT');

// 4. Fallback selected offer (recommendation)
const result4 = mapEstimateToMarketplaceOffers({ ...mockEstimateResult, selected_print_house: null }, context);
assert('fallback recommendation is house-1', result4.selected_offer.printer_id === 'house-1');
assert('offer_selected is false for fallback recommendation', result4.selected_offer.offer_selected === false);

// 5. Gross margin formula
// production_cost = 700, target_margin_pct = "30" (string)
const result5 = mapEstimateToMarketplaceOffers(mockEstimateResult, { ...context, target_margin_pct: "30" });
assert('target_margin_pct accepts "30" string', result5.offers[0].suggested_price === 1000);
assert('target_margin_pct string produces correct margin_pct', result5.offers[0].margin_pct === 30);

// 6. No target margin
const result6 = mapEstimateToMarketplaceOffers(mockEstimateResult, { ...context, target_margin_pct: null });
assert('suggested_price equals production_cost when no margin', result6.offers[0].suggested_price === 700);
assert('estimated_margin is 0 when no margin', result6.offers[0].estimated_margin === 0);
assert('margin_pct is 0 when no margin', result6.offers[0].margin_pct === 0);

// 7. Invalid target margin (100)
const result7 = mapEstimateToMarketplaceOffers(mockEstimateResult, { ...context, target_margin_pct: 100 });
assert('target_margin_pct=100 adds warning', result7.warnings.includes('INVALID_TARGET_MARGIN'));
assert('target_margin_pct=100 does not divide by zero (uses cost)', result7.offers[0].suggested_price === 700);

// 8. Invalid target margin (-10)
const result8 = mapEstimateToMarketplaceOffers(mockEstimateResult, { ...context, target_margin_pct: -10 });
assert('target_margin_pct=-10 adds warning', result8.warnings.includes('INVALID_TARGET_MARGIN'));
assert('target_margin_pct=-10 does not discount below cost', result8.offers[0].suggested_price === 700);

// 9. Identity fallback (slugify)
const mockHouseSlug = { print_house: 'Super Print House!', total_cost: 100 };
const result9 = mapEstimateToMarketplaceOffers({ ...mockEstimateResult, print_houses: [mockHouseSlug] }, context);
assert('identity fallback uses slugify', result9.offers[0].printer_id === 'super-print-house');
assert('printer_name uses print_house', result9.offers[0].printer_name === 'Super Print House!');

// 10. Identity fallback (unknown)
const mockHouseUnknown = { total_cost: 100 };
const result10 = mapEstimateToMarketplaceOffers({ ...mockEstimateResult, print_houses: [mockHouseUnknown] }, context);
assert('identity fallback uses unknown-rank-N', result10.offers[0].printer_id === 'unknown-rank-1');
assert('identity fallback adds MISSING_PRINTER_ID warning', result10.warnings.some(w => w.includes('MISSING_PRINTER_ID')));

// 11. selected_offer is a shallow copy
assert('selected_offer is a different reference than offers[0]', result1.selected_offer !== result1.offers[0]);
assert('selected_offer has same printer_id as recommendation', result1.selected_offer.printer_id === result1.offers[0].printer_id);

// 12. Missing print_houses
const result12 = mapEstimateToMarketplaceOffers({ ...mockEstimateResult, print_houses: [] }, context);
assert('offers is empty when no houses', result12.offers.length === 0);
assert('selected_offer is null when no houses', result12.selected_offer === null);
assert('warnings includes NO_PRINT_HOUSES_RETURNED', result12.warnings.includes('NO_PRINT_HOUSES_RETURNED'));

// 13. Does not mutate input
const inputStrBefore = JSON.stringify(mockEstimateResult);
mapEstimateToMarketplaceOffers(mockEstimateResult, context);
const inputStrAfter = JSON.stringify(mockEstimateResult);
assert('does not mutate input', inputStrBefore === inputStrAfter);

// 14. Lead time from production + shipping (Math.ceil)
const mockHouseDecimal = { production_lead_days: 5.2, shipping_days: 1.1, total_cost: 100 };
const result14 = mapEstimateToMarketplaceOffers({ ...mockEstimateResult, print_houses: [mockHouseDecimal] }, context);
assert('lead_time_days rounds up (5.2 + 1.1 -> 6 + 2 = 8)', result14.offers[0].lead_time_days === 8);
assert('production_lead_days is 6', result14.offers[0].production_lead_days === 6);
assert('shipping_days is 2', result14.offers[0].shipping_days === 2);

// 15. Lead time from numeric delivery string
const mockHouseNumStr = { estimated_delivery_time: 7, total_cost: 100 };
const result15 = mapEstimateToMarketplaceOffers({ ...mockEstimateResult, print_houses: [mockHouseNumStr] }, context);
assert('numeric delivery time does not crash and gives 7', result15.offers[0].lead_time_days === 7);

// 16. Identity matching by slug
const selectedSlug = { print_house: 'Slug House', total_cost: 100 };
const result16 = mapEstimateToMarketplaceOffers({
    ...mockEstimateResult,
    selected_print_house: { print_house: 'Slug House' },
    print_houses: [selectedSlug]
}, context);
assert('matches recommendation by slug/name', result16.selected_offer.printer_id === 'slug-house');
assert('recommendation status is SENT', result16.selected_offer.offer_status === 'SENT');

// 17. Custom formatting
assert('production_cost rounded to 4 decimals', result1.offers[0].production_cost === 700.0000);

console.log(`\n${'─'.repeat(40)}`);
console.log(`MarketplaceMapper Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
