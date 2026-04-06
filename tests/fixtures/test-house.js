'use strict';

// Fixture used by tests/run-tests.js and smoke-check.js via
// Repository.loadFromArray() so that tests need no MongoDB connection.

function sectionRates(fixedPerSection, varPerSection, count = 30) {
    const obj = {};
    for (let i = 1; i <= count; i++) {
        obj[i] = fixedPerSection + (i - 1) * varPerSection;
    }
    return obj;
}

module.exports = {
    id: 'ci-test-house',
    name: 'CI Test Print House',
    signatures: [16, 32],
    production_lead_days: 7,
    shipping_days: 3,

    limits: {
        min_copies: 100,
        max_pages: 2000,
    },

    shipping: {
        per_kg: 0.95,
    },

    rates: {
        // --- Interior print costs ---
        interior_one_colour_fixed:  { '32p': 30,  '16p': 18,  '8p': 10,  '4p': 6  },
        interior_one_colour_var:    { '32p': 12,  '16p': 7,   '8p': 4,   '4p': 2  },
        interior_two_colour_fixed:  { '32p': 50,  '16p': 30,  '8p': 18,  '4p': 10 },
        interior_two_colour_var:    { '32p': 20,  '16p': 12,  '8p': 7,   '4p': 4  },
        interior_full_colour_fixed: { '32p': 80,  '16p': 48,  '8p': 28,  '4p': 16 },
        interior_full_colour_var:   { '32p': 35,  '16p': 20,  '8p': 12,  '4p': 6  },

        // --- Cover print costs ---
        cover_fixed_by_colours:          { 1: 25,  2: 35,  3: 50,  4: 65,  5: 80,  6: 0 },
        cover_var_per_1000_by_colours:   { 1: 10,  2: 14,  3: 20,  4: 26,  5: 32,  6: 0 },

        // --- Lamination ---
        lam_fixed:        { matt: 40, gloss: 40, 'soft touch': 60, varnish: 30 },
        lam_var_per_1000: { matt: 15, gloss: 15, 'soft touch': 25, varnish: 10 },

        // --- UV varnish & PMS ---
        uv_varnish:         { fixed: 50, var: 20 },
        pms_cover:          { fixed: 30, var: 12 },
        pms_interior_fixed: 25,

        // --- Binding costs by number of sections ---
        binding_pb_fixed_by_sections:        sectionRates(80,  5),
        binding_pb_var_per_1000_by_sections: sectionRates(30,  2),
        binding_ss_fixed_by_sections:        sectionRates(40,  3),
        binding_ss_var_per_1000_by_sections: sectionRates(15,  1),
        binding_ts_fixed_by_sections:        sectionRates(100, 6),
        binding_ts_var_per_1000_by_sections: sectionRates(40,  3),
        binding_hc_fixed_by_sections:        sectionRates(140, 8),
        binding_hc_var_per_1000_by_sections: sectionRates(55,  4),
        binding_wo_fixed_by_sections:        sectionRates(90,  5),
        binding_wo_var_per_1000_by_sections: sectionRates(35,  2),
        binding_sp_fixed_by_sections:        sectionRates(90,  5),
        binding_sp_var_per_1000_by_sections: sectionRates(35,  2),

        // --- Endpapers ---
        endpaper_fixed_by_colours:        { 1: 20, 2: 28, 3: 40, 4: 52, 5: 64 },
        endpaper_var_per_1000_by_colours: { 1: 8,  2: 11, 3: 16, 4: 21, 5: 26 },

        // --- Paper quantity (sheets) ---
        paper_interior_fixed_by_colours:         { one: 5,  two: 6,  full: 8   },
        paper_interior_var_per_1000_by_colours:  { one: 80, two: 95, full: 120 },
        paper_cover_fixed_by_colours:            { one: 4,  two: 5,  full: 6   },
        paper_cover_var_per_1000_by_colours:     { one: 60, two: 75, full: 95  },
        paper_endpapers_fixed_by_colours:        { one: 3,  two: 4,  full: 5   },
        paper_endpapers_var_per_1000_by_colours: { one: 40, two: 50, full: 65  },

        // --- Paper waste by binding type ---
        paper_waste_for_binding: { pb: 5, ss: 3, sc: 5, hc: 6, wo: 4, sp: 4 },

        // --- Paper prices per kilo ---
        paper_price_interior_by_kilo: { offset: 1.20, mc: 1.45, lux: 1.80, munken: 2.10, other: 1.20 },
        paper_price_cover_by_kilo:    { mc: 1.50, artboard: 1.65, offset: 1.20, wfmc: 1.55, other: 1.50 },
        paper_price_endpaper_by_kilo: { offset: 1.20, mc: 1.45, other: 1.20 },

        // --- Transport ---
        technical_costs_for_transport: false,
        transport_costs: {
            netherlands: 350,
            belgium:     320,
            spain:       280,
            finland:     420,
            hungary:     380,
            poland:      360,
        },
        additional_transport_multiplier: 1.15,
    },
};
