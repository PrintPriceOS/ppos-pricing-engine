/**
 * PrintPrice OS — Pricing Engine
 *
 * PriceEngine — core deterministic pricing calculations.
 * Ported from price-engine.php v2.9 (pure library, no side-effects).
 *
 * Public API:
 *   buildPrice(params, house)   → single-house estimate
 *   estimateAll(params, houses) → multi-house estimates, sorted by cost
 */

'use strict';

/* -------------------------------------------------------------------------
 * Utilities
 * ---------------------------------------------------------------------- */

function arrGet(obj, key, def = null) {
    return Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : def;
}

function firstOf(obj, keys, def = null) {
    for (const k of keys) {
        if (Object.prototype.hasOwnProperty.call(obj, k)) return obj[k];
    }
    return def;
}

function round2(n) {
    return Math.round(Number(n) * 100) / 100;
}

function bpeBool(v) {
    if (typeof v === 'boolean') return v;
    const s = typeof v === 'string' ? v.toLowerCase().trim() : v;
    return [1, '1', 'true', 'yes', 'on'].includes(s);
}

/**
 * Maps a binding method string to a numeric code.
 * @param {string} binding
 * @param {'default'|'alternative'} type
 * @returns {number}
 */
function getBindingCode(binding, type = 'default') {
    const patternSets = {
        default: {
            perfect: 1, saddle: 2, softcover: 3, hardcover: 4, wiro: 3, spiral: 4,
        },
        alternative: {
            perfect: 1, saddle: 2, softcover: 3, hardcover: 4, wiro: 5, spiral: 6,
        },
    };
    const patterns = patternSets[type] ?? patternSets.default;
    const text = String(binding).toLowerCase().trim();
    for (const [prefix, code] of Object.entries(patterns)) {
        if (text.startsWith(prefix)) return code;
    }
    return 0;
}

/**
 * Returns the short binding code used for paper waste lookups.
 * @param {string} bindingType
 * @returns {string}
 */
function getBindingShort(bindingType) {
    const patterns = {
        perfect: 'pb', saddle: 'ss', softcover: 'sc', hardcover: 'hc', wiro: 'wo', spiral: 'sp',
    };
    const text = String(bindingType).toLowerCase().trim();
    for (const [prefix, code] of Object.entries(patterns)) {
        if (text.startsWith(prefix)) return code;
    }
    return bindingType;
}

/**
 * Extracts the finishing keyword: none | varnish | gloss | matt.
 * @param {string} input
 * @returns {string}
 */
function getFinishingText(input) {
    const keywords = ['none', 'varnish', 'gloss', 'matt'];
    const lower = String(input).toLowerCase();
    for (const kw of keywords) {
        if (lower.includes(kw)) return kw;
    }
    return 'none';
}

/**
 * Calculates the effective number of binding sections from the sections array.
 * @param {number} bindingMethod  numeric binding code (alternative)
 * @param {number} signature
 * @param {number[]} sectionsArray
 * @returns {number}
 */
function getSectionsBindings(bindingMethod, signature, sectionsArray) {
    if (signature === 32 && bindingMethod !== 3 && bindingMethod !== 4 && bindingMethod !== 6) {
        return sectionsArray[0] + sectionsArray[1] + sectionsArray[2] + sectionsArray[3];
    } else if (signature === 24) {
        return sectionsArray[0] + sectionsArray[1] + sectionsArray[2] + sectionsArray[3] + sectionsArray[4];
    } else {
        return sectionsArray[0] * 2 + sectionsArray[1] + sectionsArray[2] + sectionsArray[3];
    }
}

/**
 * Returns the sheet area in m² for a given paper size string (e.g. '640x900').
 * @param {string} paperSizeInterior
 * @returns {number}
 */
function getSizeDef(paperSizeInterior) {
    const special = { '640x900': 0.576, '520x800': 0.416, '720x1020': 0.7344 };
    if (special[paperSizeInterior] !== undefined) return special[paperSizeInterior];

    const m = String(paperSizeInterior).match(/(\d+(?:\.\d+)?)X(\d+(?:\.\d+)?)/i);
    if (m) return (parseFloat(m[1]) / 1000) * (parseFloat(m[2]) / 1000);

    return 0;
}

/**
 * Returns the press-sheet size code (e.g. '640x900') for the given book spec.
 * @param {string} bookSize
 * @param {string} orientation
 * @param {number} widthMm
 * @param {number} heightMm
 * @param {boolean} isCustom
 * @returns {string}
 */
