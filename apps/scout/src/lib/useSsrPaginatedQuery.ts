import { convexQuery } from "@convex-dev/react-query";
import { useSuspenseQuery } from "@tanstack/react-query";
import { omitNullish } from "../../shared/omitNullish";
import {
  usePaginatedQuery,
  type PaginatedQueryArgs,
  type PaginatedQueryReference,
  type UsePaginatedQueryReturnType,
} from "convex/react";

// The official TanStack adapter handles SSR queries but has no paginated hook.
// Hydrate the first page through it; Convex keeps ownership of live pagination.
export function useSsrPaginatedQuery<Query extends PaginatedQueryReference>(
  query: Query,
  args: PaginatedQueryArgs<Query>,
  options: { initialNumItems: number },
): UsePaginatedQueryReturnType<Query> {
  const live = usePaginatedQuery(query, args, options);
  // Convex's generic rest tuple cannot infer the reconstruction of its paginated args.
  // @ts-expect-error args omits paginationOpts; adding it restores the query's declared arguments.
  const { queryKey, staleTime } = convexQuery(query, {
    ...args,
    paginationOpts: { numItems: options.initialNumItems, cursor: null },
  });
  const { data: firstPage } = useSuspenseQuery({ queryKey, ...omitNullish({ staleTime }) });
  if (live.status !== "LoadingFirstPage") return live;
  if (firstPage.isDone) {
    return { ...live, results: firstPage.page, status: "Exhausted", isLoading: false };
  }
  return { ...live, results: firstPage.page };
}
