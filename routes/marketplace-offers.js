/**
 * PrintPrice OS — Pricing Engine
 *
 * Marketplace Offers Route & Rate Publication Ingestion.
 */

'use strict';

const { Repository, EstimatesService } = require('../index');
const { mapEstimateToMarketplaceOffers } = require('../src/MarketplaceOfferMapper');
const { computeRatesChecksum } = require('../src/RatesChecksum');

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

    // Direct physical attributes:
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

    // Custom dimensions: preserve book_width_mm / book_height_mm and aliases
    if (raw.book_width_mm !== undefined) mapped.custom_width = raw.book_width_mm;
    else if (raw.width_mm !== undefined) mapped.custom_width = raw.width_mm;
    else if (raw.width !== undefined) mapped.custom_width = raw.width;

    if (raw.book_height_mm !== undefined) mapped.custom_height = raw.book_height_mm;
    else if (raw.height_mm !== undefined) mapped.custom_height = raw.height_mm;
    else if (raw.height !== undefined) mapped.custom_height = raw.height;

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

        try {
            // Call pricing calculation service with mapped body
            const estimateResult = service.estimate(normalizedPayload);

            if (!estimateResult.print_houses || estimateResult.print_houses.length === 0) {
                return reply.status(422).send({
                    ok: false,
                    error: 'NO_MATCHING_PRINTHOUSES',
                    details: 'No print houses available or matching the requested specifications'
                });
            }

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

    /**
     * POST /api/marketplace/revisions/publish
     * Receives accepted pricing revision from Control Plane, validates mappings,
     * updates MongoDB with readback verification, and refreshes all active Repository caches.
     */
    fastify.post('/marketplace/revisions/publish', async (request, reply) => {
        // 1. Strict Authentication
        const configuredToken = (process.env.PPOS_BPE_SERVICE_TOKEN || '').trim();
        if (!configuredToken) {
            return reply.status(503).send({
                ok: false,
                error: 'BPE_PUBLICATION_DISABLED',
                details: 'BPE publication service token (PPOS_BPE_SERVICE_TOKEN) is not configured on this server'
            });
        }

        const authHeader = request.headers['x-bpe-service-token'] || request.headers['authorization'];
        if (!authHeader) {
            return reply.status(401).send({
                ok: false,
                error: 'UNAUTHORIZED',
                details: 'Missing BPE publication service token'
            });
        }

        const token = String(authHeader).replace(/^Bearer\s+/i, '').trim();
        if (token !== configuredToken) {
            return reply.status(401).send({
                ok: false,
                error: 'UNAUTHORIZED',
                details: 'Invalid BPE publication service token'
            });
        }

        // 2. Validate payload fields
        const body = request.body || {};
        const {
            tenant_id,
            printer_node_id,
            bpe_printhouse_id,
            revision_id,
            accepted_patch_checksum,
            version,
            rates
        } = body;

        if (!tenant_id || !printer_node_id || !bpe_printhouse_id || !revision_id || !accepted_patch_checksum || !rates) {
            return reply.status(400).send({
                ok: false,
                error: 'MISSING_REQUIRED_FIELDS',
                details: 'tenant_id, printer_node_id, bpe_printhouse_id, revision_id, accepted_patch_checksum, and rates are required'
            });
        }

        // 3. Compute canonical rates checksum to verify and distinguish from patch checksum
        const calculatedRatesChecksum = computeRatesChecksum(rates);
        if (!calculatedRatesChecksum) {
            return reply.status(400).send({
                ok: false,
                error: 'INVALID_RATES_PAYLOAD',
                details: 'Rates payload could not be parsed or serialized'
            });
        }

        fastify.log.info({
            tenant_id,
            printer_node_id,
            bpe_printhouse_id,
            revision_id,
            patch_checksum: accepted_patch_checksum,
            rates_checksum: calculatedRatesChecksum
        }, '[BPE][REVISION-PUBLISH] Validating rate publication from Control Plane');

        // 4. Persistence to MongoDB with explicit verification
        const mongoUri = process.env.MONGODB_URI;
        if (!mongoUri) {
            return reply.status(500).send({
                ok: false,
                error: 'MONGODB_NOT_CONFIGURED',
                details: 'MongoDB connection URI is not configured on this server'
            });
        }

        const { MongoClient } = require('mongodb');
        let client;

        try {
            client = new MongoClient(mongoUri);
            await client.connect();
            const db = client.db();
            const printhousesColl = db.collection('printhouses');

            // Find printhouse strictly by canonical identifiers (no loose slug collision)
            const house = await printhousesColl.findOne({
                $or: [
                    { id: bpe_printhouse_id },
                    { house_id: bpe_printhouse_id }
                ]
            });

            if (!house) {
                return reply.status(404).send({
                    ok: false,
                    error: 'PRINTHOUSE_NOT_FOUND',
                    details: `No printhouse found matching bpe_printhouse_id "${bpe_printhouse_id}"`
                });
            }

            // 1. Strict Tenant Mapping Check: must be pre-configured and match
            if (!house.tenant_id) {
                return reply.status(403).send({
                    ok: false,
                    error: 'TENANT_MAPPING_UNCONFIGURED',
                    details: `Printhouse "${bpe_printhouse_id}" has no previously established tenant mapping in BPE`
                });
            }

            if (String(house.tenant_id) !== String(tenant_id)) {
                return reply.status(403).send({
                    ok: false,
                    error: 'TENANT_MISMATCH',
                    details: `Printhouse "${bpe_printhouse_id}" belongs to tenant "${house.tenant_id}", publication attempted for tenant "${tenant_id}"`
                });
            }

            // 2. Strict Printer Node Mapping Check: must be pre-configured and match
            const mappedNodeId = house.printer_node_id || house.control_plane_node_id || house.node_id;
            if (!mappedNodeId) {
                return reply.status(400).send({
                    ok: false,
                    error: 'PRINTER_NODE_MAPPING_UNCONFIGURED',
                    details: `Printhouse "${bpe_printhouse_id}" has no previously established printer node mapping in BPE`
                });
            }

            if (String(mappedNodeId) !== String(printer_node_id)) {
                return reply.status(400).send({
                    ok: false,
                    error: 'PRINTER_NODE_MISMATCH',
                    details: `Printhouse "${bpe_printhouse_id}" is mapped to node "${mappedNodeId}", publication specified "${printer_node_id}"`
                });
            }

            // 3. Idempotency Check: exact same revision, patch checksum, AND rates checksum
            if (house.accepted_patch_checksum === accepted_patch_checksum && String(house.published_revision_id) === String(revision_id)) {
                const storedRatesCalculatedChecksum = computeRatesChecksum(house.rates);
                const storedRatesChecksum = house.rates_checksum || storedRatesCalculatedChecksum;

                // If rates differ, reject even if revision and patch checksum match!
                if (calculatedRatesChecksum !== storedRatesCalculatedChecksum) {
                    return reply.status(409).send({
                        ok: false,
                        error: 'RATES_CHECKSUM_MISMATCH',
                        details: `Identical revision "${revision_id}" and patch checksum submitted with conflicting rates payload (expected: ${storedRatesCalculatedChecksum}, got: ${calculatedRatesChecksum})`
                    });
                }

                fastify.log.info({ bpe_printhouse_id, revision_id, checksum: accepted_patch_checksum, rates_checksum: storedRatesChecksum }, '[BPE][REVISION-PUBLISH] Idempotent publication replay verified');

                // Broadcast to ensure all active in-memory repositories have latest state
                Repository.broadcastRatesUpdate(bpe_printhouse_id, house.rates, {
                    accepted_patch_checksum,
                    rates_checksum: storedRatesChecksum,
                    revision_id,
                    version: house.version,
                    printer_node_id: house.printer_node_id,
                    tenant_id: house.tenant_id,
                    status: house.status,
                    active: house.active
                });

                return reply.send({
                    ok: true,
                    already_published: true,
                    status: 'PUBLISHED',
                    checksum: accepted_patch_checksum,
                    accepted_patch_checksum,
                    rates_checksum: storedRatesChecksum,
                    readback: {
                        verified: true,
                        accepted_patch_checksum: house.accepted_patch_checksum,
                        rates_checksum: storedRatesChecksum
                    },
                    bpe_printhouse_id,
                    revision_id,
                    version: house.version,
                    published_at: house.updated_at ? (typeof house.updated_at.toISOString === 'function' ? house.updated_at.toISOString() : String(house.updated_at)) : new Date().toISOString()
                });
            }

            // 4. Version check: prevent older revision from overwriting newer publication
            const currentVersion = Number(house.version) || 0;
            const incomingVersion = Number(version) || 1;

            if (incomingVersion < currentVersion) {
                return reply.status(409).send({
                    ok: false,
                    error: 'OUTDATED_REVISION',
                    details: `Cannot publish revision version ${incomingVersion}; printhouse is already at version ${currentVersion}`
                });
            }

            if (incomingVersion === currentVersion && house.accepted_patch_checksum && house.accepted_patch_checksum !== accepted_patch_checksum) {
                return reply.status(409).send({
                    ok: false,
                    error: 'VERSION_CONFLICT',
                    details: `Version ${incomingVersion} has already been published with a different patch checksum`
                });
            }

            // 5. Update in MongoDB with atomic version guard (do not mutate established tenant or node mappings!)
            const updateResult = await printhousesColl.updateOne(
                {
                    _id: house._id,
                    $or: [
                        { version: { $lt: incomingVersion } },
                        { version: incomingVersion, accepted_patch_checksum: accepted_patch_checksum },
                        { version: { $exists: false } }
                    ]
                },
                {
                    $set: {
                        rates,
                        accepted_patch_checksum,
                        rates_checksum: calculatedRatesChecksum,
                        published_revision_id: revision_id,
                        version: incomingVersion,
                        updated_at: new Date()
                    }
                },
                { upsert: false }
            );

            if (updateResult.matchedCount === 0) {
                return reply.status(409).send({
                    ok: false,
                    error: 'CONCURRENT_MODIFICATION',
                    details: 'Failed to update printhouse due to version conflict or concurrent modification'
                });
            }

            // Real readback from MongoDB to confirm persistence
            const readbackDoc = await printhousesColl.findOne({ _id: house._id });
            if (!readbackDoc) {
                return reply.status(500).send({
                    ok: false,
                    error: 'READBACK_FAILED',
                    details: 'Failed to read back printhouse document from MongoDB after update'
                });
            }

            if (readbackDoc.accepted_patch_checksum !== accepted_patch_checksum) {
                return reply.status(500).send({
                    ok: false,
                    error: 'READBACK_CHECKSUM_MISMATCH',
                    details: `Readback patch checksum mismatch. Expected: ${accepted_patch_checksum}, Stored: ${readbackDoc.accepted_patch_checksum}`
                });
            }

            const readbackRatesChecksum = computeRatesChecksum(readbackDoc.rates);
            if (readbackRatesChecksum !== calculatedRatesChecksum) {
                return reply.status(500).send({
                    ok: false,
                    error: 'READBACK_RATES_CHECKSUM_MISMATCH',
                    details: `Readback rates checksum mismatch. Expected: ${calculatedRatesChecksum}, Stored: ${readbackRatesChecksum}`
                });
            }

            // Synchronize in-memory cache across ALL active Repository instances (estimates & marketplace)
            const updatedCount = Repository.broadcastRatesUpdate(bpe_printhouse_id, rates, {
                accepted_patch_checksum,
                rates_checksum: calculatedRatesChecksum,
                revision_id,
                version: incomingVersion,
                printer_node_id,
                tenant_id,
                status: house.status,
                active: house.active
            });

            fastify.log.info({
                bpe_printhouse_id,
                revision_id,
                incomingVersion,
                updatedCount
            }, '[BPE][REVISION-PUBLISH] Rates updated in MongoDB, verified via readback, and propagated to active repositories');

            return reply.send({
                ok: true,
                status: 'PUBLISHED',
                checksum: accepted_patch_checksum,
                accepted_patch_checksum,
                rates_checksum: calculatedRatesChecksum,
                readback: {
                    verified: true,
                    accepted_patch_checksum: readbackDoc.accepted_patch_checksum,
                    rates_checksum: readbackRatesChecksum
                },
                bpe_printhouse_id,
                revision_id,
                version: incomingVersion,
                published_at: new Date().toISOString()
            });

        } catch (mongoErr) {
            fastify.log.error({ error: mongoErr.message }, '[BPE][REVISION-PUBLISH] MongoDB error');
            return reply.status(500).send({
                ok: false,
                error: 'MONGODB_PERSISTENCE_FAILED',
                details: mongoErr.message
            });
        } finally {
            if (client) {
                await client.close().catch(() => {});
            }
        }
    });
}

module.exports = marketplaceOffersRoutes;
