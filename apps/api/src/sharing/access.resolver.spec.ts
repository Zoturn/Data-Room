import {
  ShareAccessResolver,
  ShareResolutionStore,
  can,
  rerootBreadcrumbs,
  type Access,
  type OwnedNode,
  type ShareCandidate,
  type ShareResolutionQuery,
} from "./access.resolver";
import { generateShareToken, hashShareToken } from "./share-token";

/**
 * The truth table this whole feature rests on: who may read what, and what nobody may read.
 *
 * The store is substituted because what is under test is the decision, not the SQL — but the
 * query the resolver *asks* is asserted too, because the two ways this can fail silently are a
 * missing filter (everyone matches) and a chain that does not actually contain the ancestors
 * (inheritance quietly stops working).
 */
const OWNER_ID = "99999999-9999-4999-8999-999999999999";
const STRANGER_ID = "88888888-8888-4888-8888-888888888888";
const RECIPIENT_ID = "77777777-7777-4777-8777-777777777777";

const ROOT_ID = "11111111-1111-4111-8111-111111111111";
const FOLDER_ID = "22222222-2222-4222-8222-222222222222";
const CHILD_ID = "33333333-3333-4333-8333-333333333333";
const SIBLING_ID = "44444444-4444-4444-8444-444444444444";

/** `/root/folder/child` — the deep node most of these cases resolve. */
const child: OwnedNode = {
  id: CHILD_ID,
  path: `/${ROOT_ID}/${FOLDER_ID}/`,
  ownerId: OWNER_ID,
};


type StoreStub = {
  queries: ShareResolutionQuery[];
  candidates: ShareCandidate[];
};

function buildResolver(candidates: ShareCandidate[] = []): {
  resolver: ShareAccessResolver;
  store: StoreStub;
} {
  const store: StoreStub = { queries: [], candidates };

  class Stub extends ShareResolutionStore {
    override findActiveShares(query: ShareResolutionQuery): Promise<ShareCandidate[]> {
      store.queries.push(query);

      return Promise.resolve(store.candidates);
    }
  }

  return { resolver: new ShareAccessResolver(new Stub()), store };
}

const TOKEN = generateShareToken();

