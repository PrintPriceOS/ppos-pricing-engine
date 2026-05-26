/**
 * PrintPrice OS — Pricing Engine
 *
 * Marketplace Offers Route.
 */

'use strict';

const { Repository, EstimatesService } = require('../index');
const { mapEstimateToMarketplaceOffers } = require('../src/MarketplaceOfferMapper');

function mapMarketplacePayloadToBpe(body) {
    const raw = body.specs || body || {};
    const mapped = {};

    // copies -> quantity / print_run / run_length
    if (raw.copies !== undefined) mapped.copies = raw.copies;
    else if (raw.quantity !== undefined) mapped.copies = raw.quantity;
    else if (raw.print_run !== undefined) mapped.copies = raw.print_run;
    else if (raw.run_length !== undefined) mapped.copies = raw.run_length;

    // interior_pages -> pages / page_count / text_pages
    if (raw.interior_pages !== undefined) mapped.interior_pages = raw.interior_pages;
    else if (raw.pages !== undefined) mapped.interior_pages = raw.pages;
    else if (raw.page_count !== undefined) mapped.interior_pages = raw.page_count;
    else if (raw.text_pages !== undefined) mapped.interior_pages = raw.text_pages;

    // book_size -> format / trim_size
    if (raw.book_size !== undefined) mapped.book_size = raw.book_size;
    else if (raw.format !== undefined) mapped.book_size = raw.format;
    else if (raw.trim_size !== undefined) mapped.book_size = raw.trim_size;

    // delivery_country -> destination_country
    if (raw.delivery_country !== undefined) mapped.delivery_country = raw.delivery_country;
    else if (raw.destination_country !== undefined) mapped.delivery_country = raw.destination_country;
    else if (raw.delivery && raw.delivery.country !== undefined) mapped.delivery_country = raw.delivery.country;

    // binding_method -> binding / binding_type
    if (raw.binding_method !== undefined) mapped.binding_method = raw.binding_method;
    else if (raw.binding !== undefined) mapped.binding_method = raw.binding;
    else if (raw.binding_type !== undefined) mapped.binding_method = raw.binding_type;

    // interior_print -> color mode / print mode
    if (raw.interior_print !== undefined) mapped.interior_print = raw.interior_print;
    else if (raw.color_mode !== undefined) mapped.interior_print = raw.color_mode;
    else if (raw.print_mode !== undefined) mapped.interior_print = raw.print_mode;
    else if (raw.colorMode !== undefined) mapped.interior_print = raw.colorMode;
    else if (raw.printMode !== undefined) mapped.interior_print = raw.printMode;

    // rest of specs:
    const directFields = [
        'cover_pages', 'orientation', 'cover_print', 
        'paper_type_interior', 'paper_weight_interior', 
        'paper_type_cover', 'paper_weight_cover', 
        'finishing_options', 'endpapers', 'endpapers_print',
        'custom_width', 'custom_height',
        'uv_varnish', 'extra_book', 'extra_fixed', 'extra_section', 'extra_variable'
    ];

    for (const f of directFields) {
        if (raw[f] !== undefined) mapped[f] = raw[f];
    }

    // Also support camelCase from modern control plane/budget payloads
    if (raw.coverPages !== undefined) mapped.cover_pages = raw.coverPages;
    if (raw.paperTypeInterior !== undefined) mapped.paper_type_interior = raw.paperTypeInterior;
    if (raw.paperWeightInterior !== undefined) mapped.paper_weight_interior = raw.paperWeightInterior;
    if (raw.paperTypeCover !== undefined) mapped.paper_type_cover = raw.paperTypeCover;
    if (raw.paperWeightCover !== undefined) mapped.paper_weight_cover = raw.paperWeightCover;
    if (raw.bindingMethod !== undefined) mapped.binding_method = raw.bindingMethod;
    if (raw.finishingOptions !== undefined) mapped.finishing_options = raw.finishingOptions;
    if (raw.endpapersPrint !== undefined) mapped.endpapers_print = raw.endpapersPrint;
    if (raw.customWidth !== undefined) mapped.custom_width = raw.customWidth;
    if (raw.customHeight !== undefined) mapped.custom_height = raw.customHeight;
    if (raw.uvVarnish !== undefined) mapped.uv_varnish = raw.uvVarnish;

    // Check custom size dimensions aliases if set
    if (raw.width_mm !== undefined) mapped.custom_width = raw.width_mm;
    if (raw.height_mm !== undefined) mapped.custom_height = raw.height_mm;
    if (raw.width !== undefined) mapped.custom_width = raw.width;
    if (raw.height !== undefined) mapped.custom_height = raw.height;

    return mapped;
}

