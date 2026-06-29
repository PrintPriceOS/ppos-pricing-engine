'use strict';

const { MongoClient } = require('mongodb');

const COLLECTION = 'licenses';

class LicenseRepository {
    constructor(uri) {
        this._uri = uri || process.env.MONGODB_URI;
        this._client = null;
        this._db = null;
    }

    async init() {
        this._client = new MongoClient(this._uri);
        await this._client.connect();
        this._db = this._client.db();

        await this._db.collection(COLLECTION).createIndex(
            { license_key: 1 },
            { unique: true, name: 'idx_license_key' }
        );
    }

    async findByKey(key) {
        return this._db.collection(COLLECTION).findOne({ license_key: key });
    }

    async addSiteActivation(key, siteUrl, pluginVersion) {
        const now = new Date();
        return this._db.collection(COLLECTION).updateOne(
            { license_key: key },
            {
                $push: {
                    activated_sites: {
                        site_url: siteUrl,
                        plugin_version: pluginVersion,
                        activated_at: now,
                    },
                },
                $set: { updated_at: now },
            }
        );
    }

    async updateSiteActivation(key, siteUrl, pluginVersion) {
        const now = new Date();
        return this._db.collection(COLLECTION).updateOne(
            { license_key: key, 'activated_sites.site_url': siteUrl },
            {
                $set: {
                    'activated_sites.$.plugin_version': pluginVersion,
                    'activated_sites.$.activated_at': now,
                    updated_at: now,
                },
            }
        );
    }

    async removeSiteActivation(key, siteUrl) {
        const now = new Date();
        return this._db.collection(COLLECTION).updateOne(
            { license_key: key },
            {
                $pull: { activated_sites: { site_url: siteUrl } },
                $set: { updated_at: now },
            }
        );
    }

    async close() {
        if (this._client) {
            await this._client.close();
            this._client = null;
            this._db = null;
        }
    }
}

module.exports = LicenseRepository;
