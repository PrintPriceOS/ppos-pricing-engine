/**
 * PrintPrice OS — Pricing Engine
 *
 * MarketplaceOfferMapper — transforms deterministic estimates into
 * Control Plane Marketplace-compatible offers.
 */

'use strict';

/**
 * Converts a string to a URL-safe slug (mirrors Repository.js).
 * @param {string} str
 * @returns {string}
 */
function slugify(str) {
    if (!str) return '';
    return String(str)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

/**
 * Ensures a value is a finite number or returns null.
 * @param {*} value
 * @returns {number|null}
 */
function toFiniteNumber(value) {
    if (value == null || value === '') return null;
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
}

/**
 * Derives a stable identity for a print house.
 * @param {object} house
 * @param {number|null} rank
 * @returns {string}
 */
function getHouseIdentity(house, rank = null) {
    if (!house) return rank !== null ? `unknown-rank-${rank}` : 'unknown';
    const id = house.house_id || house.id || slugify(house.print_house || house.name);
    if (id) return String(id);
    return rank !== null ? `unknown-rank-${rank}` : 'unknown';
}

/**
 * Maps a single print house estimate to a Marketplace Offer.
 *
 * @param {object} house           The house estimate from BPE
 * @param {object} context         Marketplace context (margins, IDs, etc.)
 * @param {number} rank            1-based rank
 * @param {boolean} isRecommended  Whether this is the recommended offer
 * @returns {object}               Marketplace Offer
 */
function mapToOffer(house, context, rank, isRecommended) {
    const printerId = getHouseIdentity(house, rank);
    
    const productionCost = toFiniteNumber(house.total_cost);
    const targetMarginPct = toFiniteNumber(context.target_margin_pct);

    let suggestedPrice = null;
    let estimatedMargin = null;
    let marginPct = 0;

    // Validate margin: [0, 100)
    const isMarginValid = targetMarginPct !== null && targetMarginPct >= 0 && targetMarginPct < 100;

    if (productionCost !== null) {
        if (isMarginValid) {
            // Gross margin formula: price = cost / (1 - margin_pct/100)
            suggestedPrice = productionCost / (1 - (targetMarginPct / 100));
            estimatedMargin = suggestedPrice - productionCost;
            marginPct = targetMarginPct;
        } else {
            suggestedPrice = productionCost;
            estimatedMargin = 0;
            marginPct = 0;
        }
    }

    // Lead time logic (integer-safe)
    const rawProdDays = toFiniteNumber(house.production_lead_days);
    const rawShipDays = toFiniteNumber(house.shipping_days);
    
    const productionLeadDays = rawProdDays !== null ? Math.ceil(rawProdDays) : 0;
    const shippingDays = rawShipDays !== null ? Math.ceil(rawShipDays) : 0;
    
    let leadTimeDays = 0;

    if (productionLeadDays !== 0 || shippingDays !== 0) {
        leadTimeDays = productionLeadDays + shippingDays;
    } else {
        const deliveryStr = String(house.estimated_delivery_time || house.delivery_time || '');
        const m = deliveryStr.match(/(\d+)/g);
        if (m) {
            const sum = m.reduce((acc, curr) => acc + parseInt(curr, 10), 0);
            leadTimeDays = Math.ceil(sum);
        }
    }

    // Score: 100, 95, 90... min 1
    const priorityScore = Math.max(1, 100 - (rank - 1) * 5);

    // Status & Selection logic
    const isAccepted = isRecommended && context.auto_accept_selected === true;
    const offerStatus = isAccepted ? "ACCEPTED" : "SENT";
    const offerSelected = isAccepted;

    const printerName = house.print_house || house.name || printerId || "Unknown Printer";

    return {
        id: null,
        printer_id: printerId,
        printer_name: printerName,
        house_id: printerId,
        machine_id: house.machine_id || null,
        quote_id: context.quote_id || null,
        currency: context.currency || "EUR",
        production_cost: productionCost !== null ? Number(productionCost.toFixed(4)) : null,
        suggested_price: suggestedPrice !== null ? Number(suggestedPrice.toFixed(4)) : null,
        total_price: suggestedPrice !== null ? Number(suggestedPrice.toFixed(4)) : null,
        total_cost: productionCost !== null ? Number(productionCost.toFixed(4)) : null,
        estimated_margin: estimatedMargin !== null ? Number(estimatedMargin.toFixed(4)) : null,
        margin_pct: Number(marginPct.toFixed(4)),
        lead_time_days: leadTimeDays,
        production_lead_days: productionLeadDays,
        shipping_days: shippingDays,
        estimated_delivery_time: house.estimated_delivery_time || house.delivery_time || `${leadTimeDays} days`,
        delivery_time: house.estimated_delivery_time || house.delivery_time || null,
        offer_rank: rank,
        offer_priority_score: priorityScore,
        offer_status: offerStatus,
        offer_selected: offerSelected,
        breakdown: (house.lines || []).map(l => ({ label: l.item || l.label || "", amount: l.line_total != null ? Number(l.line_total) : (l.value != null ? Number(l.value) : 0) })),
        source: "BPE_REAL_PRICING",
        raw_estimate: house,
    };
}

/**
 * Maps a full BPE estimate result to the Marketplace Offers response shape.
 *
 * @param {object} estimateResult   Result from EstimatesService.estimate()
 * @param {object} context          Metadata from the request
 * @returns {object}
 */
function mapEstimateToMarketplaceOffers(estimateResult, context = {}) {
    const warnings = [];
    const printHouses = Array.isArray(estimateResult.print_houses) ? estimateResult.print_houses : [];

    if (printHouses.length === 0) {
        warnings.push('NO_PRINT_HOUSES_RETURNED');
    }

    // Identify the "recommended" house ID using getHouseIdentity
    const recommendedHouseId = getHouseIdentity(estimateResult.selected_print_house);

    // Validate target_margin_pct
    const targetMarginPct = toFiniteNumber(context.target_margin_pct);
    if (context.target_margin_pct != null) {
        if (targetMarginPct === null || targetMarginPct < 0 || targetMarginPct >= 100) {
            warnings.push('INVALID_TARGET_MARGIN');
        }
    }

    const offers = printHouses.map((house, index) => {
        const rank = index + 1;
        const identity = getHouseIdentity(house, rank);
        
        if (!house.house_id && !house.id) {
            warnings.push(`MISSING_PRINTER_ID_FOR_RANK_${rank}`);
        }
        if (toFiniteNumber(house.total_cost) === null) {
            warnings.push(`MISSING_TOTAL_COST_FOR_RANK_${rank}`);
        }

        let isRecommended = false;
        if (recommendedHouseId !== 'unknown') {
            isRecommended = (identity === recommendedHouseId);
        } else if (index === 0) {
            isRecommended = true;
        }

        return mapToOffer(house, context, rank, isRecommended);
    });

    const selectedOffer = offers.find((o, i) => {
        const identity = getHouseIdentity(printHouses[i], i + 1);
        return (recommendedHouseId !== 'unknown') ? (identity === recommendedHouseId) : (i === 0);
    }) || (offers.length > 0 ? offers[0] : null);

    return {
        ok: true,
        engine: estimateResult.engine || "v3.0",
        source: context.source || "BPE",
        source_ref: context.source_ref || null,
        tenant_id: context.tenant_id || "default",
        trace_id: context.trace_id || null,
        order_id: context.order_id || null,
        job_id: context.job_id || null,
        quote_id: context.quote_id || null,
        currency: context.currency || estimateResult.currency || "EUR",
        params: estimateResult.params || {},
        selected_offer: selectedOffer ? { ...selectedOffer } : null,
        offers: offers,
        count: offers.length,
        warnings,
        errors: estimateResult.errors || {}
    };
}

module.exports = {
    mapEstimateToMarketplaceOffers
};
