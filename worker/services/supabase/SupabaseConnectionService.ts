import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import * as schema from '../../database/schema';
import { encryptTokens, decryptTokens } from '../../utils/tokenEncryption';
import { createLogger } from '../../logger';

const logger = createLogger('SupabaseConnectionService');

export interface SupabaseProject {
    ref: string;
    name: string;
    region: string;
    status: string;
    organizationId: string;
    createdAt: string;
}

export interface SupabaseProjectApiKeys {
    anonKey: string;
    serviceRoleKey: string;
    projectUrl: string;
}

export interface LinkedProjectInfo {
    projectRef: string;
    projectName: string;
    projectUrl: string;
    anonKey: string;
}

export class SupabaseConnectionService {
    private db;

    constructor(private env: Env) {
        this.db = drizzle(env.DB, { schema });
    }

    async saveConnection(userId: string, accessToken: string, refreshToken: string | undefined, expiresIn: number | undefined): Promise<void> {
        const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000) : undefined;
        const encryptedAccess = await encryptTokens(
            { accessToken, refreshToken, expiresAt: expiresAt?.getTime() ?? 0, tokenType: 'Bearer', userId },
            this.env,
        );
        const encryptedRefresh = refreshToken
            ? await encryptTokens({ accessToken: refreshToken, expiresAt: 0, tokenType: 'Bearer', userId }, this.env)
            : undefined;

        const existing = await this.db.select({ id: schema.supabaseConnections.id })
            .from(schema.supabaseConnections)
            .where(eq(schema.supabaseConnections.userId, userId))
            .get();

        const id = existing?.id ?? crypto.randomUUID();

