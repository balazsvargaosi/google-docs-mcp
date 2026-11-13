import { Firestore } from '@google-cloud/firestore';
const COLLECTION = 'mcp-oauth-tokens';
/**
 * Firestore-backed TokenStorage for FastMCP's OAuth proxy.
 * Tokens survive container restarts and redeployments.
 * On Cloud Run, authentication is automatic via the service account.
 */
export class FirestoreTokenStorage {
    db;
    constructor(projectId) {
        this.db = new Firestore({ projectId });
    }
    async save(key, value, _ttl) {
        const doc = this.db.collection(COLLECTION).doc(encodeKey(key));
        await doc.set({ value, createdAt: Date.now() });
    }
    async get(key) {
        const doc = await this.db.collection(COLLECTION).doc(encodeKey(key)).get();
        if (!doc.exists)
            return null;
        return doc.data().value;
    }
    async delete(key) {
        await this.db.collection(COLLECTION).doc(encodeKey(key)).delete();
    }
    async cleanup() {
        // FastMCP handles token expiry internally via delete() calls.
    }
}
function encodeKey(key) {
    return key.replace(/\//g, '__');
}