function getPaperSize(bookSize, orientation, widthMm, heightMm, isCustom) {
    if (!isCustom) {
        if (['A5', 'A4'].includes(bookSize)) return '640x900';
        if (bookSize === '170 X 240 MM') return '720x1020';
        if (bookSize === '200 X 200 MM') return orientation === 'portrait' ? '640x900' : '720x1020';
        if (bookSize === '220 X 220 MM') return '720x1020';
        return '640x900';
    }

    const w = widthMm;
    const h = heightMm;
    const ori = String(orientation).toLowerCase();

    if (ori === 'portrait') {
        if (w >= 100 && w <= 105 && h >= 120 && h <= 148) return '640x900';
        if (w >= 106 && w <= 119 && h >= 149 && h <= 166) return '720x1020';
        if (w >= 120 && w <= 150 && h >= 167 && h <= 214) return '640x900';
        if (w >= 151 && w <= 170 && h >= 167 && h <= 245) return '720x1020';
        if (w >= 175 && w <= 214 && h >= 250 && h <= 302) return '640x900';
        if (w >= 175 && w <= 245 && h >= 303 && h <= 340) return '720x1020';
        if (w >= 160 && w <= 214 && h >= 170 && h <= 200) return '640x900';
        if (w >= 120 && w <= 150 && h >= 246 && h <= 289) return '640x900';
        if (w >= 175 && w <= 245 && h >= 201 && h <= 220) return '720x1020';
        if (w >= 120 && w <= 167 && h >= 290 && h <= 325) return '720x1020';
        if (w >= 250 && w <= 287 && h >= 250 && h <= 300) return '640x900';
        if (w >= 288 && w <= 297 && h >= 301 && h <= 340) return '720x1020';
    }

    if (ori === 'landscape') {
        if (w >= 150 && w <= 214 && h >= 120 && h <= 148) return '640x900';
        if (w >= 215 && w <= 245 && h >= 149 && h <= 167) return '720x1020';
        if (w >= 250 && w <= 297 && h >= 160 && h <= 212) return '640x900';
        if (w >= 297 && w <= 297 && h >= 215 && h <= 240) return '720x1020';
        if (w >= 160 && w <= 214 && h >= 170 && h <= 200) return '640x900';
        if (w >= 120 && w <= 150 && h >= 246 && h <= 289) return '640x900';
        if (w >= 175 && w <= 245 && h >= 201 && h <= 220) return '720x1020';
        if (w >= 120 && w <= 167 && h >= 290 && h <= 325) return '720x1020';
        if (w >= 250 && w <= 287 && h >= 250 && h <= 300) return '640x900';
        if (w >= 288 && w <= 297 && h >= 301 && h <= 340) return '720x1020';
    }

    return '720x1020';
}

/**
 * Returns the lowercase country name used for transport rate lookups.
 * @param {string} isoCode
 * @returns {string}
 */
function getCountryName(isoCode) {
    const countries = {
        BE: 'belgium',
        NL: 'netherlands',
        FI: 'finland',
        HU: 'hungary',
        PL: 'poland',
    };
    return countries[isoCode] ?? '';
}

/* -------------------------------------------------------------------------
 * Normalisation (engine-internal, lighter than Normalizer.js)
 * ---------------------------------------------------------------------- */

function normalizeParams(p) {
    p = { ...p };

    // Country → ISO2
    const country = String(p.delivery_country ?? '').trim();
    if (!country) {
        p.delivery_country = 'ES';
    } else {
        const map = {
            belgium: 'BE', belgië: 'BE', belgique: 'BE', belgica: 'BE', be: 'BE',
            spain: 'ES', españa: 'ES', es: 'ES',
            finland: 'FI', fi: 'FI',
            hungary: 'HU', hu: 'HU',
            netherlands: 'NL', nl: 'NL',
            poland: 'PL', pl: 'PL',
        };
        const k = country.toLowerCase().replace(/[^a-z]/g, '');
        p.delivery_country = map[k] ?? country.toUpperCase().slice(0, 2);
    }

    // Binding
    const b = String(arrGet(p, 'binding_method', 'perfect bound')).toLowerCase();
    if (/case|hard.?cover|hc|tapadura/.test(b))                     p.binding_method = 'hardcover';
    else if (/saddle|staple|ss|cosido|grapado/.test(b))             p.binding_method = 'saddle';
    else if (/sewn|soft.?cover|thread|cosido hilo|tapa.?blanda/.test(b)) p.binding_method = 'softcover';
    else if (/wire|wiro|wire-o|wo/.test(b))                         p.binding_method = 'wiro';
    else if (/spiral|flexibound|espiral/.test(b))                   p.binding_method = 'spiral';
    else                                                             p.binding_method = 'perfect bound';

    // Finishing
    const f = String(arrGet(p, 'finishing_options', 'matt lamination')).toLowerCase();
    if (/varnish|barniz|esmalte/.test(f))             p.finishing_options = 'varnish';
    else if (/matt|matte|mate/.test(f))               p.finishing_options = 'matt lamination';
    else if (/gloss|brillo|brillante/.test(f))        p.finishing_options = 'gloss lamination';
    else if (/none|sin|no|ninguno/.test(f))           p.finishing_options = 'none';
    else                                               p.finishing_options = 'matt lamination';

    // Interior print
    const ip = String(arrGet(p, 'interior_print', '1/1')).toLowerCase();
    if (/4\/4|4-4|cmyk|color/.test(ip))             p.interior_print = '4/4';
    else if (/2\/2|2-2|duotone/.test(ip))           p.interior_print = '2/2';
    else if (/1\/1|1-1|bw|black|b\/w/.test(ip))    p.interior_print = '1/1';
    else                                             p.interior_print = '1/1';

    // Cover print
    const cp = String(arrGet(p, 'cover_print', '4/0')).toLowerCase();
    if (/4\/0|4-0/.test(cp))                        p.cover_print = '4/0';
    else if (/4\/4|4-4|cmyk|color/.test(cp))        p.cover_print = '4/4';
    else if (/1\/0|1-0|bw|black/.test(cp))          p.cover_print = '1/0';
    else                                             p.cover_print = '4/0';

    // Pages
    p.cover_pages   = Math.max(2, parseInt(arrGet(p, 'cover_pages', 4), 10));
    const interiorPages = parseInt(arrGet(p, 'interior_pages', 0), 10);
    const totalPages    = parseInt(arrGet(p, 'total_page_count', 0), 10);

    if (interiorPages <= 0 && totalPages > 0) {
        p.interior_pages = Math.max(0, totalPages - p.cover_pages);
    } else if (totalPages <= 0) {
        p.total_page_count = interiorPages + p.cover_pages;
    }

    p.copies = Math.max(1, parseInt(arrGet(p, 'copies', 1), 10));

    // Weights
    p.paper_weight_interior  = Number(arrGet(p, 'paper_weight_interior', 100));
    p.paper_weight_cover     = Number(arrGet(p, 'paper_weight_cover', 240));
    p.paper_weight_endpapers = Number(arrGet(p, 'paper_weight_endpapers', 115));

    // Endpapers
    let epRaw = arrGet(p, 'endpapers', '');
    let epStr = typeof epRaw === 'boolean' ? (epRaw ? 'standard' : 'none') : String(epRaw).toLowerCase().trim();

    if (epStr === '') {
        p.endpapers = (p.binding_method === 'hardcover') ? 'standard' : 'none';
    } else if (['none', 'no', '0', 'false'].includes(epStr) || epRaw === 0) {
        p.endpapers = 'none';
    } else {
        p.endpapers = 'standard';
    }

    // endpapers_print
    const epPrintRaw = String(arrGet(p, 'endpapers_print', '')).toLowerCase().trim();
    if (p.endpapers === 'none') {
        p.endpapers_print = 'none';
    } else {
        if (epPrintRaw === '' || epPrintRaw === 'default') {
            p.endpapers_print = '4/0';
        } else if (['none', 'no', '0', 'false'].includes(epPrintRaw)) {
            p.endpapers_print = 'none';
        } else if (/^\d\s*\/\s*\d$/.test(epPrintRaw)) {
            p.endpapers_print = epPrintRaw.replace(/\s+/g, '');
        } else {
            p.endpapers_print = '4/0';
        }
    }

    return p;
}

