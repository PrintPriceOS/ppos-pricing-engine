'use strict';

const crypto = require('crypto');

/**
 * Recursive sorted-key JSON serialization for deterministic checksums.
 * Exactly matches Control Plane printhousePricingGovernanceService canonicalStringify.
 *
 * @param {any} obj
 * @returns {string}
 */
function canonicalStringify(obj) {
    if (obj === null || obj === undefined) return 'null';
    if (typeof obj !== 'object') return JSON.stringify(obj);
    if (Array.isArray(obj)) {
        return '[' + obj.map(v => canonicalStringify(v)).join(',') + ']';
    }
    const keys = Object.keys(obj).sort();
    const pairs = keys.map(k => JSON.stringify(k) + ':' + canonicalStringify(obj[k]));
    return '{' + pairs.join(',') + '}';
}

/**
 * Computes deterministic SHA-256 checksum of rates payload.
 *
 * @param {object|string} ratesJson
 * @returns {string|null} Format: "sha256:<hex>"
 */
function computeRatesChecksum(ratesJson) {
    if (!ratesJson) return null;
    const parsed = typeof ratesJson === 'string' ? JSON.parse(ratesJson) : ratesJson;
    const canonical = canonicalStringify(parsed);
    return 'sha256:' + crypto.createHash('sha256').update(canonical).digest('hex');
}

module.exports = {
    canonicalStringify,
    computeRatesChecksum
};
