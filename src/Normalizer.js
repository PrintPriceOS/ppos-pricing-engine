/**
 * PrintPrice OS — Pricing Engine
 *
 * Normalizer — converts varied inputs to canonical values for the engine.
 * Ported from BPE\Normalizer (PHP v2.9).
 *
 * Handles EN/ES synonyms, valid ranges, and contextual defaults.
 */

'use strict';

const DEFAULTS = {
    copies: 250,
    interior_pages: 100,
    cover_pages: 4,
    book_size: 'A5',
    orientation: 'portrait',
    interior_print: '1/1',
    pms_interior: 0,
    cover_print: '4/0',
    cover_print_rev: 0,
    pms_cover: 0,
    paper_weight_interior: 100,
    paper_weight_cover: 240,
    paper_weight_endpapers: 115,
    binding_method: 'perfect bound',
    finishing_options: 'matt',
    delivery_country: 'ES',
    endpapers: 'none',
    endpapers_print: 'none',
    extra_book: 0,
    extra_fixed: 0,
    extra_section: 0,
    extra_variable: 0,
    paper_type_interior: 'offset',
    paper_type_cover: 'artboard',
    paper_type_endpaper: 'offset',
};

/**
 * Parses an integer from a raw value, returning `defaultVal` if not numeric.
 * @param {object} obj
 * @param {string} key
 * @param {number} defaultVal
 * @returns {number}
 */
function getInt(obj, key, defaultVal) {
    const val = obj[key];
    if (val == null) return defaultVal;
    if (typeof val === 'number' && Number.isFinite(val)) return Math.trunc(val);
    const str = String(val).trim();
    if (/^\d+$/.test(str)) return parseInt(str, 10);
    return defaultVal;
}

/** @param {string} code */
function isCustomSizeCode(code) {
    const normalised = code.toUpperCase().replace(/\s+/g, ' ').trim();
    return !['A5', 'A4', '170 X 240 MM', '200 X 200 MM', '220 X 220 MM'].includes(normalised);
}

/** @returns {{ w: string, h: string } | null} */
function extractMm(label) {
    const m = label.match(/(\d{2,4})\s+X\s+(\d{2,4})\s+MM/i);
    return m ? { w: m[1], h: m[2] } : null;
}

/** @returns {{ w: number, h: number } | null} */
function mmFromSeries(code, orientation) {
    const map = {
        'A4':          [210, 297],
        'A5':          [148, 210],
        '170 X 240 MM':[170, 240],
        '200 X 200 MM':[200, 200],
        '220 X 220 MM':[220, 220],
    };
    const dims = map[code];
    if (!dims) return null;
    return orientation === 'portrait'
        ? { w: dims[0], h: dims[1] }
        : { w: dims[1], h: dims[0] };
}

function canonInteriorPrint(v) {
    v = v.toLowerCase().replace(/\s+/g, ' ').trim();

    const map = {
        '4/4': ['4/4', '4-4', 'cmyk', 'color', 'full colors', 'cuatricomía', 'cuatricomia'],
        '2/2': ['2/2', '2-2', 'spot color', '2 colors', '2 colores', 'pantone', 'pms'],
        '1/1': ['1/1', '1-1', 'bw', 'b/w', 'black white', 'monochrome', '1 color', 'black & white', 'blanco y negro'],
    };

    if (['none', 'no', 'sin'].includes(v)) return '1/1';

    for (const [canon, alts] of Object.entries(map)) {
        if (alts.includes(v)) return canon;
    }
    for (const [canon, alts] of Object.entries(map)) {
        if (alts.some(a => a && v.includes(a))) return canon;
    }

    const m = v.match(/^(\d)\s*\/\s*(\d)$/);
    if (m) {
        if (m[1] === '4' && m[2] === '4') return '4/4';
        if (m[1] === '2' && m[2] === '2') return '2/2';
        if (m[1] === '1' && m[2] === '1') return '1/1';
    }

    return ['4/4', '2/2', '1/1'].includes(v) ? v : '1/1';
}

function canonCoverPrint(v) {
    v = v.toLowerCase().replace(/\s+/g, ' ').trim();

    const map = {
        '1/1': ['1/1', '1-1', 'bw', 'b/w', 'black white', 'monochrome', '1 color', 'black & white', 'blanco y negro'],
        '4/4': ['4/4', '4-4', 'cmyk', 'color', 'full color', 'cuatricomía', 'cuatricomia'],
        '4/0': ['4/0', '4-0', 'single side color', 'color 1 cara'],
        '1/0': ['1/0', '1-0', 'single side bw', 'bw 1 cara'],
    };

    if (['none', 'no', 'sin'].includes(v)) return '1/1';

    for (const [canon, alts] of Object.entries(map)) {
        if (alts.includes(v)) return canon;
    }
    for (const [canon, alts] of Object.entries(map)) {
        if (alts.some(a => a && v.includes(a))) return canon;
    }

    const m = v.match(/^(\d)\s*\/\s*(\d)$/);
    if (m) {
        if (m[1] === '1' && m[2] === '1') return '1/1';
        if (m[1] === '4' && m[2] === '4') return '4/4';
        if (m[1] === '4' && m[2] === '0') return '4/0';
        if (m[1] === '1' && m[2] === '0') return '1/0';
    }

    return ['1/1', '4/4', '4/0', '1/0'].includes(v) ? v : '1/1';
}