/* -------------------------------------------------------------------------
 * Signature & sections
 * ---------------------------------------------------------------------- */

function pickSignature(house, interiorPages) {
    let sig = 16;
    if (Array.isArray(house.signatures) && house.signatures.length > 0) {
        const prefs = [32, 24, 16, 8, 4];
        for (const pref of prefs) {
            if (house.signatures.includes(pref)) { sig = pref; break; }
        }
        if (!house.signatures.includes(sig)) {
            sig = Math.max(...house.signatures);
        }
    } else if (house.signature) {
        sig = parseInt(house.signature, 10);
    }
    return Math.max(4, sig);
}

function sections(interiorPages, signature) {
    return Math.max(1, Math.ceil(interiorPages / Math.max(4, signature)));
}

/**
 * Decomposes `pages` into a sections breakdown array.
 * For sig=24 returns 5 elements [24p, 16p, 12p, 8p, 4p].
 * For others  returns 4 elements [32p, 16p, 8p, 4p].
 * @param {number} pages  (interior pages)
 * @param {number} signature
 * @returns {number[]}
 */
function sectionsArray(pages, signature) {
    if (pages === 0) return [0, 0, 0, 0];

    if (signature === 24) {
        return [
            Math.trunc(pages / 24),
            Math.trunc((pages % 24) / 16),
            Math.trunc((pages % 24 % 16) / 12),
            Math.trunc((pages % 24 % 16 % 12) / 8),
            Math.trunc((pages % 24 % 16 % 12 % 8) / 4),
        ];
    }

    return [
        Math.trunc(pages / 32),
        Math.trunc((pages % 32) / 16),
        Math.trunc((pages % 16) / 8),
        Math.trunc((pages % 8) / 4),
    ];
}

/* -------------------------------------------------------------------------
 * Binding cost
 * ---------------------------------------------------------------------- */

