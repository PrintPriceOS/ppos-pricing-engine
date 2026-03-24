/**
 * PrintPrice OS — Pricing Engine
 *
 * EstimatesService — orchestrates the /estimates endpoint logic.
 * Ported from BPE\REST\BPE_REST::estimates() (PHP v2.9).
 *
 * Usage:
 *   const service = new EstimatesService(repository);
 *   const result  = service.estimate(rawParams);
 */

'use strict';

const Normalizer  = require('./Normalizer');
const { estimateAll } = require('./PriceEngine');

/** Mirrors the PHP REST controller's default_params(). */
const DEFAULTS = {
    copies:                1000,
    interior_pages:        128,
    cover_pages:           4,
    book_size:             'A5',
    book_size_code:        'A5',
    binding_method:        'thread sewn hardcover',
    finishing_options:     'matt lamination',
    interior_print:        '1/1',
    cover_print:           '4/0',
    delivery_country:      'NL',
    endpapers:             '',
    endpapers_print:       '1/0',
    paper_weight_interior: 135,
    paper_weight_cover:    250,
};

class EstimatesService {
    /**
     * @param {import('./Repository')} repository  Loaded Repository instance
     */
    constructor(repository) {
        this.repository = repository;
    }

    /**
     * Runs the full estimates pipeline for a given set of raw params.
     *
     * @param {object} rawParams  Flat JSON payload (no wrapper)
     * @returns {{ ok: boolean, engine: string, count: number, params: object,
     *             selected_print_house: object|null, print_houses: object[],
     *             warning?: string, errors?: object }}
     */
    estimate(rawParams) {
        // 1. Merge with defaults (same order as PHP: defaults first, then input)
        const params = { ...DEFAULTS, ...(rawParams && typeof rawParams === 'object' ? rawParams : {}) };

        // 2. Basic validation
        const validationError = this._validate(params);
        if (validationError) throw Object.assign(new Error(validationError.message), { code: 400 });

        // 3. Load houses
        const houses = this.repository.all();
        if (houses.length === 0) {
            return {
                ok: true,
                engine: 'json-engine-v2.9',
                count: 0,
                params,
                selected_print_house: null,
                print_houses: [],
                warning: 'No print houses available',
            };
        }

        // 4. Full normalisation
        const normalised = Normalizer.normalize(params);

        // 5. Calculate
        const result = estimateAll(normalised, houses);

        if (!result || !result.ok) {
            const errMsg = result?.data?.errors
                ? Object.values(result.data.errors).join('; ')
                : 'Pricing calculation failed';
            throw Object.assign(new Error(errMsg), { code: 400 });
        }

        // 6. No offers produced
        if (!result.data.print_houses || result.data.print_houses.length === 0) {
            return {
                ok: true,
                engine: 'json-engine-v2.9',
                count: 0,
                params: normalised,
                selected_print_house: null,
                print_houses: [],
                warning: 'No valid offers generated for the given parameters',
            };
        }

        // 7. Format response
        return this._formatResponse(result.data);
    }

    // -------------------------------------------------------------------------

    /**
     * Validates critical fields after defaults are merged.
     * @param {object} params
     * @returns {{ message: string } | null}
     */
    _validate(params) {
        const copies = parseInt(params.copies ?? 0, 10);
        if (copies < 1) return { message: 'Invalid copies value' };

        const pages = parseInt(params.interior_pages ?? 0, 10);
        if (pages < 4) return { message: 'Invalid interior pages value' };

        return null;
    }

    /**
     * Shapes the engine's raw output into the frontend-compatible response.
     * Mirrors PHP's format_response().
     * @param {object} data  result.data from estimateAll()
     * @returns {object}
     */
    _formatResponse(data) {
        const items = Array.isArray(data.print_houses) ? data.print_houses : [];

        if (items.length === 0) {
            return {
                ok:     true,
                engine: 'json-engine-v2.9',
                print_houses: [],
                count: 0,
                params: data.params ?? {},
            };
        }

        const response = {
            ok:     true,
            engine: 'json-engine-v2.9',
            count:  data.count != null ? parseInt(data.count, 10) : items.length,
            params: data.params ?? {},
            selected_print_house: data.selected_print_house ?? null,
            print_houses: items.map(house => ({
                print_house:              house.print_house             ?? 'Unknown',
                house_id:                 house.house_id                ?? (house.id ?? 'unknown'),
                total_cost:               Number(house.total_cost       ?? 0),
                delivery_time:            house.delivery_time           ?? 'N/A',
                estimated_delivery_time:  house.estimated_delivery_time ?? 'N/A',
                production_lead_days:     parseInt(house.production_lead_days ?? 0, 10),
                shipping_days:            parseInt(house.shipping_days        ?? 0, 10),
                signature:                parseInt(house.signature            ?? 0, 10),
                sections:                 parseInt(house.sections             ?? 0, 10),
                lines: (house.lines ?? []).map(line => ({
                    item:       line.item       ?? '',
                    line_total: line.line_total != null ? Number(line.line_total) : null,
                    value:      line.value      ?? null,
                })),
            })),
        };

        if (data.errors && Object.keys(data.errors).length > 0) {
            response.errors = data.errors;
        }

        return response;
    }
}

module.exports = EstimatesService;