function canonBinding(v) {
    v = v.toLowerCase().replace(/\s+/g, ' ').trim();

    const map = {
        'hardcover':     ['hardcover', 'hard cover', 'hc', 'casebound', 'case bound', 'case', 'tapa dura', 'cartoné', 'cartone', 'hard cover casebound'],
        'perfect bound': ['perfect bound', 'pega', 'pegado', 'tapa blanda', 'softcover', 'pb', 'perfecto', 'rústica', 'rustica'],
        'wiro':          ['wire-o', 'wiro', 'wire o', 'wire'],
        'saddle':        ['saddle stitch', 'saddle', 'stapled', 'grapado', '2 staples', '2-staple', 'cosido grapas'],
        'sewn':          ['section sewn', 'thread sewn', 'sc', 'sewn', 'cosido', 'cosido hilo', 'hilo', 'cosido en hilo'],
        'spiral':        ['spiral bound', 'spiral', 'espiral bound', 'espiral', 'flexibound', 'flexi bound', 'encuadernación espiral', 'encuadernacion espiral'],
    };

    for (const [canon, alts] of Object.entries(map)) {
        if (alts.includes(v)) return canon;
    }
    for (const [canon, alts] of Object.entries(map)) {
        if (alts.some(a => a && v.includes(a))) return canon;
    }

    if (v.includes('hard') || v.includes('case') || v.includes('dur')) return 'hardcover';
    if (v.includes('wire') || v.includes('wiro')) return 'wiro';
    if (v.includes('saddle') || v.includes('grap')) return 'saddle';
    if (v.includes('sewn') || v.includes('cosido') || v.includes('hilo')) return 'sewn';
    if (v.includes('spiral') || v.includes('espiral') || v.includes('flexibound')) return 'spiral';

    return 'perfect bound';
}

function canonFinishing(v) {
    v = v.toLowerCase().replace(/\s+/g, ' ').trim();

    const noneValues = ['none', 'no', 'sin', 'ninguno', 'no finish', 'no acabado', 'sin laminar', 'sin lamina', 'sin laminación', '0', ''];
    if (noneValues.includes(v) || v.includes('none') || v.includes('no ')) return 'none';

    const map = {
        'matt':       ['matt lamination', 'matte lamination', 'matt lam', 'matt', 'mate', 'laminado mate', 'laminación mate'],
        'gloss':      ['gloss lamination', 'gloss lam', 'gloss', 'brillante', 'laminado brillante', 'laminación brillante'],
        'soft touch': ['soft touch', 'soft-touch', 'velvet', 'toque suave', 'softouch'],
    };

    for (const [canon, alts] of Object.entries(map)) {
        if (alts.includes(v)) return canon;
    }
    for (const [canon, alts] of Object.entries(map)) {
        if (alts.some(a => a && v.includes(a))) return canon;
    }

    if (v.includes('mate') || v.includes('mat')) return 'matt';
    if (v.includes('brill') || v.includes('gloss')) return 'gloss';
    if (v.includes('soft') || v.includes('velvet')) return 'soft touch';

    return 'none';
}

/**
 * Returns 0 | 2 | 4
 * @param {*} v
 * @param {string} bindingMethod
 * @returns {number}
 */
function canonEndpapers(v, bindingMethod) {
    if (typeof v === 'string') v = v.trim().toLowerCase();

    if (typeof v === 'number' || (typeof v === 'string' && /^\d+$/.test(v))) {
        const n = parseInt(v, 10);
        if (n <= 0) return 0;
        if (n < 3) return 2;
        return 4;
    }

    if (typeof v === 'string') {
        const m = v.match(/^\s*(\d+)\s*(p|pp)?\s*$/i);
        if (m) {
            const n = parseInt(m[1], 10);
            if (n <= 0) return 0;
            if (n < 3) return 2;
            return 4;
        }

        const noneValues = ['none', 'no', 'sin', 'ninguno', '0', 'zero', 'cero'];
        if (noneValues.includes(v) || v.includes('none')) return 0;

        if (['standard', 'std', 'estandar', 'estándar'].includes(v)) return 4;
    }

    return bindingMethod === 'hardcover' ? 4 : 0;
}

