require('dotenv').config();
const fastify = require('fastify')({ logger: true });

fastify.register(require('@fastify/cors'));
fastify.register(require('@fastify/helmet'));

fastify.register(require('./routes/estimates'), { prefix: '/api' });

fastify.get('/health', async () => ({
    status: 'UP',
    service: 'ppos-pricing-engine',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
}));

const start = async () => {
    try {
        const PORT = process.env.PPOS_PRICING_PORT || 8003;
        await fastify.listen({ port: PORT, host: '0.0.0.0' });
        console.log(`[PRICING-ENGINE] Active on port ${PORT}`);
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};

start();
