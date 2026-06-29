'use strict';

const LicenseRepository = require('../src/LicenseRepository');

function formatExpiresAt(expiresAt) {
    if (!expiresAt) return '';
    return expiresAt instanceof Date ? expiresAt.toISOString() : String(expiresAt);
}

function normalizeSiteUrl(url) {
    return String(url).toLowerCase().replace(/\/+$/, '');
}

function isExpired(license) {
    return license.expires_at && new Date(license.expires_at) < new Date();
}

async function licensesRoutes(fastify, options) {
    const repo = options.licenseRepository || new LicenseRepository();
    if (!options.licenseRepository) {
        await repo.init();
        fastify.addHook('onClose', async () => repo.close());
    }

    fastify.post('/licenses/activate', async (request, reply) => {
        const { license_key, site_url, plugin_version } = request.body || {};

        if (!license_key || !site_url || !plugin_version) {
            return reply.status(400).send({
                message: 'license_key, site_url, and plugin_version are required',
            });
        }

        const license = await repo.findByKey(license_key);
        if (!license) {
            return reply.status(404).send({ message: 'License not found' });
        }

        if (license.status !== 'active') {
            return reply.status(403).send({
                message: `License is ${license.status}`,
            });
        }

        if (isExpired(license)) {
            return reply.status(403).send({ message: 'License has expired' });
        }

        const normalizedUrl = normalizeSiteUrl(site_url);
        const existingSite = (license.activated_sites || []).find(
            s => normalizeSiteUrl(s.site_url) === normalizedUrl
        );

        if (existingSite) {
            await repo.updateSiteActivation(license_key, existingSite.site_url, plugin_version);
        } else {
            if (license.max_activations !== -1 &&
                (license.activated_sites || []).length >= license.max_activations) {
                return reply.status(403).send({
                    message: 'Maximum activations reached',
                });
            }
            await repo.addSiteActivation(license_key, normalizedUrl, plugin_version);
        }

        return {
            plan: license.plan,
            expires_at: formatExpiresAt(license.expires_at),
            customer: license.customer,
            message: 'License activated successfully',
        };
    });

    fastify.post('/licenses/deactivate', async (request, reply) => {
        const { license_key, site_url } = request.body || {};

        if (!license_key || !site_url) {
            return reply.status(400).send({
                message: 'license_key and site_url are required',
            });
        }

        const license = await repo.findByKey(license_key);
        if (!license) {
            return reply.status(404).send({ message: 'License not found' });
        }

        await repo.removeSiteActivation(license_key, normalizeSiteUrl(site_url));

        return { message: 'License deactivated successfully' };
    });

    fastify.post('/licenses/verify', async (request, reply) => {
        const { license_key, site_url } = request.body || {};

        if (!license_key || !site_url) {
            return reply.status(400).send({
                message: 'license_key and site_url are required',
            });
        }

        const license = await repo.findByKey(license_key);
        if (!license) {
            return reply.status(404).send({ message: 'License not found' });
        }

        if (license.status !== 'active') {
            return reply.status(403).send({
                message: 'License is not active',
            });
        }

        if (isExpired(license)) {
            return reply.status(403).send({ message: 'License has expired' });
        }

        const normalizedUrl = normalizeSiteUrl(site_url);
        const activated = (license.activated_sites || []).some(
            s => normalizeSiteUrl(s.site_url) === normalizedUrl
        );

        if (!activated) {
            return reply.status(403).send({
                message: 'Site is not activated for this license',
            });
        }

        return {
            plan: license.plan,
            expires_at: formatExpiresAt(license.expires_at),
            customer: license.customer,
        };
    });
}

module.exports = licensesRoutes;