/** @returns {'none'|'1/1'|'4/4'|'1/0'|'4/0'} */
function canonEndpapersPrint(v) {
    if (v == null) return 'none';
    const raw = String(v).toLowerCase().trim();

    const noneVals = ['none', 'no', 'sin', 'ninguno', '0', 'false', 'off'];
    if (noneVals.includes(raw)) return 'none';

    if (['1/1', '1-1', 'bw', 'b/w', 'monochrome', 'black white', 'blanco y negro', '1color', '1 color'].includes(raw)) return '1/1';
    if (['4/4', '4-4', 'cmyk', 'color', 'full color', 'cuatricomía', 'cuatricomia'].includes(raw)) return '4/4';
    if (['4/0', '4-0'].includes(raw)) return '4/0';
    if (['1/0', '1-0'].includes(raw)) return '1/0';

    const m = raw.match(/^(\d)\s*\/\s*(\d)$/);
    if (m) {
        const f = parseInt(m[1], 10), b = parseInt(m[2], 10);
        if (f === 1 && b === 1) return '1/1';
        if (f === 1 && b === 0) return '1/0';
        if (f === 4 && b === 4) return '4/4';
        if (f === 4 && b === 0) return '4/0';
    }

    return 'none';
}

function canonPaperTypeInterior(v) {
    v = v.toLowerCase().replace(/\s+/g, ' ').trim();
    const map = {
        'offset': ['offset', 'woodfree offset'],
        'mc':     ['mc', 'woodfree mc'],
        'lux':    ['lux', 'lux cream', 'lux cream paper', 'lux-cream'],
        'munken': ['munken', 'munken white/cream', 'munken white', 'munken cream', 'munken paper'],
        'other':  ['other', 'misc', 'other paper'],
    };
    for (const [canon, alts] of Object.entries(map)) {
        if (alts.includes(v)) return canon;
    }
    for (const [canon, alts] of Object.entries(map)) {
        if (alts.some(a => a && v.includes(a))) return canon;
    }
    return 'other';
}

function canonPaperTypeCover(v) {
    v = v.toLowerCase().replace(/\s+/g, ' ').trim();
    const map = {
        'mc':       ['mc', 'woodfree mc'],
        'artboard': ['artboard', 'art board', 'art-board', 'artboard single sided', 'artboard ss'],
        'offset':   ['offset', 'woodfree offset', 'offset paper'],
        'wfmc':     ['wfmc', 'wf-mc', 'wf mc', 'wfmc upm', 'wfmc paper'],
        'other':    ['other', 'misc', 'other paper'],
    };
    for (const [canon, alts] of Object.entries(map)) {
        if (alts.includes(v)) return canon;
    }
    for (const [canon, alts] of Object.entries(map)) {
        if (alts.some(a => a && v.includes(a))) return canon;
    }
    return 'none';
}

function canonPaperTypeEndpaper(v) {
    v = v.toLowerCase().replace(/\s+/g, ' ').trim();
    const map = {
        'offset': ['offset', 'woodfree offset', 'offset paper'],
        'mc':     ['mc', 'woodfree mc'],
        'other':  ['other', 'misc', 'other paper'],
    };
    for (const [canon, alts] of Object.entries(map)) {
        if (alts.includes(v)) return canon;
    }
    for (const [canon, alts] of Object.entries(map)) {
        if (alts.some(a => a && v.includes(a))) return canon;
    }
    return 'none';
}

