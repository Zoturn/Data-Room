import { Injectable } from "@nestjs/common";
import { NotFoundError } from "../common/errors/domain-error";
import {
  AccessResolver,
  can,
  type Access,
  type NodeWithOwner,
  type OwnedNode,
  type ReadPrincipal,
} from "./access.resolver";

/** A node and the decision that says this caller may read it. */
export type ReadableNode<T> = {
  node: T;
  access: Access;
};

/**
 * The one door every read path goes through.
 *
 * Its two failures are the same failure. A node that does not exist and a node this caller may
 * not see both raise `NotFoundError` with the same message, because a distinct 403 would
 * confirm the id is real — and for a share, that a share ever existed. There is no branch here
 * that could answer anything else, which is the point of having exactly one of these.
 *
 * It takes a `NodeWithOwner` rather than an id: loading a node is each module's own business
 * (a folder listing and a file viewer need different columns), while deciding who may see it
 * is not. Because the repositories' read methods hand back the wrapper and nothing else, a
 * service cannot get to a usable record without coming through here.
 */
@Injectable()
export class NodeAccessService {
  constructor(private readonly resolver: AccessResolver) {}

  async requireReadable<T extends { id: string; path: string }>(
    loaded: NodeWithOwner<T> | null,
    principal: ReadPrincipal,
    absentMessage: string,
  ): Promise<ReadableNode<T>> {
    if (loaded === null) throw new NotFoundError(absentMessage);

    const subject: OwnedNode = {
      id: loaded.node.id,
      path: loaded.node.path,
      ownerId: loaded.ownerId,
    };

    const access = await this.resolver.resolve(subject, principal.user, principal.token);

    // Asked through the capability matrix rather than as `access.kind !== "none"`, so the day
    // a role exists that is not allowed to read, this line already refuses it.
    if (!can(access, "read")) throw new NotFoundError(absentMessage);

    return { node: loaded.node, access };
  }
}