function bindingCost(rates, p, copies, signature, sectArr) {
    const bindingMethodInt = getBindingCode(String(p.binding_method), 'alternative');
    const sectionsBinding  = getSectionsBindings(bindingMethodInt, signature, sectArr);
    let total = 0.0;

    function calcCost(fixedKey, varKey) {
        const fixed = Number(arrGet(rates[fixedKey] ?? {}, sectionsBinding, 0));
        const vari  = Number(arrGet(rates[varKey]   ?? {}, sectionsBinding, 0));
        return fixed + Math.ceil(copies / 1000) * vari;
    }

    function calcCostCapped(fixedKey, varKey) {
        if (sectionsBinding < 25) {
            return calcCost(fixedKey, varKey);
        } else {
            const fixed24 = Number(arrGet(rates[fixedKey] ?? {}, 24, 0));
            const var24   = Number(arrGet(rates[varKey]   ?? {}, 24, 0));
            const var23   = Number(arrGet(rates[varKey]   ?? {}, 23, 0));
            const varKey_ = var24 + (var24 - var23) * (sectionsBinding - 24);
            return fixed24 + Math.ceil(copies / 1000) * varKey_;
        }
    }

    switch (bindingMethodInt) {
        case 1:
            total += calcCostCapped('binding_pb_fixed_by_sections', 'binding_pb_var_per_1000_by_sections');
            return total;
        case 2:
            if (sectionsBinding < 13) {
                total += calcCost('binding_ss_fixed_by_sections', 'binding_ss_var_per_1000_by_sections');
            }
            return total;
        case 3:
            total += calcCostCapped('binding_ts_fixed_by_sections', 'binding_ts_var_per_1000_by_sections');
            return total;
        case 4:
            total += calcCostCapped('binding_hc_fixed_by_sections', 'binding_hc_var_per_1000_by_sections');
            return total;
        case 5:
            total += calcCostCapped('binding_wo_fixed_by_sections', 'binding_wo_var_per_1000_by_sections');
            return total;
        case 6:
            total += calcCostCapped('binding_sp_fixed_by_sections', 'binding_sp_var_per_1000_by_sections');
            return total;
        default:
            return 0.0;
    }
}

/* -------------------------------------------------------------------------
 * Cover print cost
 * ---------------------------------------------------------------------- */

function coverPrintCost(costPrintInt, rates, p, copies) {
    const coverPrintInt = parseInt(String(p.cover_print ?? '')[0] ?? '0', 10);
    let total = 0.0;

    if (costPrintInt === 0.0 || coverPrintInt === 6) return total;

    const colorFixed = Number(arrGet(rates.cover_fixed_by_colours   ?? {}, coverPrintInt, 0));
    const colorVar   = Number(arrGet(rates.cover_var_per_1000_by_colours ?? {}, coverPrintInt, 0));
    total += colorFixed + Math.ceil(copies / 1000) * colorVar;

    const coverPrintRev = parseInt(p.cover_print_rev ?? 0, 10);
    if (coverPrintRev > 1 && coverPrintRev <= 6) {
        const revIdx = coverPrintRev - 1;
        const rFixed = Number(arrGet(rates.cover_fixed_by_colours   ?? {}, revIdx, 0));
        const rVar   = Number(arrGet(rates.cover_var_per_1000_by_colours ?? {}, revIdx, 0));
        total += rFixed + Math.ceil(copies / 1000) * rVar;
    }

    const pmsCover = parseInt(p.pms_cover ?? 0, 10);
    const pmsFixed = Number(arrGet(rates.pms_cover ?? {}, 'fixed', 0));
    const pmsVar   = Number(arrGet(rates.pms_cover ?? {}, 'var', 0));
    if (pmsCover === 2)      total += pmsFixed + Math.ceil(copies / 1000) * pmsVar;
    else if (pmsCover === 3) total += 2 * (pmsFixed + Math.ceil(copies / 1000) * pmsVar);

    const finishing = getFinishingText(String(p.finishing_options ?? ''));
    if (finishing !== 'none') {
        const lamFixed = Number(arrGet(rates.lam_fixed         ?? {}, finishing, 0));
        const lamVar   = Number(arrGet(rates.lam_var_per_1000  ?? {}, finishing, 0));
        total += lamFixed + Math.ceil(copies / 1000) * lamVar;
    }

    if (bpeBool(p.uv_varnish)) {
        const uvFixed = Number(arrGet(rates.uv_varnish ?? {}, 'fixed', 0));
        const uvVar   = Number(arrGet(rates.uv_varnish ?? {}, 'var',   0));
        total += uvFixed + Math.ceil(copies / 1000) * uvVar;
    }

    return total;
}

/* -------------------------------------------------------------------------
 * Interior print cost
 * ---------------------------------------------------------------------- */

function interiorPrintCost(rates, p, sectArr, copies, signature) {
    const printModeMap = { '4/4': 'full', '2/2': 'two', '1/1': 'one' };
    const printMode = printModeMap[p.interior_print ?? '1/1'] ?? 'one';
    const colorKey  = `interior_${printMode}_colour`;

    const sectionKeys = signature === 24
        ? ['24p', '16p', '12p', '8p', '4p']
        : ['32p', '16p', '8p', '4p'];

    let totalCost = 0.0;
    for (let i = 0; i < sectArr.length; i++) {
        if (sectArr[i] === 0) continue;
        const sectionKey = sectionKeys[i];
        const fixed = Number(arrGet(rates[`${colorKey}_fixed`] ?? {}, sectionKey, 0));
        const vari  = Number(arrGet(rates[`${colorKey}_var`]   ?? {}, sectionKey, 0));
        totalCost += sectArr[i] * (fixed + Math.ceil(copies / 1000) * vari);
    }

    const pmsInterior = parseInt(p.pms_interior ?? 0, 10);
    const pmsFixed    = Number(rates.pms_interior_fixed ?? 0);
    if (pmsInterior === 2)      totalCost += pmsFixed;
    else if (pmsInterior === 3) totalCost += 2 * pmsFixed;

    return totalCost;
}