class Normalizer {
    /**
     * Normalises raw input params into canonical values for the engine.
     * @param {object} p  Raw input
     * @returns {object}  Canonical params
     */
    static normalize(p) {
        const out = {};

        // --- copies ---
        const copies = getInt(p, 'copies', DEFAULTS.copies);
        out.copies = Math.max(1, Math.min(10000, copies));

        // --- cover_pages ---
        const coverPages = getInt(p, 'cover_pages', DEFAULTS.cover_pages);
        out.cover_pages = Math.max(2, Math.min(8, coverPages));

        // --- interior_pages / total_page_count ---
        const interiorPages = getInt(p, 'interior_pages', 0);
        const totalPages    = getInt(p, 'total_page_count', 0);

        if (interiorPages > 0) {
            out.interior_pages   = Math.max(4, Math.min(2000, interiorPages));
            out.total_page_count = out.interior_pages + out.cover_pages;
        } else if (totalPages > 0) {
            out.total_page_count = Math.max(6, Math.min(2008, totalPages));
            out.interior_pages   = Math.max(4, out.total_page_count - out.cover_pages);
        } else {
            out.interior_pages   = DEFAULTS.interior_pages;
            out.total_page_count = out.interior_pages + out.cover_pages;
        }

        // --- orientation ---
        const ori = String(p.orientation ?? DEFAULTS.orientation).toLowerCase().trim();
        out.orientation = ['portrait', 'landscape'].includes(ori) ? ori : DEFAULTS.orientation;

        // --- book size ---
        const sizeCode  = String(p.book_size ?? '').toUpperCase().trim();
        const sizeLabel = String(p.book_size_label ?? p.book_size ?? '').trim();
        const isCustom  = isCustomSizeCode(sizeCode);
        const mm        = isCustom ? extractMm(sizeCode) : mmFromSeries(sizeCode, out.orientation);

        out.book_size        = sizeCode;
        out.book_size_label  = sizeLabel || `${sizeCode} (${mm?.w} × ${mm?.h} mm)`;
        out.book_width_mm    = mm?.w ?? 0;
        out.book_height_mm   = mm?.h ?? 0;

        // --- print modes ---
        out.interior_print  = canonInteriorPrint(String(p.interior_print  ?? DEFAULTS.interior_print));
        out.pms_interior    = Math.max(0, getInt(p, 'pms_interior', DEFAULTS.pms_interior));
        out.cover_print     = canonCoverPrint(String(p.cover_print ?? DEFAULTS.cover_print));
        out.cover_print_rev = Math.max(0, getInt(p, 'cover_print_rev', DEFAULTS.cover_print_rev));
        out.pms_cover       = Math.max(0, getInt(p, 'pms_cover', DEFAULTS.pms_cover));

        // --- paper weights ---
        out.paper_weight_interior  = Math.max(70,  Math.min(250, getInt(p, 'paper_weight_interior',  DEFAULTS.paper_weight_interior)));
        out.paper_weight_cover     = Math.max(135, Math.min(350, getInt(p, 'paper_weight_cover',     DEFAULTS.paper_weight_cover)));
        out.paper_weight_endpapers = Math.max(90,  Math.min(250, getInt(p, 'paper_weight_endpapers', getInt(p, 'endpapers_weight', DEFAULTS.paper_weight_endpapers))));

        // --- extras ---
        out.extra_book     = Math.max(0, getInt(p, 'extra_book',     DEFAULTS.extra_book));
        out.extra_fixed    = Math.max(0, getInt(p, 'extra_fixed',    DEFAULTS.extra_fixed));
        out.extra_section  = Math.max(0, getInt(p, 'extra_section',  DEFAULTS.extra_section));
        out.extra_variable = Math.max(0, getInt(p, 'extra_variable', DEFAULTS.extra_variable));

        // --- paper types ---
        out.paper_type_interior  = canonPaperTypeInterior(String(p.paper_type_interior  ?? DEFAULTS.paper_type_interior));
        out.paper_type_cover     = canonPaperTypeCover(String(p.paper_type_cover     ?? DEFAULTS.paper_type_cover));
        out.paper_type_endpaper  = canonPaperTypeEndpaper(String(p.paper_type_endpaper  ?? DEFAULTS.paper_type_endpaper));

        // --- binding method ---
        const bindingInput = String(p.binding_method ?? p.binding ?? '').toLowerCase().trim();
        out.binding_method = canonBinding(bindingInput);

        // --- finishing options ---
        const finishInput = String(p.finishing_options ?? p.finishing ?? '').toLowerCase().trim();
        out.finishing_options = canonFinishing(finishInput);

        // --- uv_varnish ---
        const uvRaw = p.uv_varnish ?? false;
        if (typeof uvRaw === 'boolean') {
            out.uv_varnish = uvRaw;
        } else {
            const s = String(uvRaw).toLowerCase().trim();
            out.uv_varnish = ['1', 'true', 'yes', 'on'].includes(s);
        }

        // --- endpapers ---
        const epRaw = p.endpapers ?? DEFAULTS.endpapers;
        out.endpapers = canonEndpapers(epRaw, out.binding_method);

        // --- endpapers_print ---
        const eppRaw = p.endpapers_print ?? DEFAULTS.endpapers_print;
        out.endpapers_print = canonEndpapersPrint(eppRaw);

        // --- delivery country ---
        const cc = String(p.delivery_country ?? DEFAULTS.delivery_country).trim().toUpperCase().slice(0, 2);
        out.delivery_country = /^[A-Z]{2}$/.test(cc) ? cc : DEFAULTS.delivery_country;

        // --- aliases for compat ---
        out.width_mm      = out.book_width_mm;
        out.height_mm     = out.book_height_mm;
        out.book_size_code = isCustom ? 'CUSTOM' : out.book_size;

        return out;
    }
}

module.exports = Normalizer;
