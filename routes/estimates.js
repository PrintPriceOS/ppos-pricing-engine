'use strict';

const { Repository, EstimatesService } = require('../index');

async function estimatesRoutes(fastify, options) {
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
     * POST /api/estimates
     * Runs the full pricing pipeline and returns offers from all print houses.
     */
    fastify.post('/estimates', async (request, reply) => {
        try {
            const result = service.estimate(request.body);
            return result;
        } catch (err) {
            const status = err.code === 400 ? 400 : 500;
            return reply.status(status).send({ ok: false, error: err.message });
        }
    });
}

module.exports = estimatesRoutes;