/* -------------------------------------------------------------------------
 * Endpapers print cost
 * ---------------------------------------------------------------------- */

function endpapersCost(costPrintInt, rates, p, copies) {
    const bindingMethodInt = getBindingCode(String(p.binding_method), 'default');
    let total = 0.0;

    if (costPrintInt === 0.0 || bindingMethodInt !== 4) return total;

    const epPrintStr = String(p.endpapers_print ?? '');
    let printingEnds = 0, printingEndsRev = 0;

    if (epPrintStr.includes('/')) {
        const parts = epPrintStr.split('/');
        printingEnds    = parseInt(parts[0] ?? 0, 10);
        printingEndsRev = parseInt(parts[1] ?? 0, 10);
    }

    if (printingEnds >= 1 && printingEnds <= 5) {
        const epFixed = Number(arrGet(rates.endpaper_fixed_by_colours         ?? {}, printingEnds, 0));
        const epVar   = Number(arrGet(rates.endpaper_var_per_1000_by_colours  ?? {}, printingEnds, 0));
        total += epFixed + Math.ceil(copies / 1000) * epVar;
    }

    if (printingEndsRev >= 1 && printingEndsRev <= 5) {
        const epFixed = Number(arrGet(rates.endpaper_fixed_by_colours         ?? {}, printingEndsRev, 0));
        const epVar   = Number(arrGet(rates.endpaper_var_per_1000_by_colours  ?? {}, printingEndsRev, 0));
        total += epFixed + Math.ceil(copies / 1000) * epVar;
    }

    return total;
}

/* -------------------------------------------------------------------------
 * Extra costs
 * ---------------------------------------------------------------------- */

function extraCosts(p, copies, signature, sectArr) {
    const bindingMethodInt = getBindingCode(String(p.binding_method), 'alternative');
    const sectionsBinding  = getSectionsBindings(bindingMethodInt, signature, sectArr);

    const extraBook     = parseInt(p.extra_book     ?? 0, 10);
    const extraSection  = parseInt(p.extra_section  ?? 0, 10);
    const extraFixed    = Number(p.extra_fixed    ?? 0);
    const extraVariable = Number(p.extra_variable ?? 0);

    return copies * extraBook
        + copies * sectionsBinding * extraSection
        + extraFixed
        + copies * extraVariable;
}

/* -------------------------------------------------------------------------
 * Sheets for interior
 * ---------------------------------------------------------------------- */

function sheetsInterior(rates, p, copies, signature, sectArr) {
    const printModeMap = { '4/4': 'full', '2/2': 'two', '1/1': 'one' };
    const printMode = printModeMap[p.interior_print ?? '1/1'] ?? 'one';

    const fixed = Number(arrGet(rates.paper_interior_fixed_by_colours         ?? {}, printMode, 0));
    let   vari  = Number(arrGet(rates.paper_interior_var_per_1000_by_colours  ?? {}, printMode, 0));
    vari /= 100;

    let totalPaperInterior, paperNetInterior;

    if (signature === 24) {
        const [s24, s16, s12, s8, s4] = sectArr;
        totalPaperInterior =
            s24 * fixed + s24 * copies * vari +
            s16 * fixed + s16 * copies * vari +
            s12 * fixed + s12 * (copies / 2) * vari +
            s8  * fixed + s8  * (copies / 2) * vari +
            s4  * fixed + s4  * (copies / 4) * vari;
        paperNetInterior =
            s24 * copies + s16 * copies + (s12 / 2) * copies + (s8 / 2) * copies + (s4 / 4) * copies;
    } else if (signature === 16) {
        const [s32, s16, s8, s4] = sectArr;
        totalPaperInterior =
            s32 * 2 * fixed + s32 * 2 * copies * vari +
            s16 * fixed     + s16 * copies * vari +
            s8  * fixed     + s8  * (copies / 2) * vari +
            s4  * fixed     + s4  * (copies / 4) * vari;
        paperNetInterior =
            s32 * 2 * copies + s16 * copies + (s8 / 2) * copies + (s4 / 4) * copies;
    } else {
        // sig=32 (else)
        const [s32, s16, s8, s4] = sectArr;
        totalPaperInterior =
            s32 * fixed + s32 * copies * vari +
            s16 * fixed + s16 * (copies / 2) * vari +
            s8  * fixed + s8  * (copies / 4) * vari +
            s4  * fixed + s4  * (copies / 4) * vari;
        paperNetInterior =
            s32 * copies + (s16 / 2) * copies + (s8 / 4) * copies + (s4 / 4) * copies;
    }

    const bindingShort = getBindingShort(String(p.binding_method));
    let paperWaste = Number(arrGet(rates.paper_waste_for_binding ?? {}, bindingShort, 0));
    paperWaste /= 100;
    const waste = paperNetInterior * paperWaste;

    return totalPaperInterior + paperNetInterior + waste;
}

/* -------------------------------------------------------------------------
 * Sheets for cover
 * ---------------------------------------------------------------------- */

