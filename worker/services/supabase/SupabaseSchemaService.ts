import { createLogger } from '../../logger';

const logger = createLogger('SupabaseSchemaService');

export interface SupabaseTable {
    name: string;
    schema: string;
    columns: SupabaseColumn[];
}

export interface SupabaseColumn {
    name: string;
    type: string;
    nullable: boolean;
    isPrimaryKey: boolean;
    isForeignKey: boolean;
    foreignKeyRef?: string;
}

export interface SupabaseSchemaContext {
    projectUrl: string;
    anonKey: string;
    tables: SupabaseTable[];
}

export class SupabaseSchemaService {
    async fetchSchema(projectUrl: string, serviceRoleKey: string): Promise<SupabaseTable[]> {
        try {
            const resp = await fetch(`${projectUrl}/rest/v1/`, {
                headers: {
                    Authorization: `Bearer ${serviceRoleKey}`,
                    apikey: serviceRoleKey,
                    Accept: 'application/openapi+json',
                },
            });
            if (!resp.ok) {
                logger.warn('Failed to fetch Supabase schema via REST introspection', { status: resp.status });
                return [];
            }
            const openapi = await resp.json() as {
                definitions?: Record<string, {
                    properties?: Record<string, { type?: string; format?: string; description?: string }>;
                    required?: string[];
                }>;
            };
            return this.parseOpenApiSchema(openapi);
        } catch (err) {
            logger.error('Error fetching Supabase schema', err);
            return [];
        }
    }

    private parseOpenApiSchema(openapi: {
        definitions?: Record<string, {
            properties?: Record<string, { type?: string; format?: string; description?: string }>;
            required?: string[];
        }>;
    }): SupabaseTable[] {
        if (!openapi.definitions) return [];

        return Object.entries(openapi.definitions)
            .filter(([name]) => !name.startsWith('_') && !name.includes('rpc'))
            .map(([name, def]) => {
                const columns: SupabaseColumn[] = Object.entries(def.properties ?? {}).map(([colName, col]) => {
                    const isPk = colName === 'id';
                    const isFk = col.description?.includes('fk:') ?? false;
                    const fkRef = isFk
                        ? col.description?.match(/fk:\s*([^\s]+)/)?.[1]
                        : undefined;
                    return {
                        name: colName,
                        type: col.format ?? col.type ?? 'text',
                        nullable: !(def.required ?? []).includes(colName),
                        isPrimaryKey: isPk,
                        isForeignKey: isFk,
                        foreignKeyRef: fkRef,
                    };
                });
                return { name, schema: 'public', columns };
            });
    }

    formatSchemaForPrompt(tables: SupabaseTable[]): string {
        if (tables.length === 0) return '';
        const lines = tables.map(t => {
            const cols = t.columns
                .map(c => {
                    let desc = `${c.name} (${c.type}${c.nullable ? '' : ', required'}${c.isPrimaryKey ? ', PK' : ''}${c.isForeignKey ? `, FK→${c.foreignKeyRef}` : ''})`;
                    return `  - ${desc}`;
                })
                .join('\n');
            return `**${t.name}**\n${cols}`;
        });
        return lines.join('\n\n');
    }
}
