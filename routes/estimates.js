'use strict';

const { Repository, EstimatesService } = require('../index');

const repository = new Repository();
const service = new EstimatesService(repository);

async function estimatesRoutes(fastify, options) {
    /**
     * POST /api/pricing/estimates
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
