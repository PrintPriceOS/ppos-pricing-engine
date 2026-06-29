'use strict';

require('dotenv').config();
const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/control_plane';

const licenses = [
    {
        license_key: 'PPP-TEST-PRO-0001',
        plan: 'pro_calculator',
        customer: 'Test Pro Customer',
        status: 'active',
        expires_at: new Date('2027-12-31'),
        max_activations: 3,
        activated_sites: [],
        created_at: new Date(),
        updated_at: new Date(),
    },
    {
        license_key: 'PPP-TEST-FREE-0001',
        plan: 'free',
        customer: 'Test Free Customer',
        status: 'active',
        expires_at: null,
        max_activations: 1,
        activated_sites: [],
        created_at: new Date(),
        updated_at: new Date(),
    },
    {
        license_key: 'PPP-TEST-EXPIRED-0001',
        plan: 'pro_calculator',
        customer: 'Expired Customer',
        status: 'active',
        expires_at: new Date('2024-01-01'),
        max_activations: 3,
        activated_sites: [],
        created_at: new Date(),
        updated_at: new Date(),
    },
    {
        license_key: 'PPP-TEST-SUSPENDED-0001',
        plan: 'pro_calculator',
        customer: 'Suspended Customer',
        status: 'suspended',
        expires_at: null,
        max_activations: 3,
        activated_sites: [],
        created_at: new Date(),
        updated_at: new Date(),
    },
    {
        license_key: 'PPP-TEST-MARKETPLACE-0001',
        plan: 'marketplace_node',
        customer: 'Marketplace Customer',
        status: 'active',
        expires_at: null,
        max_activations: -1,
        activated_sites: [],
        created_at: new Date(),
        updated_at: new Date(),
    },
];

(async () => {
    const client = new MongoClient(MONGODB_URI);

    try {
        await client.connect();
        const db = client.db();
        const col = db.collection('licenses');

        await col.createIndex(
            { license_key: 1 },
            { unique: true, name: 'idx_license_key' }
        );

        const result = await col.insertMany(licenses, { ordered: false }).catch(err => {
            if (err.code === 11000) {
                const inserted = err.result?.insertedCount ?? 0;
                console.log(`  ${inserted} new, ${licenses.length - inserted} already existed (duplicates skipped)`);
                return err.result;
            }
            throw err;
        });

        if (result?.insertedCount) {
            console.log(`  ${result.insertedCount} licenses seeded`);
        }

        const count = await col.countDocuments();
        console.log(`  Total licenses in collection: ${count}`);

    } finally {
        await client.close();
    }

    console.log('  Done.');
})();