function sheetsCover(rates, p, copies, signature) {
    const coverPrintStr = String(p.cover_print ?? '');
    let coverPrint = 1;

    if (coverPrintStr.includes('/')) {
        coverPrint = parseInt(coverPrintStr.split('/')[0], 10);
    }

    if (coverPrint === 6) return 0.0;

    const printModeMap = { 1: 'one', 2: 'two' };
    const printMode = printModeMap[coverPrint] ?? ([3, 4, 5].includes(coverPrint) ? 'full' : 'one');

    const fixed = Number(arrGet(rates.paper_cover_fixed_by_colours         ?? {}, printMode, 0));
    let   vari  = Number(arrGet(rates.paper_cover_var_per_1000_by_colours  ?? {}, printMode, 0));
    vari /= 100;

    let totalPaperCover, paperNetCover;
    if (signature === 32) {
        totalPaperCover = fixed + (copies / 8) * vari;
        paperNetCover   = copies / 8;
    } else {
        totalPaperCover = fixed + (copies / 4) * vari;
        paperNetCover   = copies / 4;
    }

    return paperNetCover + Math.round(totalPaperCover);
}

/* -------------------------------------------------------------------------
 * Sheets for endpapers
 * ---------------------------------------------------------------------- */

function sheetsEndpaper(rates, p, copies, signature) {
    const bindingMethodInt = getBindingCode(String(p.binding_method), 'alternative');
    if (bindingMethodInt !== 4) return 0.0;

    const epPrintStr = String(p.endpapers_print ?? '');
    let printingEnds = 0;

    if (epPrintStr.includes('/')) {
        const parts = epPrintStr.split('/');
        printingEnds = parseInt(parts[0] ?? 1, 10) + 1;
    }

    const paperNetEndpapers = signature === 32 ? copies / 4 : copies / 2;

    if (printingEnds === 0) return paperNetEndpapers;

    const printModeMap = { 1: 'one', 2: 'two' };
    const printMode = printModeMap[printingEnds] ?? ([3, 4, 5].includes(printingEnds) ? 'full' : 'one');

    const fixed = Number(arrGet(rates.paper_endpapers_fixed_by_colours         ?? {}, printMode, 0));
    let   vari  = Number(arrGet(rates.paper_endpapers_var_per_1000_by_colours  ?? {}, printMode, 0));
    vari /= 100;

    const totalPaperEndpaper = signature === 32
        ? fixed + (copies / 4) * vari
        : fixed + (copies / 2) * vari;

    return paperNetEndpapers + Math.round(totalPaperEndpaper);
}

/* -------------------------------------------------------------------------
 * Kilo calculations
 * ---------------------------------------------------------------------- */

function kiloInterior(p, sheetsInteriorVal) {
    const bookSize   = String(p.book_size ?? '');
    const orientation = String(p.orientation ?? 'portrait');
    const widthMm    = parseInt(p.book_width_mm  ?? p.width_mm  ?? 0, 10);
    const heightMm   = parseInt(p.book_height_mm ?? p.height_mm ?? 0, 10);
    const isCustom   = !['A5', 'A4', '170 X 240 MM', '200 X 200 MM', '220 X 220 MM'].includes(bookSize);
    const paperSize  = getPaperSize(bookSize, orientation, widthMm, heightMm, isCustom);
    const sizeDef    = getSizeDef(paperSize);
    const weightDef  = parseInt(p.paper_weight_interior, 10);
    return Math.round(sheetsInteriorVal * sizeDef * (weightDef / 1000));
}

function kiloCover(p, sheetsCoverVal) {
    const sizeDef   = getSizeDef('720x1020');
    const weightDef = parseInt(p.paper_weight_cover, 10);
    return Math.round(sheetsCoverVal * sizeDef * (weightDef / 1000));
}

function kiloEndpaper(p, sheetsEndpaperVal) {
    const sizeDef   = getSizeDef('520x800');
    const weightDef = parseInt(p.paper_weight_endpapers, 10);
    return Math.round(sheetsEndpaperVal * sizeDef * (weightDef / 1000));
}

/* -------------------------------------------------------------------------
 * Paper costs
 * ---------------------------------------------------------------------- */

function costInterior(rates, p, kiloInteriorVal) {
    const paperType = String(p.paper_type_interior ?? '');
    const price = Number(arrGet(rates.paper_price_interior_by_kilo ?? {}, paperType, 0));
    return Math.round(kiloInteriorVal * price);
}

function costCover(rates, p, kiloCoverVal) {
    const paperType = String(p.paper_type_cover ?? '');
    if (paperType === 'none') return 0.0;
    const price = Number(arrGet(rates.paper_price_cover_by_kilo ?? {}, paperType, 0));
    return kiloCoverVal * price;
}

function costEndpaper(rates, p, kiloEndpaperVal) {
    const paperType = String(p.paper_type_endpaper ?? '');
    if (paperType === 'none') return 0.0;
    const price = Number(arrGet(rates.paper_price_endpaper_by_kilo ?? {}, paperType, 0));
    return kiloEndpaperVal * price;
}

/* -------------------------------------------------------------------------
 * Transport cost
 * ---------------------------------------------------------------------- */

