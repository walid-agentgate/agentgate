export class PostgresStoreAdapter {
  constructor(options = {}) {
    this.client = options.client;
    this.table = options.table || 'agentgate_records';
    this.requireTenant = options.requireTenant !== false;
    if (!this.client || typeof this.client.query !== 'function') throw new TypeError('PostgresStoreAdapter expects a client with query()');
  }
  async #withTenant(tenantId, fn) {
    if (!this.requireTenant || !tenantId) return fn(this.client);
    if (typeof this.client.connect === 'function') {
      const conn = await this.client.connect();
      try {
        await conn.query('BEGIN');
        await conn.query("select set_config('agentgate.tenant_id', $1, true)", [tenantId]);
        const result = await fn(conn);
        await conn.query('COMMIT');
        return result;
      } catch (error) {
        try { await conn.query('ROLLBACK'); } catch {}
        throw error;
      } finally { conn.release?.(); }
    }
    // Minimal query-only clients (including test doubles) still receive explicit tenant predicates.
    // Production pooled clients should expose connect() so RLS can be scoped with SET LOCAL.
    return fn(this.client);
  }
  async add(record) {
    const tenantId = record.tenantId || null;
    if (this.requireTenant && !tenantId) throw new Error('tenantId is required for Postgres persistence');
    return this.#withTenant(tenantId, async client => {
      await client.query(`insert into ${this.table} (id, tenant_id, kind, data) values ($1,$2,$3,$4)`, [record.id, tenantId, record.kind || 'record', JSON.stringify(record)]);
      return record;
    });
  }
  async get(id, tenantId) {
    if (this.requireTenant && !tenantId) throw new Error('tenantId is required for Postgres reads');
    return this.#withTenant(tenantId, async client => {
      const r = await client.query(`select data, version from ${this.table} where id=$1 and tenant_id=$2 limit 1`, [id, tenantId]);
      return r.rows?.[0]?.data ? { ...r.rows[0].data, _storageVersion: r.rows[0].version } : null;
    });
  }
  async list(tenantId, kind = null) {
    if (this.requireTenant && !tenantId) throw new Error('tenantId is required for Postgres reads');
    return this.#withTenant(tenantId, async client => {
      const r = await client.query(`select data, version from ${this.table} where tenant_id=$1 and ($2::text is null or kind=$2) order by created_at desc`, [tenantId, kind]);
      return (r.rows || []).map(x => ({ ...x.data, _storageVersion: x.version }));
    });
  }
  async update(id, tenantId, patch = {}, expectedVersion = null) {
    if (this.requireTenant && !tenantId) throw new Error('tenantId is required for Postgres updates');
    return this.#withTenant(tenantId, async client => {
      const r = await client.query(
        `update ${this.table} set data = data || $3::jsonb, version = version + 1 where id=$1 and tenant_id=$2 and ($4::int is null or version=$4) returning data, version`,
        [id, tenantId, JSON.stringify(patch), expectedVersion == null ? null : Number(expectedVersion)]
      );
      if (!r.rows?.[0]) throw new Error(expectedVersion == null ? 'Record not found' : 'Concurrent update detected');
      return { ...r.rows[0].data, _storageVersion: r.rows[0].version };
    });
  }
}

export const POSTGRES_SCHEMA = `create table if not exists agentgate_records (id text primary key, tenant_id text not null, kind text not null, data jsonb not null, version integer not null default 1, created_at timestamptz not null default now());
create index if not exists agentgate_records_tenant_kind_idx on agentgate_records (tenant_id, kind);
alter table agentgate_records enable row level security;
drop policy if exists agentgate_tenant_isolation on agentgate_records;
create policy agentgate_tenant_isolation on agentgate_records using (tenant_id = current_setting('agentgate.tenant_id', true)) with check (tenant_id = current_setting('agentgate.tenant_id', true));`;

export function createSupabaseAdapter(supabase, options = {}) {
  if (!supabase || typeof supabase.from !== 'function') throw new TypeError('createSupabaseAdapter expects a Supabase client');
  const table = options.table || 'agentgate_records';
  return {
    async add(record) { if (!record.tenantId) throw new Error('tenantId is required for Supabase persistence'); const { error } = await supabase.from(table).insert({ id: record.id, tenant_id: record.tenantId, kind: record.kind || 'record', data: record }); if (error) throw error; return record; },
    async get(id, tenantId = null) { if (!tenantId) throw new Error('tenantId is required for Supabase reads'); let q = supabase.from(table).select('data,version').eq('id', id).eq('tenant_id', tenantId); const { data, error } = await q.maybeSingle(); if (error) throw error; return data?.data ? { ...data.data, _storageVersion: data.version } : null; },
    async list(tenantId = null, kind = null) { if (!tenantId) throw new Error('tenantId is required for Supabase reads'); let q = supabase.from(table).select('data,version').order('created_at', { ascending: false }).eq('tenant_id', tenantId); if (kind) q = q.eq('kind', kind); const { data, error } = await q; if (error) throw error; return (data || []).map(x => x.data); }
  };
}