describe("ShareAccessResolver", () => {
  describe("Requirement: The owner needs no share", () => {
    it("answers owner without asking the database at all", async () => {
      const { resolver, store } = await Promise.resolve(buildResolver());

      const access = await resolver.resolve(child, { id: OWNER_ID }, null);

      expect(access).toEqual({ kind: "owner" });
      // Not merely the right answer: an owner check that reached the shares table would make
      // every listing pay for a query that cannot change its result.
      expect(store.queries).toHaveLength(0);
    });
  });

  describe("Requirement: A caller with nothing to match on is refused", () => {
    it("refuses an anonymous caller with no link without querying", async () => {
      const { resolver, store } = buildResolver([
        { id: "share-1", nodeId: FOLDER_ID, role: "VIEWER" },
      ]);

      const access = await resolver.resolve(child, null, null);

      // Answered before the store, so "no principal" can never become "no principal filter"
      // in a query — which would match every active share in the table.
      expect(access).toEqual({ kind: "none" });
      expect(store.queries).toHaveLength(0);
    });

    it("refuses a signed-in stranger holding no link when nothing matches", async () => {
      const { resolver } = buildResolver([]);

      const access = await resolver.resolve(child, { id: STRANGER_ID }, null);

      expect(access).toEqual({ kind: "none" });
    });
  });

  describe("Requirement: Access is inherited from any ancestor", () => {
    it("lets a share on the grandparent reach a node two levels down", async () => {
      const { resolver, store } = buildResolver([
        { id: "share-root", nodeId: ROOT_ID, role: "VIEWER" },
      ]);

      const access = await resolver.resolve(child, null, TOKEN);

      expect(access).toMatchObject({ kind: "share", shareId: "share-root" });
      // Inheritance is this list. A chain missing its ancestors would still return a share
      // for a directly-shared node and quietly stop working for everything below it.
      expect(store.queries[0]?.nodeIds).toEqual([ROOT_ID, FOLDER_ID, CHILD_ID]);
    });

    it("asks with the presented token hashed, never the token itself", async () => {
      const { resolver, store } = buildResolver([]);

      await resolver.resolve(child, null, TOKEN);

      expect(store.queries[0]?.tokenHash).toBe(hashShareToken(TOKEN));
      expect(JSON.stringify(store.queries[0])).not.toContain(TOKEN);
    });

    it("does not look up a string that could not be one of our tokens", async () => {
      const { resolver, store } = buildResolver([]);

      const access = await resolver.resolve(child, null, "not-a-real-token");

      expect(access).toEqual({ kind: "none" });
      // Rejected without a round trip, so response time cannot separate "no such share" from
      // "not even a token" for a client probing the space.
      expect(store.queries).toHaveLength(0);
    });
  });

  describe("Requirement: The most permissive matching share wins", () => {
    it("prefers the share higher up, because it is the broader grant", async () => {
      const { resolver } = buildResolver([
        { id: "share-root", nodeId: ROOT_ID, role: "VIEWER" },
        { id: "share-child", nodeId: CHILD_ID, role: "VIEWER" },
      ]);

      const access = await resolver.resolve(child, { id: RECIPIENT_ID }, TOKEN);

      // Both candidates are ones this caller can actually use — the store only returns shares
      // their token or their grants match — so the ancestor is strictly the larger grant, and
      // re-rooting the view there shows them the context they already hold rather than less.
      expect(access).toMatchObject({ kind: "share", shareId: "share-root" });
    });

    it("reports which node the winning share was made on, so a view can re-root there", async () => {
      const { resolver } = buildResolver([
        { id: "share-folder", nodeId: FOLDER_ID, role: "VIEWER" },
      ]);

      const access = await resolver.resolve(child, null, TOKEN);

      expect(access).toMatchObject({ rootNodeId: FOLDER_ID });
    });
  });

  describe("Requirement: A share on a sibling grants nothing", () => {
    it("ignores a candidate whose node is not in this node's chain", async () => {
      // Only reachable if a `where` clause were widened by mistake. Skipping rather than
      // trusting means such a bug shows up as a missing result, not as a silent grant.
      const { resolver } = buildResolver([
        { id: "share-sibling", nodeId: SIBLING_ID, role: "VIEWER" },
      ]);

      const access = await resolver.resolve(child, null, TOKEN);

      expect(access).toEqual({ kind: "none" });
    });
  });

  describe("Requirement: Revocation and expiry are the store's filter, and are asked every time", () => {
    it("passes the moment of the request so an expiry boundary is decided once", async () => {
      const { resolver, store } = buildResolver([]);

      await resolver.resolve(child, null, TOKEN);

      expect(store.queries[0]?.now).toBeInstanceOf(Date);
    });

    it("refuses as soon as the store stops returning the share", async () => {
      const { resolver, store } = buildResolver([
        { id: "share-folder", nodeId: FOLDER_ID, role: "VIEWER" },
      ]);

      const before = await resolver.resolve(child, null, TOKEN);
      // What a revoke or an expiry does: the row stops matching. Nothing is cached in front
      // of this, so the very next request is refused.
      store.candidates = [];
      const after = await resolver.resolve(child, null, TOKEN);

      expect(before).toMatchObject({ kind: "share" });
      expect(after).toEqual({ kind: "none" });
    });
  });

  describe("Requirement: Moving a node changes what it inherits", () => {
    it("stops inheriting once the node's path no longer runs through the shared folder", async () => {
      const { resolver } = buildResolver([
        { id: "share-folder", nodeId: FOLDER_ID, role: "VIEWER" },
      ]);

      const inside = await resolver.resolve(child, null, TOKEN);
      // The same node after a move out of the shared folder: its path is what changed, and
      // access follows the tree rather than being pinned to the item.
      const moved = await resolver.resolve(
        { ...child, path: `/${ROOT_ID}/${SIBLING_ID}/` },
        null,
        TOKEN,
      );

      expect(inside).toMatchObject({ kind: "share" });
      expect(moved).toEqual({ kind: "none" });
    });
  });
});

describe("can", () => {
  it("permits reading for an owner and for a viewer, and nothing for no access", () => {
    expect(can({ kind: "owner" }, "read")).toBe(true);
    expect(
      can({ kind: "share", shareId: "s", role: "VIEWER", rootNodeId: FOLDER_ID }, "read"),
    ).toBe(true);
    expect(can({ kind: "none" }, "read")).toBe(false);
  });
});

const SHARE_ON_FOLDER: Access = {
  kind: "share",
  shareId: "share-folder",
  role: "VIEWER",
  rootNodeId: FOLDER_ID,
};

describe("rerootBreadcrumbs", () => {
  it("drops every ancestor above the shared node", () => {
    const chain = [
      { id: ROOT_ID, name: "My Data Room" },
      { id: FOLDER_ID, name: "Diligence" },
      { id: CHILD_ID, name: "Financials" },
    ];

    // The owner shared one folder, not the path to it. A recipient learning that "Diligence"
    // sits inside a room called "Project Falcon" is a disclosure the share never made.
    expect(rerootBreadcrumbs(chain, SHARE_ON_FOLDER)).toEqual([
      { id: FOLDER_ID, name: "Diligence" },
      { id: CHILD_ID, name: "Financials" },
    ]);
  });

  it("returns the whole chain when the root is not in it, rather than inventing one", () => {
    const chain = [{ id: CHILD_ID, name: "Financials" }];

    expect(rerootBreadcrumbs(chain, SHARE_ON_FOLDER)).toEqual(chain);
  });

  it("leaves an owner's own breadcrumbs alone — there is nothing to hide from them", () => {
    const chain = [
      { id: ROOT_ID, name: "My Data Room" },
      { id: FOLDER_ID, name: "Diligence" },
    ];

    expect(rerootBreadcrumbs(chain, { kind: "owner" })).toEqual(chain);
  });
});