function costTransport(rates, p, copies, sectArr, costPrintInt, costPrintCov, endpaper, costBinding, extraCost, paper) {
    const technicalCostsTransport = Boolean(rates.technical_costs_for_transport ?? false);
    const deliveryCountry = String(p.delivery_country ?? 'ES');
    const countryName     = getCountryName(deliveryCountry);
    let total = 0.0;

    if (technicalCostsTransport) {
        const technicalCosts = costPrintInt + costPrintCov + endpaper + costBinding + extraCost + paper;
        const pct = Number(arrGet(rates.percentage_technical_costs ?? {}, countryName, 0));
        total = technicalCosts * pct;
    } else {
        const bindingMethodInt = getBindingCode(String(p.binding_method), 'alternative');
        const totalBooks = bindingMethodInt === 3 ? 11000 : 7000;

        const [s32, s16, s8, s4] = sectArr;
        const totalSections  = s32 * 2 + s16 + (s8 / 2) + (s4 / 4);
        const divisionSections = totalBooks / totalSections;
        const pallets = Math.ceil(copies / divisionSections);

        const fullContainer  = Number(arrGet(rates.transport_costs ?? {}, countryName, 0));
        const multiplier     = Number(rates.additional_transport_multiplier ?? 0);
        total = ((fullContainer / 28) * pallets) * multiplier;
    }

    return total;
}

/* -------------------------------------------------------------------------
 * Single-house build
 * ---------------------------------------------------------------------- */

/**
 * Builds a price estimate for a single print house.
 * @param {object} params  Raw or pre-normalised input params
 * @param {object} house   Normalised print house from Repository
 * @returns {object}
 */
function buildPrice(params, house) {
    const p = normalizeParams(params);

    const rates  = arrGet(house, 'rates', {});
    const copies = parseInt(arrGet(p, 'copies', 1), 10);

    // Signature & sections
    const sig       = pickSignature(house, parseInt(p.interior_pages, 10));
    p.signature     = sig;
    const sects     = sections(parseInt(p.interior_pages, 10), sig);
    const sectArr   = sectionsArray(parseInt(p.interior_pages, 10), sig);

    // Cost components
    const costPrintInt  = interiorPrintCost(rates, p, sectArr, copies, sig);
    const costPrintCov  = coverPrintCost(costPrintInt, rates, p, copies);
    const endpaper      = endpapersCost(costPrintInt, rates, p, copies);
    const costBinding   = bindingCost(rates, p, copies, sig, sectArr);
    const extraCost     = extraCosts(p, copies, sig, sectArr);

    const sheetsInt     = sheetsInterior(rates, p, copies, sig, sectArr);
    const sheetsCov     = sheetsCover(rates, p, copies, sig);
    const sheetsEnd     = sheetsEndpaper(rates, p, copies, sig);

    const kiloInt  = kiloInterior(p, sheetsInt);
    const kiloCov  = kiloCover(p, sheetsCov);
    const kiloEnd  = kiloEndpaper(p, sheetsEnd);

    const costPaperInt = costInterior(rates, p, kiloInt);
    const costPaperCov = costCover(rates, p, kiloCov);
    const costPaperEnd = costEndpaper(rates, p, kiloEnd);
    const paper        = costPaperInt + costPaperCov + costPaperEnd;

    const costShip = costTransport(
        rates, p, copies, sectArr,
        costPrintInt, costPrintCov, endpaper, costBinding, extraCost, paper
    );

    // Line items
    const lines = [
        { item: `Interior paper (${p.paper_weight_interior}gsm)`, line_total: round2(costPaperInt) },
        { item: `Interior print (${p.interior_print})`,           line_total: round2(costPrintInt) },
        { item: `Cover paper (${p.paper_weight_cover}gsm, ${p.cover_pages}p)`, line_total: round2(costPaperCov) },
        { item: `Cover print (${p.cover_print})`,                 line_total: round2(costPrintCov) },
        { item: `Endpapers paper (${p.paper_weight_endpapers}gsm)`, line_total: round2(costPaperEnd) },
        { item: 'Endpapers print',                                line_total: round2(endpaper) },
        { item: `Binding (${p.binding_method})`,                  line_total: round2(costBinding) },
        { item: 'Extra costs',                                     line_total: round2(extraCost) },
        { item: 'Shipping',                                        line_total: round2(costShip) },
        // Informative
        { item: 'Sections',  value: sects },
        { item: 'Signature', value: sig   },
        { item: 'Book size', value: `${p.book_size_code} (${p.book_width_mm}×${p.book_height_mm} mm)` },
    ];

    // Subtotal
    let subtotal = 0.0;
    for (const ln of lines) {
        if (ln.line_total != null) subtotal += ln.line_total;
    }

    const prodDays = parseInt(arrGet(house, 'production_lead_days', 7), 10);
    const shipDays = parseInt(
        firstOf(house, ['shipping_days', 'shipping_lead_days'], 2),
        10
    );
    const etaDays = prodDays + shipDays;

    return {
        print_house:              String(firstOf(house, ['print_house', 'name'], 'Unknown')),
        house_id:                 String(arrGet(house, 'id', 'unknown')),
        total_cost:               round2(subtotal),
        delivery_time:            String(arrGet(house, 'delivery_time', `${etaDays} days`)),
        estimated_delivery_time:  `${etaDays} days`,
        production_lead_days:     prodDays,
        shipping_days:            shipDays,
        signature:                sig,
        sections:                 sects,
        lines,
        source_file: 'engine:v2.9-fixed-impact',
        debug: {
            params:   p,
            pages:    { interior: parseInt(p.interior_pages, 10), cover: parseInt(p.cover_pages, 10) },
            copies,
            signature: sig,
            sections: sects,
            rates_used: {
                binding:   p.binding_method,
                finishing: p.finishing_options,
                book_size: p.book_size_code,
            },
            components: {
                cost_paper_int: round2(costPaperInt),
                cost_print_int: round2(costPrintInt),
                cost_paper_cov: round2(costPaperCov),
                cost_print_cov: round2(costPrintCov),
                cost_binding:   round2(costBinding),
                cost_ship:      round2(costShip),
                subtotal:       round2(subtotal),
            },
            eta: { prod_days: prodDays, ship_days: shipDays, eta_days: etaDays },
        },
    };
}

