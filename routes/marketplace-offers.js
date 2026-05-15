/**
 * PrintPrice OS — Pricing Engine
 *
 * Marketplace Offers Route.
 */

'use strict';

const { Repository, EstimatesService } = require('../index');
const { mapEstimateToMarketplaceOffers } = require('../src/MarketplaceOfferMapper');

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

        try {
            // Call original estimate service with full body
            const estimateResult = service.estimate(request.body);

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
