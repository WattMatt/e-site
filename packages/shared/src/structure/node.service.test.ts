import { describe, expect, it, vi, beforeEach } from 'vitest';
import { listNodes, getNode, createNode, updateNode, decommissionNode } from './node.service';
import type { Node } from './types';

// ---------------------------------------------------------------------------
// Mock Supabase query-builder chain.
// Each method returns `this` so calls can be chained.  The terminal `.single()`
// and implicit `.then()` return a promise resolving to `{ data, error }`.
// ---------------------------------------------------------------------------

function makeBuilder(resolvedData: unknown, resolvedError: unknown = null) {
  const builder = {
    eq: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: resolvedData, error: resolvedError }),
    // Make the builder itself thenable so `await builder` works.
    then: (resolve: (v: { data: unknown; error: unknown }) => void) =>
      Promise.resolve({ data: resolvedData, error: resolvedError }).then(resolve),
  };
  return builder;
}

const nodeFixture: Node = {
  id: 'node-1',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  project_id: 'proj-1',
  organisation_id: 'org-1',
  kind: 'main_board',
  code: 'MB-01',
  name: 'Main Board 1',
  coc_required: true,
  status: 'active',
  shop_number: null,
  shop_name: null,
  shop_area_m2: null,
  breaker_rating_a: 400,
  pole_config: null,
  section: null,
  rating_kva: null,
  voltage_v: 400,
  notes: null,
  created_by: null,
};

function makeClient(builder: ReturnType<typeof makeBuilder>) {
  return {
    schema: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue(builder),
    }),
  };
}

// ---------------------------------------------------------------------------
// listNodes
// ---------------------------------------------------------------------------

describe('listNodes', () => {
  it('returns all nodes for a project (no filters)', async () => {
    const builder = makeBuilder([nodeFixture]);
    const client = makeClient(builder);

    const result = await listNodes(client as any, 'proj-1');

    expect(result).toEqual([nodeFixture]);
    expect(builder.eq).toHaveBeenCalledWith('project_id', 'proj-1');
    // No kind/status filter calls beyond the project_id eq
    expect(builder.eq).toHaveBeenCalledTimes(1);
  });

  it('applies kind filter when provided', async () => {
    const builder = makeBuilder([nodeFixture]);
    const client = makeClient(builder);

    await listNodes(client as any, 'proj-1', { kind: 'main_board' });

    expect(builder.eq).toHaveBeenCalledWith('kind', 'main_board');
  });

  it('applies status filter when provided', async () => {
    const builder = makeBuilder([nodeFixture]);
    const client = makeClient(builder);

    await listNodes(client as any, 'proj-1', { status: 'decommissioned' });

    expect(builder.eq).toHaveBeenCalledWith('status', 'decommissioned');
  });

  it('applies both kind and status filters when provided', async () => {
    const builder = makeBuilder([nodeFixture]);
    const client = makeClient(builder);

    await listNodes(client as any, 'proj-1', { kind: 'generator', status: 'active' });

    expect(builder.eq).toHaveBeenCalledWith('kind', 'generator');
    expect(builder.eq).toHaveBeenCalledWith('status', 'active');
  });
});

// ---------------------------------------------------------------------------
// getNode
// ---------------------------------------------------------------------------

describe('getNode', () => {
  it('returns the node when found', async () => {
    const builder = makeBuilder(nodeFixture);
    const client = makeClient(builder);

    const result = await getNode(client as any, 'node-1');

    expect(result).toEqual(nodeFixture);
    expect(builder.eq).toHaveBeenCalledWith('id', 'node-1');
  });

  it('returns null when not found (data is null)', async () => {
    const builder = makeBuilder(null);
    const client = makeClient(builder);

    const result = await getNode(client as any, 'nonexistent');

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// createNode
// ---------------------------------------------------------------------------

const validInput = {
  project_id: '00000000-0000-0000-0000-000000000001',
  organisation_id: '00000000-0000-0000-0000-000000000002',
  kind: 'main_board' as const,
  code: 'MB-02',
  coc_required: true,
};

describe('createNode', () => {
  it('inserts and returns the created node on valid input', async () => {
    const builder = makeBuilder(nodeFixture);
    const client = makeClient(builder);

    const result = await createNode(client as any, validInput);

    expect(result).toEqual(nodeFixture);
    expect(builder.insert).toHaveBeenCalledWith(validInput);
  });

  it('throws ZodError for an unknown kind without calling insert', async () => {
    const builder = makeBuilder(nodeFixture);
    const client = makeClient(builder);

    await expect(
      createNode(client as any, { ...validInput, kind: 'unknown_kind' as any }),
    ).rejects.toThrow();

    expect(builder.insert).not.toHaveBeenCalled();
  });

  it('throws ZodError for tenant_db with no shop_number without calling insert', async () => {
    const builder = makeBuilder(nodeFixture);
    const client = makeClient(builder);

    await expect(
      createNode(client as any, { ...validInput, kind: 'tenant_db', shop_number: null }),
    ).rejects.toThrow();

    expect(builder.insert).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// updateNode
// ---------------------------------------------------------------------------

describe('updateNode', () => {
  it('updates and returns the patched node', async () => {
    const updated = { ...nodeFixture, name: 'Renamed Board' };
    const builder = makeBuilder(updated);
    const client = makeClient(builder);

    const result = await updateNode(client as any, 'node-1', { name: 'Renamed Board' });

    expect(result).toEqual(updated);
    expect(builder.update).toHaveBeenCalledWith({ name: 'Renamed Board' });
    expect(builder.eq).toHaveBeenCalledWith('id', 'node-1');
  });
});

// ---------------------------------------------------------------------------
// decommissionNode
// ---------------------------------------------------------------------------

describe('decommissionNode', () => {
  it('sets status to decommissioned and returns the updated node', async () => {
    const decommissioned = { ...nodeFixture, status: 'decommissioned' as const };
    const builder = makeBuilder(decommissioned);
    const client = makeClient(builder);

    const result = await decommissionNode(client as any, 'node-1');

    expect(result).toEqual(decommissioned);
    expect(builder.update).toHaveBeenCalledWith({ status: 'decommissioned' });
    expect(builder.eq).toHaveBeenCalledWith('id', 'node-1');
  });
});