/* -------------------------------------------------------------------------
 * Multi-house estimate
 * ---------------------------------------------------------------------- */

/**
 * Calculates estimates for all applicable houses, sorted by total cost.
 * @param {object}   params  Raw input params
 * @param {object[]} houses  Normalised print houses from Repository
 * @returns {{ ok: boolean, data: object }}
 */
function estimateAll(params, houses) {
    const p = normalizeParams(params);
    const offers = [];
    const errors = {};

    for (const h of houses) {
        try {
            const houseId   = arrGet(h, 'id', 'unknown');
            const limits    = arrGet(h, 'limits', {});
            const minCopies = parseInt(arrGet(limits, 'min_copies', 0), 10);
            const maxPages  = parseInt(arrGet(limits, 'max_pages', Number.MAX_SAFE_INTEGER), 10);

            if (p.copies < minCopies) {
                errors[houseId] = `Minimum ${minCopies} copies required`;
                continue;
            }
            if (parseInt(p.interior_pages, 10) > maxPages) {
                errors[houseId] = `Maximum ${maxPages} pages allowed`;
                continue;
            }

            offers.push(buildPrice(p, h));
        } catch (err) {
            const houseId = arrGet(h, 'id', 'unknown');
            errors[houseId] = err.message;
        }
    }

    // Filter by allowed signatures based on book size
    const widthMm  = parseInt(p.book_width_mm  ?? p.width_mm  ?? 0, 10);
    const heightMm = parseInt(p.book_height_mm ?? p.height_mm ?? 0, 10);
    let allowedSignatures = null;

    if (
        (widthMm >= 100 && widthMm <= 105  && heightMm >= 120 && heightMm <= 148) ||
        (widthMm >= 106 && widthMm <= 119  && heightMm >= 149 && heightMm <= 166) ||
        (widthMm >= 120 && widthMm <= 150  && heightMm >= 167 && heightMm <= 214) ||
        (widthMm >= 151 && widthMm <= 170  && heightMm >= 167 && heightMm <= 245) ||
        (widthMm >= 150 && widthMm <= 214  && heightMm >= 120 && heightMm <= 148) ||
        (widthMm >= 215 && widthMm <= 245  && heightMm >= 149 && heightMm <= 167)
    ) {
        allowedSignatures = [32];
    } else if (
        (widthMm >= 175 && widthMm <= 214  && heightMm >= 250 && heightMm <= 302) ||
        (widthMm >= 175 && widthMm <= 245  && heightMm >= 303 && heightMm <= 340) ||
        (widthMm >= 250 && widthMm <= 297  && heightMm >= 160 && heightMm <= 212) ||
        (widthMm === 297                   && heightMm >= 215 && heightMm <= 240)
    ) {
        allowedSignatures = [16];
    } else if (
        (widthMm >= 160 && widthMm <= 214  && heightMm >= 170 && heightMm <= 200) ||
        (widthMm >= 120 && widthMm <= 150  && heightMm >= 246 && heightMm <= 289) ||
        (widthMm >= 175 && widthMm <= 245  && heightMm >= 201 && heightMm <= 220) ||
        (widthMm >= 120 && widthMm <= 167  && heightMm >= 290 && heightMm <= 325) ||
        (widthMm >= 250 && widthMm <= 287  && heightMm >= 250 && heightMm <= 300) ||
        (widthMm >= 288 && widthMm <= 297  && heightMm >= 301 && heightMm <= 340)
    ) {
        allowedSignatures = [24];
    }

    let filteredOffers = offers;
    if (allowedSignatures !== null) {
        filteredOffers = offers.filter(o => allowedSignatures.includes(parseInt(arrGet(o, 'signature', 0), 10)));
    }

    filteredOffers.sort((a, b) => {
        const aa = Number(arrGet(a, 'total_cost', Infinity));
        const bb = Number(arrGet(b, 'total_cost', Infinity));
        return aa < bb ? -1 : aa > bb ? 1 : 0;
    });

    const selected = filteredOffers.length > 0 ? filteredOffers[0] : null;

    return {
        ok: true,
        data: {
            ok:                    true,
            engine:                'json-engine-v2.9',
            print_houses:          filteredOffers,
            selected_print_house:  selected,
            count:                 filteredOffers.length,
            params:                p,
            errors,
        },
        count: filteredOffers.length,
    };
}

module.exports = { buildPrice, estimateAll };
