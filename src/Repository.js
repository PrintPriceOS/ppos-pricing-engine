/**
 * PrintPrice OS — Pricing Engine
 *
 * Repository — loads and normalises print house data from a JSON file.
 * Ported from BPE\Repository (PHP v2.9).
 *
 * Key behaviours preserved from PHP:
 *   - Full `rates` structure is kept intact (never flattened) — engine depends on it
 *   - `signatures` array is always present; falls back to [16]
 *   - Multiple field-name aliases are resolved (id/house_id/slug, name/print_house/title, etc.)
 *   - Load metadata tracked for diagnostics (loadedPath, count, errors, warnings)
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_JSON_PATH = path.resolve(__dirname, '../data/print-houses.json');

const DEFAULTS = {
    signature: 16,
    signatures: [16],
    production_lead_days: 7,
    shipping_days: 2,
    shipping_per_kg: 0.95,
};

/**
 * Converts a string to a URL-safe slug (mirrors WP's sanitize_title).
 * @param {string} str
 * @returns {string}
 */
function slugify(str) {
    return String(str)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

/**
 * Normalises a raw array of print house objects loaded from JSON.
 * @param {Array<object>} rows
 * @param {string[]} warnings  Mutable array — warnings are pushed here.
 * @returns {Array<object>}
 */
function normalizeList(rows, warnings = []) {
    const normalized = [];

    for (const row of rows) {
        if (!row || typeof row !== 'object' || Array.isArray(row)) {
            warnings.push('Skipping non-object house entry');
            continue;
        }

        // --- Identifiers ---
        const id = String(
            row.id ??
            row.house_id ??
            row.slug ??
            slugify(row.name ?? row.print_house ?? 'unknown')
        );

        const name = String(
            row.name ??
            row.print_house ??
            row.title ??
            'Unknown Print House'
        );

        // --- Signatures (supports multiple source formats) ---
        let signatures = [];
        if (Array.isArray(row.signatures) && row.signatures.length > 0) {
            signatures = row.signatures.filter(v => typeof v === 'number');
        } else if (typeof row.signature === 'number') {
            signatures = [row.signature];
        } else if (Array.isArray(row.rates?.signatures) && row.rates.signatures.length > 0) {
            signatures = row.rates.signatures.filter(v => typeof v === 'number');
        }

        if (signatures.length === 0) {
            signatures = [...DEFAULTS.signatures];
            warnings.push(`House ${id} missing signatures, using default`);
        }

        const signature = signatures[0] ?? DEFAULTS.signature;

        // --- Rates — MUST remain intact, never flattened ---
        const rates = (row.rates && typeof row.rates === 'object' && !Array.isArray(row.rates))
            ? row.rates
            : {};

        // --- Shipping structure ---
        const shipping = (row.shipping && typeof row.shipping === 'object' && !Array.isArray(row.shipping))
            ? row.shipping
            : {};

        // --- Lead times ---
        const prod_days = parseInt(
            row.production_lead_days ??
            row.production_days ??
            row.lead_time ??
            DEFAULTS.production_lead_days,
            10
        );

        const ship_days = parseInt(
            row.shipping_days ??
            row.shipping_lead_days ??
            row.transit_days ??
            DEFAULTS.shipping_days,
            10
        );

        // --- Limits ---
        let limits = {};
        if (row.limits && typeof row.limits === 'object' && !Array.isArray(row.limits)) {
            limits = row.limits;
        } else if (row.min_copies != null || row.max_pages != null) {
            limits = {
                min_copies: parseInt(row.min_copies ?? 0, 10),
                max_pages: parseInt(row.max_pages ?? 2000, 10),
            };
        }

        normalized.push({
            id,
            house_id: id,
            print_house: name,
            name,

            signature,
            signatures,
            production_lead_days: prod_days,
            shipping_days: ship_days,
            limits,

            // Critical — keep full structure for engine
            rates,
            shipping,

            delivery_time: `${prod_days}+${ship_days} days`,
            estimated_delivery_time: `${prod_days + ship_days} days`,
            source_file: String(row.source_file ?? ''),

            _debug: {
                original_keys: Object.keys(row),
                has_rates: Object.keys(rates).length > 0,
                signature_source: Array.isArray(row.signatures) ? 'signatures'
                    : (row.signature != null ? 'signature' : 'default'),
            },
        });
    }

    return normalized;
}

class Repository {
    constructor(filePath = DEFAULT_JSON_PATH) {
        /** @type {Array<object>} */
        this._cache = [];

        /** @type {object|null} */
        this._meta = null;

        this.load(filePath);
    }

    /**
     * Loads print houses from a JSON file.
     * Re-entrant — calling load() again replaces the current cache.
     *
     * @param {string} filePath  Absolute path to print-houses.json
     * @returns {void}
     */
    load(filePath) {
        this._cache = [];
        this._meta = {
            source: 'file',
            loadedPath: null,
            count: 0,
            errors: [],
            warnings: [],
        };

        const resolvedPath = path.resolve(filePath);

        try {
            if (!fs.existsSync(resolvedPath)) {
                this._meta.errors.push(`File not found: ${resolvedPath}`);
                return;
            }

            const raw = fs.readFileSync(resolvedPath, 'utf8');
            let data;

            try {
                data = JSON.parse(raw);
            } catch (parseErr) {
                this._meta.errors.push(`JSON parse error in ${resolvedPath}: ${parseErr.message}`);
                return;
            }

            if (!Array.isArray(data)) {
                this._meta.errors.push(`Expected a JSON array in ${resolvedPath}`);
                return;
            }

            if (data.length === 0) {
                this._meta.warnings.push(`Empty array in ${resolvedPath}`);
            }

            const warnings = [];
            this._cache = normalizeList(data, warnings);
            this._meta.warnings.push(...warnings);
            this._meta.loadedPath = resolvedPath;
            this._meta.count = this._cache.length;

        } catch (err) {
            this._meta.errors.push(`Unexpected error loading ${resolvedPath}: ${err.message}`);
        }
    }

    /**
     * Returns all normalised print houses.
     * @returns {Array<object>}
     */
    all() {
        return this._cache;
    }

    /**
     * Finds a single house by id.
     * @param {string} id
     * @returns {object|null}
     */
    find(id) {
        return this._cache.find(h => h.id === id || h.house_id === id) ?? null;
    }

    /**
     * Returns load metadata for diagnostics.
     * @returns {object}
     */
    debugMeta() {
        return this._meta ?? {};
    }

    /**
     * Validates that each house has the data the engine needs.
     * @returns {{ valid: boolean, issues: string[], count: number }}
     */
    validateData() {
        const issues = [];
        let valid = true;

        for (const house of this._cache) {
            const id = house.id ?? 'unknown';

            if (!house.rates || Object.keys(house.rates).length === 0) {
                issues.push(`House ${id} missing 'rates' structure`);
                valid = false;
                continue;
            }

            if (!house.shipping?.per_kg) {
                issues.push(`House ${id} missing shipping rates`);
            }

            if (!Array.isArray(house.signatures) || house.signatures.length === 0) {
                issues.push(`House ${id} missing signatures array`);
                valid = false;
            }
        }

        return { valid, issues, count: this._cache.length };
    }
}

module.exports = Repository;