        if (existing) {
            await this.db.update(schema.supabaseConnections)
                .set({
                    encryptedAccessToken: encryptedAccess,
                    encryptedRefreshToken: encryptedRefresh ?? null,
                    tokenExpiresAt: expiresAt ?? null,
                    updatedAt: new Date(),
                })
                .where(eq(schema.supabaseConnections.userId, userId));
        } else {
            await this.db.insert(schema.supabaseConnections).values({
                id,
                userId,
                encryptedAccessToken: encryptedAccess,
                encryptedRefreshToken: encryptedRefresh ?? null,
                tokenExpiresAt: expiresAt ?? null,
            });
        }
    }

    async getAccessToken(userId: string): Promise<string | null> {
        const row = await this.db.select()
            .from(schema.supabaseConnections)
            .where(eq(schema.supabaseConnections.userId, userId))
            .get();
        if (!row) return null;

        const decrypted = await decryptTokens(row.encryptedAccessToken, this.env);
        if (!decrypted) return null;

        // Refresh if expired
        if (decrypted.expiresAt && Date.now() >= decrypted.expiresAt - 60_000) {
            if (decrypted.refreshToken) {
                return this.refreshAccessToken(userId, decrypted.refreshToken, row.encryptedRefreshToken ?? undefined);
            }
            return null;
        }

        return decrypted.accessToken;
    }

    private async refreshAccessToken(userId: string, refreshToken: string, _encryptedRefreshBlob: string | undefined): Promise<string | null> {
        try {
            const body = new URLSearchParams({
                grant_type: 'refresh_token',
                refresh_token: refreshToken,
            });
            const credentials = btoa(`${this.env.SUPABASE_CLIENT_ID}:${this.env.SUPABASE_CLIENT_SECRET}`);
            const resp = await fetch('https://api.supabase.com/v1/oauth/token', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    Authorization: `Basic ${credentials}`,
                },
                body: body.toString(),
            });
            if (!resp.ok) {
                logger.warn('Failed to refresh Supabase token', { userId, status: resp.status });
                return null;
            }
            const data = await resp.json() as { access_token: string; refresh_token?: string; expires_in?: number };
            await this.saveConnection(userId, data.access_token, data.refresh_token ?? refreshToken, data.expires_in);
            return data.access_token;
        } catch (err) {
            logger.error('Error refreshing Supabase token', err);
            return null;
        }
    }

    async getConnection(userId: string): Promise<schema.SupabaseConnection | null> {
        const row = await this.db.select()
            .from(schema.supabaseConnections)
            .where(eq(schema.supabaseConnections.userId, userId))
            .get();
        return row ?? null;
    }

    async linkProject(userId: string, project: SupabaseProject, keys: SupabaseProjectApiKeys): Promise<void> {
        const encryptedServiceRole = await encryptTokens(
            { accessToken: keys.serviceRoleKey, expiresAt: 0, tokenType: 'service_role', userId },
            this.env,
        );
        await this.db.update(schema.supabaseConnections)
            .set({
                projectRef: project.ref,
                projectName: project.name,
                projectUrl: keys.projectUrl,
                anonKey: keys.anonKey,
                encryptedServiceRoleKey: encryptedServiceRole,
                updatedAt: new Date(),
            })
            .where(eq(schema.supabaseConnections.userId, userId));
    }

    async getLinkedProject(userId: string): Promise<LinkedProjectInfo | null> {
        const row = await this.db.select()
            .from(schema.supabaseConnections)
            .where(eq(schema.supabaseConnections.userId, userId))
            .get();
        if (!row?.projectRef || !row.projectUrl || !row.anonKey) return null;
        return {
            projectRef: row.projectRef,
            projectName: row.projectName ?? row.projectRef,
            projectUrl: row.projectUrl,
            anonKey: row.anonKey,
        };
    }

    async getServiceRoleKey(userId: string): Promise<string | null> {
        const row = await this.db.select({ key: schema.supabaseConnections.encryptedServiceRoleKey })
            .from(schema.supabaseConnections)
            .where(eq(schema.supabaseConnections.userId, userId))
            .get();
        if (!row?.key) return null;
        const decrypted = await decryptTokens(row.key, this.env);
        return decrypted?.accessToken ?? null;
    }

    async disconnect(userId: string): Promise<void> {
        await this.db.delete(schema.supabaseConnections)
            .where(eq(schema.supabaseConnections.userId, userId));
    }

    // --- Per-app (per-agent) project links ---
    // The OAuth account/token stays per-user above; the SELECTED PROJECT is stored here
    // keyed by agentId so each app links its own DB independently.

    async linkProjectForAgent(userId: string, agentId: string, project: SupabaseProject, keys: SupabaseProjectApiKeys): Promise<void> {
        const encryptedServiceRole = await encryptTokens(
            { accessToken: keys.serviceRoleKey, expiresAt: 0, tokenType: 'service_role', userId },
            this.env,
        );
        const existing = await this.db.select({ id: schema.supabaseProjectLinks.id })
            .from(schema.supabaseProjectLinks)
            .where(eq(schema.supabaseProjectLinks.agentId, agentId))
            .get();
        if (existing) {
            await this.db.update(schema.supabaseProjectLinks)
                .set({
                    userId,
                    projectRef: project.ref,
                    projectName: project.name,
                    projectUrl: keys.projectUrl,
                    anonKey: keys.anonKey,
                    encryptedServiceRoleKey: encryptedServiceRole,
                    updatedAt: new Date(),
                })
                .where(eq(schema.supabaseProjectLinks.agentId, agentId));
        } else {
            await this.db.insert(schema.supabaseProjectLinks).values({
                id: crypto.randomUUID(),
                userId,
                agentId,
                projectRef: project.ref,
                projectName: project.name,
                projectUrl: keys.projectUrl,
                anonKey: keys.anonKey,
                encryptedServiceRoleKey: encryptedServiceRole,
            });
        }
    }

    async getLinkedProjectForAgent(agentId: string): Promise<LinkedProjectInfo | null> {
        const row = await this.db.select()
            .from(schema.supabaseProjectLinks)
            .where(eq(schema.supabaseProjectLinks.agentId, agentId))
            .get();
        if (!row?.projectRef || !row.projectUrl || !row.anonKey) return null;
        return {
            projectRef: row.projectRef,
            projectName: row.projectName ?? row.projectRef,
            projectUrl: row.projectUrl,
            anonKey: row.anonKey,
        };
    }

    async getServiceRoleKeyForAgent(agentId: string): Promise<string | null> {
        const row = await this.db.select({ key: schema.supabaseProjectLinks.encryptedServiceRoleKey })
            .from(schema.supabaseProjectLinks)
            .where(eq(schema.supabaseProjectLinks.agentId, agentId))
            .get();
        if (!row?.key) return null;
        const decrypted = await decryptTokens(row.key, this.env);
        return decrypted?.accessToken ?? null;
    }

    async unlinkAgent(agentId: string): Promise<void> {
        await this.db.delete(schema.supabaseProjectLinks)
            .where(eq(schema.supabaseProjectLinks.agentId, agentId));
    }

    /** All of a user's per-app project links, with the RankBuilder app title, so the
     *  picker can show which app a given Supabase DB is already linked to. */
    async getUserProjectLinks(userId: string): Promise<Array<{ projectRef: string; agentId: string; appTitle: string | null }>> {
        const rows = await this.db
            .select({
                projectRef: schema.supabaseProjectLinks.projectRef,
                agentId: schema.supabaseProjectLinks.agentId,
                appTitle: schema.apps.title,
            })
            .from(schema.supabaseProjectLinks)
            .leftJoin(schema.apps, eq(schema.apps.id, schema.supabaseProjectLinks.agentId))
            .where(eq(schema.supabaseProjectLinks.userId, userId))
            .all();
        return rows.map(r => ({ projectRef: r.projectRef, agentId: r.agentId, appTitle: r.appTitle ?? null }));
    }

    // --- Supabase Management API calls ---

    async createProject(accessToken: string, name: string, region: string, organizationId: string): Promise<{ ref: string; name: string }> {
        const resp = await fetch('https://api.supabase.com/v1/projects', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                name,
                region,
                organization_id: organizationId,
                plan: 'free',
                db_pass: Array.from(crypto.getRandomValues(new Uint8Array(16)))
                    .map(b => b.toString(16).padStart(2, '0')).join(''),
            }),
        });
        if (!resp.ok) {
            const text = await resp.text();
            throw new Error(`Failed to create project: ${resp.status} ${text}`);
        }
        const data = await resp.json() as { ref: string; name: string };
        return data;
    }

    async listOrganizations(accessToken: string): Promise<Array<{ id: string; name: string }>> {
        const resp = await fetch('https://api.supabase.com/v1/organizations', {
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!resp.ok) throw new Error(`Failed to list organizations: ${resp.status}`);
        return resp.json() as Promise<Array<{ id: string; name: string }>>;
    }

    async listProjects(accessToken: string): Promise<SupabaseProject[]> {
        const resp = await fetch('https://api.supabase.com/v1/projects', {
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!resp.ok) throw new Error(`Failed to list projects: ${resp.status}`);
        const projects = await resp.json() as Array<{
            id: string;
            ref: string;
            name: string;
            region: string;
            status: string;
            organization_id: string;
            created_at: string;
        }>;
        return projects.map(p => ({
            ref: p.ref,
            name: p.name,
            region: p.region,
            status: p.status,
            organizationId: p.organization_id,
            createdAt: p.created_at,
        }));
    }

    async getProjectApiKeys(accessToken: string, projectRef: string): Promise<SupabaseProjectApiKeys> {
        const resp = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/api-keys`, {
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!resp.ok) throw new Error(`Failed to get API keys: ${resp.status}`);
        const keys = await resp.json() as Array<{ name: string; api_key: string }>;
        const anon = keys.find(k => k.name === 'anon')?.api_key;
        const serviceRole = keys.find(k => k.name === 'service_role')?.api_key;
        if (!anon || !serviceRole) throw new Error('Could not find anon or service_role key');
        return {
            anonKey: anon,
            serviceRoleKey: serviceRole,
            projectUrl: `https://${projectRef}.supabase.co`,
        };
    }
}
