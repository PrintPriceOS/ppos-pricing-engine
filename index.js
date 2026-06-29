/**
 * PrintPrice OS — Pricing Engine
 *
 * Canonical Entry Point.
 */

'use strict';

const Repository      = require('./src/Repository');
const Normalizer      = require('./src/Normalizer');
const { buildPrice, estimateAll } = require('./src/PriceEngine');
const EstimatesService = require('./src/EstimatesService');
const LicenseRepository = require('./src/LicenseRepository');

module.exports = {
    Repository,
    Normalizer,
    buildPrice,
    estimateAll,
    EstimatesService,
    LicenseRepository,
};