async function marketplaceOffersRoutes(fastify, options) {
    const repository = new Repository();
    await repository.init();

    const meta = repository.debugMeta();
    if (meta.errors.length > 0) {
        fastify.log.error({ errors: meta.errors }, 'Repository failed to load print houses');
    } else {
        fastify.log.info({ count: meta.count }, 'Print houses loaded from MongoDB');
    }

    const service = new EstimatesService(repository);

    /**
     * POST /api/marketplace/offers
     * Generates Marketplace-compatible offers from BPE calculations.
     */
    fastify.post('/marketplace/offers', async (request, reply) => {
        // Forensic logs: Log incoming raw body (do not log auth / headers / secrets)
        console.log('[BPE_MARKETPLACE_OFFERS_INCOMING]', JSON.stringify(request.body, null, 2));

        const context = {
            source: request.body.source,
            source_ref: request.body.source_ref,
            tenant_id: request.body.tenant_id,
            trace_id: request.body.trace_id,
            order_id: request.body.order_id,
            job_id: request.body.job_id,
            quote_id: request.body.quote_id,
            currency: request.body.currency,
            target_margin_pct: request.body.target_margin_pct,
            auto_accept_selected: request.body.auto_accept_selected,
            metadata: request.body.metadata
        };

        fastify.log.info({
            source: context.source,
            source_ref: context.source_ref,
            tenant_id: context.tenant_id,
            trace_id: context.trace_id,
            order_id: context.order_id,
            job_id: context.job_id
        }, '[BPE][MARKETPLACE-OFFERS][REQUEST]');

        const normalizedPayload = mapMarketplacePayloadToBpe(request.body);
        console.log('[BPE_MARKETPLACE_OFFERS_NORMALIZED]', JSON.stringify(normalizedPayload, null, 2));

        let estimateResult;
        let isFallback = false;

        try {
            // Call original estimate service with mapped body
            estimateResult = service.estimate(normalizedPayload);

            if (!estimateResult.print_houses || estimateResult.print_houses.length === 0) {
                isFallback = true;
            }
        } catch (err) {
            fastify.log.warn({ error: err.message }, '[BPE][MARKETPLACE-OFFERS] Calculation failed, falling back to static offers');
            isFallback = true;
        }

        if (isFallback) {
            const offers = [
                {
                    printer_id: "adv-2025",
                    printer_name: "Adv 2025",
                    suggested_price: 2607.2429,
                    production_cost: 1825.07,
                    total_price: 2607.2429,
                    total_cost: 1825.07,
                    currency: context.currency || "EUR",
                    production_lead_days: 7,
                    shipping_days: 2,
                    estimated_delivery_time: "9 days",
                    source: "BPE_STATIC_FALLBACK",
                    warning: "BPE_STATIC_PRICING_DETECTED",
                    breakdown: []
                },
                {
                    printer_id: "dar-2025",
                    printer_name: "Dar 2025",
                    suggested_price: 2718.3000,
                    production_cost: 1902.81,
                    total_price: 2718.3000,
                    total_cost: 1902.81,
                    currency: context.currency || "EUR",
                    production_lead_days: 7,
                    shipping_days: 2,
                    estimated_delivery_time: "9 days",
                    source: "BPE_STATIC_FALLBACK",
                    warning: "BPE_STATIC_PRICING_DETECTED",
                    breakdown: []
                },
                {
                    printer_id: "poz-2025",
                    printer_name: "Poz 2025",
                    suggested_price: 2752.1571,
                    production_cost: 1926.51,
                    total_price: 2752.1571,
                    total_cost: 1926.51,
                    currency: context.currency || "EUR",
                    production_lead_days: 7,
                    shipping_days: 2,
                    estimated_delivery_time: "9 days",
                    source: "BPE_STATIC_FALLBACK",
                    warning: "BPE_STATIC_PRICING_DETECTED",
                    breakdown: []
                }
            ];

            const fallbackResult = {
                ok: true,
                engine: "v3.0-fallback",
                source: "BPE_STATIC_FALLBACK",
                warning: "BPE_STATIC_PRICING_DETECTED",
                source_ref: context.source_ref || null,
                tenant_id: context.tenant_id || "default",
                trace_id: context.trace_id || null,
                order_id: context.order_id || null,
                job_id: context.job_id || null,
                quote_id: context.quote_id || null,
                currency: context.currency || "EUR",
                params: request.body,
                selected_offer: offers[0],
                offers: offers,
                count: offers.length,
                warnings: ["BPE_STATIC_PRICING_DETECTED"],
                errors: {}
            };

            console.log('[BPE_MARKETPLACE_OFFERS_RESULT_SUMMARY]', {
                offersCount: fallbackResult.offers.length,
                prices: fallbackResult.offers.map(o => ({
                    printer_id: o.printer_id,
                    printer_name: o.printer_name,
                    suggested_price: o.suggested_price,
                    production_cost: o.production_cost,
                    total_price: o.total_price,
                    total_cost: o.total_cost,
                    source: o.source
                }))
            });

            return fallbackResult;
        }

        try {
            fastify.log.info({
                trace_id: context.trace_id,
                count: estimateResult.count,
                engine: estimateResult.engine
            }, '[BPE][MARKETPLACE-OFFERS][ESTIMATE-COMPLETE]');

            // Map to marketplace offers
            const mappedResult = mapEstimateToMarketplaceOffers(estimateResult, context);

            fastify.log.info({
                trace_id: context.trace_id,
                count: mappedResult.count,
                has_selected: !!mappedResult.selected_offer
            }, '[BPE][MARKETPLACE-OFFERS][MAPPED]');

            // Forensic logs: Log result summary (do not log secrets)
            console.log('[BPE_MARKETPLACE_OFFERS_RESULT_SUMMARY]', {
                offersCount: mappedResult.offers.length,
                prices: mappedResult.offers.map(o => ({
                    printer_id: o.printer_id,
                    printer_name: o.printer_name,
                    suggested_price: o.suggested_price,
                    production_cost: o.production_cost,
                    total_price: o.total_price,
                    total_cost: o.total_cost,
                    source: o.source
                }))
            });

            return mappedResult;

        } catch (err) {
            const status = err.code === 400 ? 400 : 500;
            const errorLabel = status === 400 ? 'MARKETPLACE_OFFERS_VALIDATION_FAILED' : 'MARKETPLACE_OFFERS_FAILED';

            fastify.log.error({
                trace_id: context.trace_id,
                error: err.message,
                status
            }, `[BPE][MARKETPLACE-OFFERS][FAILED] — ${err.message}`);

            return reply.status(status).send({
                ok: false,
                error: errorLabel,
                details: err.message
            });
        }
    });
}

module.exports = marketplaceOffersRoutes;
