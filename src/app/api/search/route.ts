import { searchDanCatalog } from "@/db/queries";
import { emptySearchResults, isValidQuery, parseCatalogFilters } from "@/lib/search";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  const query = searchParams.get("q") ?? "";

  if (!isValidQuery(query)) {
    return Response.json(emptySearchResults());
  }

  return Response.json(await searchDanCatalog(query, parseCatalogFilters(searchParams)));
}
